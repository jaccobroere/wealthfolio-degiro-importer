/**
 * Idempotent import flow for the DEGIRO importer.
 *
 * Flow (verified 3.6.1 contract):
 * 1. Convert normalized drafts → complete `ActivityImport[]` (with required
 *    `isValid`/`isDraft`).
 * 2. Call `activities.checkImport(ActivityImport[])` (read-only gate). Fatal
 *    host errors return to review and keep Import disabled.
 * 3. Read `activities.getAll(accountId)` and skip rows already on the
 *    account: legacy exact duplicates (this add-on's metadata fingerprints)
 *    and content matches (`matchExistingActivities`), which survive shifted
 *    source rows in a newer export and assets that did not exist yet when an
 *    earlier copy was imported.
 * 4. Seed securities Wealthfolio does not know yet. The 3.6.1 import endpoint
 *    never creates assets: an instrument row without a resolved `assetId` is
 *    stored with no security at all. One row per new security is therefore
 *    written through `saveMany` (which creates the asset), and the remaining
 *    rows for it are re-checked so they carry the new `assetId`.
 * 5. Submit the checked rows to `activities.import`, Wealthfolio's
 *    import-specific persistence workflow. An instrument row still lacking an
 *    `assetId` is failed instead of imported without its security.
 * 6. Use the host import result for authoritative created/duplicate outcomes.
 */
