/**
 * Idempotent import flow for the DEGIRO importer.
 *
 * Flow (verified 3.6.1 contract):
 * 1. Convert normalized drafts → complete `ActivityImport[]` (with required
 *    `isValid`/`isDraft`).
 * 2. Call `activities.checkImport(ActivityImport[])` (read-only gate). Fatal
 *    host errors return to review and keep Import disabled.
 * 3. Build a duplicate index from `activities.getAll(accountId)`, filtering
 *    by this add-on's `importerId`.
 * 4. Partition accepted rows into new and legacy exact-duplicates.
 * 5. Submit the checked rows to `activities.import`, Wealthfolio's
 *    import-specific persistence workflow.
 * 6. Use the host import result for authoritative created/duplicate outcomes.
 */
import type { ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import { isInstrumentSymbol } from '../domain/activity-draft';
import { fingerprintActivity } from '../duplicates/fingerprint';
import { buildDuplicateIndex } from './duplicate-index';
import { toActivityImport } from './convert-activity';
import { getActivities, checkImport, importCheckedActivities } from './api';
import type { ImportFlowResult, PreparedDraft } from './types';

/**
 * Prepare drafts: compute fingerprints and attach resolved assets.
 *
 * `resolveAsset` is an optional callback that maps a source ticker/ISIN to a
 * confirmed `AssetResolutionInput`. When it returns `undefined` the row is
 * treated as unresolved (cash or blocked instrument).
 */
export async function prepareDrafts(
  drafts: ActivityDraft[],
  resolveAsset?: (
    draft: ActivityDraft,
  ) => Promise<import('@wealthfolio/addon-sdk').AssetResolutionInput | undefined>,
): Promise<PreparedDraft[]> {
  const prepared: PreparedDraft[] = [];
  for (const draft of drafts) {
    const fingerprint = await fingerprintActivity(draft);
    const sourceTickerOrIsin =
      draft.isin ?? (isInstrumentSymbol(draft.symbol) ? draft.symbol : undefined);
    const asset = isInstrumentSymbol(draft.symbol)
      ? ((await resolveAsset?.(draft)) ?? { symbol: draft.symbol })
      : undefined;
    prepared.push({ draft, fingerprint, asset, sourceTickerOrIsin });
  }
  return prepared;
}

// Re-export the importer id for callers (e.g. tests).
export { IMPORTER_ID } from './types';

/** Default chunk size for the host import call. Keeps per-call payloads well
 * under typical postMessage / IPC bridge caps. Tunable via
 * `RunImportOptions.chunkSize`. */
export const DEFAULT_IMPORT_CHUNK_SIZE = 100;

/** True when running in a dev build (counts-only debug logs enabled).
 * Privacy-safe: no row data, no account ids, no balances. */
function isDevelopment(): boolean {
  try {
    // Vite injects `import.meta.env.DEV`. Use optional chaining for non-Vite
    // test environments where `import.meta` is undefined.
    if (
      typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: { DEV?: boolean } })?.env?.DEV
    ) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/** Options for `runImport`. */
export interface RunImportOptions {
  /** Maximum rows submitted per `activities.import` call. Must be a positive
   * integer. Defaults to `DEFAULT_IMPORT_CHUNK_SIZE`. */
  chunkSize?: number;
}

/**
 * Run the full idempotent import flow.
 *
 * @param api Host API.
 * @param accountId Selected destination account id.
 * @param drafts Normalized pure-core drafts.
 * @param resolveAsset Optional resolver for instrument mappings (see
 *   `symbol-mappings.ts`). When omitted, instrument drafts use their source
 *   symbol as the asset symbol (no exchange/provider enrichment).
 * @param options Optional knobs (e.g. `chunkSize` for the host import call).
 */
export async function runImport(
  api: HostAPI,
  accountId: string,
  drafts: ActivityDraft[],
  resolveAsset?: (
    draft: ActivityDraft,
  ) => Promise<import('@wealthfolio/addon-sdk').AssetResolutionInput | undefined>,
  options: RunImportOptions = {},
): Promise<ImportFlowResult> {
  const requestedChunkSize = options.chunkSize ?? DEFAULT_IMPORT_CHUNK_SIZE;
  if (!Number.isInteger(requestedChunkSize) || requestedChunkSize <= 0) {
    throw new Error(
      `runImport: chunkSize must be a positive integer (received ${String(requestedChunkSize)})`,
    );
  }

  const result: ImportFlowResult = {
    attempted: 0,
    created: 0,
    importedFingerprints: [],
    failedFingerprints: [],
    skippedDuplicates: 0,
    blocked: 0,
    failures: [],
    chunkSize: requestedChunkSize,
    chunks: [],
  };

  // 1. Prepare drafts with fingerprints and assets.
  const prepared = await prepareDrafts(drafts, resolveAsset);

  // 2. Convert to ActivityImport[] and call the read-only checkImport gate.
  const imports: ActivityImport[] = prepared.map((p) => toActivityImport(p, accountId));
  let checked: ActivityImport[];
  try {
    checked = await checkImport(api, imports);
  } catch (err) {
    result.fatal = safeHostFailureMessage(err, 'batch');
    return result;
  }

  // 3. Build the duplicate index from existing activities on this account.
  const existing = await getActivities(api, accountId);
  const index = buildDuplicateIndex(existing);

  // 4. Partition into new and legacy exact-duplicate rows. Importer metadata
  // from pre-1.2.5 releases is still honored here; newer rows are deduplicated
  // by Wealthfolio's import workflow below.
  const accepted: Array<{ prepared: PreparedDraft; checked: ActivityImport }> = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const checkedRow = checked[i];
    if (!checkedRow?.isValid) {
      result.blocked += 1;
      result.failures.push({
        sourceRowNumbers: p.draft.sourceRowNumbers,
        message: safeHostFailureMessage(checkedRow?.errors),
      });
      continue;
    }
    if (index.importedFingerprints.has(p.fingerprint)) {
      result.skippedDuplicates += 1;
      continue;
    }
    accepted.push({ prepared: p, checked: checkedRow });
  }

  if (accepted.length === 0) {
    return result;
  }

  // 5. The reviewed representation returned by checkImport is the only safe
  // input for the matching 3.6.1 import endpoint. A confirmed user action
  // creates posted activities, rather than retaining review-only drafts.
  const confirmed = accepted.map(({ checked: c }) => ({ ...c, isDraft: false }));
  result.attempted = confirmed.length;

  // Track fingerprints the host has accepted so far across chunks. The host
  // also dedupes per-call via its in-memory index, but tracking locally
  // keeps our `failures` and `failedFingerprints` bookkeeping honest when
  // a chunk throws after a previous one succeeded.
  const importedFingerprints: string[] = [];
  const importedSet = new Set<string>();
  let totalDuplicates = 0;
  // True only when every chunk threw (a true host-wide outage). Chunks that
  // returned successfully but reported 0 imports — e.g. because every row
  // was already a host-side duplicate — are not failures.
  let allChunksFailed = true;

  // 6. Submit reviewed rows to the host in fixed-size chunks. Each chunk is
  // the host's atomic unit; per-chunk failures surface as per-row failures
  // (not a fatal) so a host payload cap or a single bad row no longer takes
  // down a 200+ row batch. Only a complete host outage — every chunk throws
  // — is fatal.
  for (let chunkStart = 0; chunkStart < confirmed.length; chunkStart += requestedChunkSize) {
    const chunkEnd = Math.min(chunkStart + requestedChunkSize, confirmed.length);
    const chunkAccepted = accepted.slice(chunkStart, chunkEnd);
    const chunkConfirmed = confirmed.slice(chunkStart, chunkEnd);
    const chunkIndex = result.chunks.length;

    let hostImport: Awaited<ReturnType<typeof importCheckedActivities>>;
    try {
      hostImport = await importCheckedActivities(api, chunkConfirmed);
    } catch (err) {
      // A chunk-level rejection is per-row failure, not a fatal — provided
      // some other chunk succeeds. Record a sanitized message for every row
      // in the failed chunk and continue.
      const message = safeHostFailureMessage(err, 'activity');
      for (const { prepared: p } of chunkAccepted) {
        if (!importedSet.has(p.fingerprint)) {
          result.failures.push({
            sourceRowNumbers: p.draft.sourceRowNumbers,
            message,
          });
          result.failedFingerprints.push(p.fingerprint);
        }
      }
      result.chunks.push({
        index: chunkIndex,
        size: chunkConfirmed.length,
        imported: 0,
        duplicates: 0,
        failed: chunkAccepted.filter((a) => !importedSet.has(a.prepared.fingerprint)).length,
      });
      if (isDevelopment()) {
        // Privacy-safe debug summary: counts only.

        console.debug(
          `chunk ${chunkIndex}: size=${chunkConfirmed.length}, imported=0, failed=${result.chunks[chunkIndex]?.failed ?? 0}`,
        );
      }
      continue;
    }

    if (hostImport.activities.length !== chunkAccepted.length) {
      // Per-chunk incomplete result: treat as a per-row failure for the whole
      // chunk. The host returned something but the row count doesn't line up
      // with the request.
      const message = 'Wealthfolio returned an incomplete import result for this batch.';
      for (const { prepared: p } of chunkAccepted) {
        if (!importedSet.has(p.fingerprint)) {
          result.failures.push({
            sourceRowNumbers: p.draft.sourceRowNumbers,
            message,
          });
          result.failedFingerprints.push(p.fingerprint);
        }
      }
      result.chunks.push({
        index: chunkIndex,
        size: chunkConfirmed.length,
        imported: 0,
        duplicates: 0,
        failed: chunkAccepted.filter((a) => !importedSet.has(a.prepared.fingerprint)).length,
      });
      if (isDevelopment()) {
        console.debug(
          `chunk ${chunkIndex}: size=${chunkConfirmed.length}, imported=0, failed=${result.chunks[chunkIndex]?.failed ?? 0} (incomplete)`,
        );
      }
      continue;
    }
    let chunkImported = 0;
    let chunkDuplicates = 0;
    let chunkFailed = 0;
    for (let i = 0; i < chunkAccepted.length; i++) {
      const returned = hostImport.activities[i];
      const preparedDraft = chunkAccepted[i]!.prepared;
      // Skip rows already imported by an earlier successful chunk.
      if (importedSet.has(preparedDraft.fingerprint)) {
        chunkDuplicates += 1;
        continue;
      }
      const duplicate = isHostDuplicate(returned);
      const invalid = !returned.isValid || hasErrors(returned);
      if (duplicate) {
        chunkDuplicates += 1;
        continue;
      }
      if (invalid) {
        result.failures.push({
          sourceRowNumbers: preparedDraft.draft.sourceRowNumbers,
          message: safeHostFailureMessage(returned.errors),
        });
        result.failedFingerprints.push(preparedDraft.fingerprint);
        chunkFailed += 1;
        continue;
      }
      importedFingerprints.push(preparedDraft.fingerprint);
      importedSet.add(preparedDraft.fingerprint);
      chunkImported += 1;
    }

    totalDuplicates += chunkDuplicates;

    // Per-chunk integrity check: if the host's summary reports more imported
    // than we tracked, treat the discrepancy as a per-row failure for the
    // unaccounted rows in this chunk (count = max(0, summary - chunkImported)).
    const summaryImported = hostImport.summary.imported;
    const unaccountedImported = Math.max(0, summaryImported - chunkImported);
    if (unaccountedImported > 0) {
      // Conservative: we don't know which rows those are. Push a diagnostic
      // entry referencing the whole chunk's source rows.
      const sourceRowNumbers = chunkAccepted.flatMap(({ prepared: p }) => [
        ...p.draft.sourceRowNumbers,
      ]);
      result.failures.push({
        sourceRowNumbers,
        message: 'Wealthfolio did not return a complete import outcome for some activities.',
      });
    }

    result.chunks.push({
      index: chunkIndex,
      size: chunkConfirmed.length,
      imported: chunkImported,
      duplicates: chunkDuplicates,
      failed: chunkFailed + unaccountedImported,
    });
    // A chunk that returned a complete per-row outcome is a successful chunk
    // regardless of how many rows it actually imported. Only a chunk that
    // threw (caught above) leaves `allChunksFailed` set.
    allChunksFailed = false;
    if (isDevelopment()) {
      console.debug(
        `chunk ${chunkIndex}: size=${chunkConfirmed.length}, imported=${chunkImported}, failed=${chunkFailed + unaccountedImported}`,
      );
    }
  }

  // 7. Aggregate.
  result.created = importedFingerprints.length;
  result.importedFingerprints = importedFingerprints;
  result.skippedDuplicates += totalDuplicates;

  if (result.created === 0 && allChunksFailed) {
    // Mirrors the pre-chunking fatal contract: nothing landed, treat the
    // whole batch as a complete host outage.
    result.fatal =
      'Wealthfolio could not complete this import batch. Re-check the destination account and security mappings, then retry.';
    result.importedFingerprints = [];
    return result;
  }

  return result;
}

