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
import { IMPORTER_ID } from './types';

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

/**
 * Run the full idempotent import flow.
 *
 * @param api Host API.
 * @param accountId Selected destination account id.
 * @param drafts Normalized pure-core drafts.
 * @param resolveAsset Optional resolver for instrument mappings (see
 *   `symbol-mappings.ts`). When omitted, instrument drafts use their source
 *   symbol as the asset symbol (no exchange/provider enrichment).
 */
export async function runImport(
  api: HostAPI,
  accountId: string,
  drafts: ActivityDraft[],
  resolveAsset?: (
    draft: ActivityDraft,
  ) => Promise<import('@wealthfolio/addon-sdk').AssetResolutionInput | undefined>,
): Promise<ImportFlowResult> {
  const result: ImportFlowResult = {
    attempted: 0,
    created: 0,
    importedFingerprints: [],
    failedFingerprints: [],
    skippedDuplicates: 0,
    blocked: 0,
    failures: [],
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
  const confirmed = accepted.map(({ checked }) => ({ ...checked, isDraft: false }));
  result.attempted = confirmed.length;

  let hostImport;
  try {
    hostImport = await importCheckedActivities(api, confirmed);
  } catch (err) {
    // The import endpoint is atomic. A rejection gives no safe indication
    // whether the server committed anything, so do not retry automatically.
    result.fatal = safeHostFailureMessage(err, 'batch');
    result.failedFingerprints = accepted.map(({ prepared }) => prepared.fingerprint);
    return result;
  }

  // 6. `import` returns the reviewed rows in request order. This lets the
  // add-on correlate host duplicate/validation status without inventing an
  // activity-create payload or storing private statement provenance.
  if (hostImport.activities.length !== accepted.length) {
    result.fatal = 'Wealthfolio returned an incomplete import result. No automatic retry was made.';
    result.failedFingerprints = accepted.map(({ prepared }) => prepared.fingerprint);
    return result;
  }

  const imported: string[] = [];
  let hostDuplicates = 0;
  for (let i = 0; i < accepted.length; i++) {
    const returned = hostImport.activities[i];
    const preparedDraft = accepted[i].prepared;
    const duplicate = isHostDuplicate(returned);
    const invalid = !returned.isValid || hasErrors(returned);
    if (duplicate) {
      hostDuplicates += 1;
      continue;
    }
    if (invalid) {
      result.failures.push({
        sourceRowNumbers: preparedDraft.draft.sourceRowNumbers,
        message: safeHostFailureMessage(returned.errors),
      });
      result.failedFingerprints.push(preparedDraft.fingerprint);
      continue;
    }
    imported.push(preparedDraft.fingerprint);
  }

  result.created = hostImport.summary.imported;
  result.skippedDuplicates += Math.max(hostDuplicates, hostImport.summary.duplicates);
  if (!hostImport.summary.success || hostImport.summary.imported !== imported.length) {
    result.fatal =
      'Wealthfolio did not return a complete import outcome. No automatic retry was made.';
    result.failedFingerprints = accepted.map(({ prepared }) => prepared.fingerprint);
    return result;
  }
  result.importedFingerprints = imported;

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

// Re-export the importer id for callers (e.g. tests).
export { IMPORTER_ID };

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