import type { ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import { isInstrumentSymbol } from '../domain/activity-draft';
import { matchExistingActivities } from '../duplicates/existing-match';
import { fingerprintActivity } from '../duplicates/fingerprint';
import { occurrenceComment, repeatOccurrences } from '../duplicates/repeat-occurrence';
import { buildDuplicateIndex } from './duplicate-index';
import { toActivityCreate, toActivityImport } from './convert-activity';
import { toExistingActivities, toMatchable } from './existing-activities';
import { getActivities, checkImport, importCheckedActivities, saveCreates } from './api';
import type { ImportFlowResult, PreparedDraft } from './types';

/**
 * Prepare drafts: compute fingerprints and attach resolved assets.
 *
 * `resolveAsset` is an optional callback that maps a source ticker/ISIN to a
 * confirmed `AssetResolutionInput`. When it returns `undefined` the row is
 * treated as unresolved (cash or blocked instrument).
 *
 * Repeated identical activities (see `repeat-occurrence.ts`) get a numbered
 * comment from the second copy on, so Wealthfolio does not drop them as
 * duplicates of each other.
 */
export async function prepareDrafts(
  drafts: ActivityDraft[],
  resolveAsset?: (
    draft: ActivityDraft,
  ) => Promise<import('@wealthfolio/addon-sdk').AssetResolutionInput | undefined>,
): Promise<PreparedDraft[]> {
  const prepared: PreparedDraft[] = [];
  const occurrences = repeatOccurrences(drafts);
  for (let i = 0; i < drafts.length; i++) {
    const source = drafts[i]!;
    const occurrence = occurrences[i] ?? 1;
    const comment = occurrenceComment(source.comment, occurrence);
    const draft: ActivityDraft =
      occurrence > 1 ? { ...source, ...(comment ? { comment } : {}) } : source;
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
    alreadyInAccount: 0,
    alreadyInAccountUnlinked: 0,
    assetsCreated: 0,
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

  // 3. Read what is already on this account. Legacy importer metadata
  // (pre-1.2.5) is still honored; everything else is matched on content.
  const existing = await getActivities(api, accountId);
  const index = buildDuplicateIndex(existing);
  const contentMatch = matchExistingActivities(
    prepared.map((p) => toMatchable(p.draft, p.asset)),
    toExistingActivities(existing),
  );

  // 4. Partition into new rows and rows already on the account.
  let accepted: Array<{ prepared: PreparedDraft; checked: ActivityImport }> = [];
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
    const match = contentMatch.matches[i];
    if (match && match.kind !== 'new') {
      result.skippedDuplicates += 1;
      result.alreadyInAccount += 1;
      if (match.kind === 'existing-unlinked') result.alreadyInAccountUnlinked += 1;
      continue;
    }
    accepted.push({ prepared: p, checked: checkedRow });
  }

  if (accepted.length === 0) {
    return result;
  }

  // 5. Seed securities that do not exist in Wealthfolio yet.
  accepted = await seedMissingAssets(api, accountId, accepted, result);
  const importedFingerprints: string[] = [...result.importedFingerprints];
  const importedSet = new Set<string>(importedFingerprints);

  if (accepted.length === 0) {
    result.created = importedFingerprints.length;
    return result;
  }

  // 6. The reviewed representation returned by checkImport is the only safe
  // input for the matching 3.6.1 import endpoint. A confirmed user action
  // creates posted activities, rather than retaining review-only drafts.
  const confirmed = accepted.map(({ checked: c }) => ({ ...c, isDraft: false }));
  result.attempted += confirmed.length;

  // Track fingerprints the host has accepted so far across chunks. The host
  // also dedupes per-call via its in-memory index, but tracking locally
  // keeps our `failures` and `failedFingerprints` bookkeeping honest when
  // a chunk throws after a previous one succeeded. Seeded rows are already
  // in both.
  let totalDuplicates = 0;
  // True only when every chunk threw (a true host-wide outage). Chunks that
  // returned successfully but reported 0 imports — e.g. because every row
  // was already a host-side duplicate — are not failures.
  let allChunksFailed = true;

  // 7. Submit reviewed rows to the host in fixed-size chunks. Each chunk is
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

  // 8. Aggregate.
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

/** True for a checked instrument row whose security does not exist yet. */
function needsNewAsset(checked: ActivityImport): boolean {
  return (checked.symbol ?? '').trim() !== '' && (checked.assetId ?? '').trim() === '';
}

type AcceptedRow = { prepared: PreparedDraft; checked: ActivityImport };

/**
 * Create every missing security by writing one of its rows through
 * `saveMany`, then re-check its remaining rows so they carry the new asset
 * id. Seeded rows are recorded as created on `result`; rows whose security
 * could not be created are recorded as failures and never reach
 * `activities.import`, where they would be stored without a security.
 *
 * Returns the rows still to submit through `activities.import`.
 */
async function seedMissingAssets(
  api: HostAPI,
  accountId: string,
  accepted: AcceptedRow[],
  result: ImportFlowResult,
): Promise<AcceptedRow[]> {
  const groups = new Map<string, AcceptedRow[]>();
  for (const row of accepted) {
    if (!needsNewAsset(row.checked)) continue;
    const key = `${(row.checked.symbol ?? '').trim().toUpperCase()}@${row.checked.exchangeMic ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  if (groups.size === 0) return accepted;

  const fail = (rows: AcceptedRow[], message: string) => {
    for (const { prepared: p } of rows) {
      result.failures.push({ sourceRowNumbers: p.draft.sourceRowNumbers, message });
      result.failedFingerprints.push(p.fingerprint);
    }
  };

  const recheck: AcceptedRow[] = [];
  let seedIndex = 0;
  for (const rows of groups.values()) {
    const [seed, ...rest] = rows;
    if (!seed) continue;
    result.attempted += 1;
    let seeded: boolean;
    try {
      const create = toActivityCreate(
        seed.prepared,
        { ...seed.checked, isDraft: false },
        accountId,
        `degiro-seed-${seedIndex++}`,
      );
      const saved = await saveCreates(api, [create]);
      seeded = saved.errors.length === 0 && saved.created.length === 1;
    } catch {
      seeded = false;
    }
    if (!seeded) {
      fail(rows, 'Wealthfolio could not create this security. Re-select its mapping.');
      continue;
    }
    result.assetsCreated += 1;
    result.importedFingerprints.push(seed.prepared.fingerprint);
    recheck.push(...rest);
  }

  let rechecked: ActivityImport[] = [];
  if (recheck.length > 0) {
    try {
      rechecked = await checkImport(
        api,
        recheck.map((r) => toActivityImport(r.prepared, accountId)),
      );
    } catch {
      rechecked = [];
    }
  }
  const replacement = new Map<AcceptedRow, ActivityImport | undefined>();
  recheck.forEach((row, i) => replacement.set(row, rechecked[i]));

  const out: AcceptedRow[] = [];
  const unresolved: AcceptedRow[] = [];
  for (const row of accepted) {
    if (!needsNewAsset(row.checked)) {
      out.push(row);
      continue;
    }
    if (!replacement.has(row)) continue; // seeded, or its security failed
    const fresh = replacement.get(row);
    if (!fresh?.isValid || needsNewAsset(fresh)) {
      unresolved.push(row);
      continue;
    }
    out.push({ prepared: row.prepared, checked: fresh });
  }
  if (unresolved.length > 0) {
    result.attempted += unresolved.length;
    fail(
      unresolved,
      'Wealthfolio did not link this activity to its security. Re-select its mapping.',
    );
  }
  return out;
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