function hasErrors(activity: ActivityImport): boolean {
  return Object.values(activity.errors ?? {}).some((messages) => messages.length > 0);
}

function isHostDuplicate(activity: ActivityImport): boolean {
  return (
    !!activity.duplicateOfId ||
    activity.duplicateOfLineNumber !== undefined ||
    Object.prototype.hasOwnProperty.call(activity.warnings ?? {}, '_duplicate')
  );
}

/**
 * Host error strings can contain account ids or source-derived values. Keep
 * diagnostics actionable without rendering those opaque strings in the addon.
 */
function safeHostFailureMessage(error: unknown, scope: 'activity' | 'batch' = 'activity'): string {
  const text =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : JSON.stringify(error ?? '');
  if (/quote currency/i.test(text)) {
    return 'The selected security has no quote currency. Re-select its mapping.';
  }
  if (/credit card/i.test(text)) {
    return 'The selected destination account does not support these activities.';
  }
  if (/asset-backed|asset_id|symbol/i.test(text)) {
    return 'The security mapping is incomplete. Re-select the instrument.';
  }
  return scope === 'batch'
    ? 'Wealthfolio could not complete this import batch. Re-check the destination account and security mappings, then retry.'
    : 'Wealthfolio rejected this activity. Review the destination account and mapping.';
}
