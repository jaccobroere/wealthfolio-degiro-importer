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
 * 4. Partition accepted rows into new and exact-duplicate. Exact duplicates
 *    are skipped (zero `saveMany` creates).
 * 5. Convert only accepted, non-duplicate rows → `ActivityCreate[]`.
 * 6. Call `activities.saveMany({ creates })`. NEVER pass a bare array.
 * 7. Mark fingerprints imported ONLY for entries that appear in `created`
 *    (authoritative). Failed/partial writes never mark failed fingerprints.
 */
import type { ActivityCreate, ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import { isInstrumentSymbol } from '../domain/activity-draft';
import { fingerprintActivity } from '../duplicates/fingerprint';
import { buildDuplicateIndex } from './duplicate-index';
import { toActivityCreate, toActivityImport } from './convert-activity';
import { getActivities, checkImport, saveCreates } from './api';
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
  };

  // 1. Prepare drafts with fingerprints and assets.
  const prepared = await prepareDrafts(drafts, resolveAsset);

  // 2. Convert to ActivityImport[] and call the read-only checkImport gate.
  const imports: ActivityImport[] = prepared.map((p) => toActivityImport(p, accountId));
  let checked: ActivityImport[];
  try {
    checked = await checkImport(api, imports);
  } catch (err) {
    result.fatal = err instanceof Error ? err.message : String(err);
    return result;
  }

  // 3. Build the duplicate index from existing activities on this account.
  const existing = await getActivities(api, accountId);
  const index = buildDuplicateIndex(existing);

  // 4. Partition into new and exact-duplicate. Only rows that passed
  //    checkImport (isValid true) and are not exact duplicates proceed.
  const acceptedPrepared: PreparedDraft[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const checkedRow = checked[i];
    if (!checkedRow?.isValid) {
      result.blocked += 1;
      continue;
    }
    if (index.importedFingerprints.has(p.fingerprint)) {
      result.skippedDuplicates += 1;
      continue;
    }
    acceptedPrepared.push(p);
  }

  if (acceptedPrepared.length === 0) {
    return result;
  }

  // 5. Convert accepted rows to ActivityCreate[].
  const creates: ActivityCreate[] = acceptedPrepared.map((p) => toActivityCreate(p, accountId));
  result.attempted = creates.length;

  // 6. Call saveMany({ creates }). NEVER a bare array.
  let mutation;
  try {
    mutation = await saveCreates(api, creates);
  } catch (err) {
    // Fatal: no fingerprints are marked imported.
    result.fatal = err instanceof Error ? err.message : String(err);
    result.failedFingerprints = acceptedPrepared.map((p) => p.fingerprint);
    return result;
  }

  // 7. Mark imported ONLY the fingerprints that appear in `created`. The
  //    `created` array is authoritative; entries in `errors` are not marked.
  const createdIds = new Set(mutation.created.map((a) => a.id));
  const createdFingerprints: string[] = [];

  // Map created activities back to prepared drafts via metadata fingerprint.
  // The host assigns ids; we correlate via the metadata we attached.
  for (const activity of mutation.created) {
    const meta = activity.metadata as Record<string, unknown> | undefined;
    const fp = meta?.sourceFingerprint;
    if (typeof fp === 'string' && fp.length > 0) createdFingerprints.push(fp);
  }

  // If the host did not round-trip metadata (T09-gate), fall back to positional
  // correlation: assume `created` is in the same order as `creates`. This is
  // defensive only; the metadata round-trip is the verified protocol.
  if (
    createdFingerprints.length === 0 &&
    createdIds.size > 0 &&
    mutation.created.length === acceptedPrepared.length
  ) {
    for (let i = 0; i < acceptedPrepared.length; i++) {
      createdFingerprints.push(acceptedPrepared[i].fingerprint);
    }
  }

  result.created = mutation.created.length;
  result.importedFingerprints = createdFingerprints;

  // Any attempted fingerprint not in `created` is a failure (partial write).
  const createdSet = new Set(createdFingerprints);
  for (const p of acceptedPrepared) {
    if (!createdSet.has(p.fingerprint)) result.failedFingerprints.push(p.fingerprint);
  }

  return result;
}

// Re-export the importer id for callers (e.g. tests).
export { IMPORTER_ID };
