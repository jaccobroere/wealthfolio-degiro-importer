/**
 * Deterministic source fingerprints via Web Crypto SHA-256.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. Uses
 * `globalThis.crypto.subtle` (Node 20 WebCrypto and modern browsers).
 *
 * Two complementary keys per activity:
 *
 * 1. **Idempotency fingerprint** — unique identity of one real-world event within
 *    its source statement. Built from broker, schema version, normalized
 *    economic fields, timestamp, AND contributing source row numbers (grouped
 *    trades: order id + group fields + rows; standalone: economic fields +
 *    timestamp + source row). The source-row provenance anchor is required so
 *    that same-timestamp/same-amount bookkeeping rows (e.g. multiple per-exchange
 *    connectivity fees booked in the same second) get distinct fingerprints
 *    within one statement, while re-importing the SAME statement yields
 *    identical fingerprints (exact duplicate detection).
 *
 * 2. **Overlap key** — coarser: normalized economic fields + timestamp only
 *    (no source rows). Activities sharing an overlap key within a batch, or
 *    across imported batches, are surfaced for review as potential overlapping
 *    imports. This is informational, never fatal.
 *
 * The standalone idempotency fingerprint additionally includes source-row
 * provenance so same-timestamp bookkeeping events remain distinct. Cross-range
 * overlap detection is provided separately by the overlap key.
 */

import type { ActivityDraft } from '../domain/activity-draft';

/** Broker tag and schema version included in every fingerprint. */
export const FINGERPRINT_BROKER = 'DEGIRO';
export const FINGERPRINT_SCHEMA_VERSION = '1';

/** Normalize a decimal string: canonical Decimal form so "10" and "10.0" match. */
function normDec(s: string | undefined): string {
  if (s === undefined || s === '') return '';
  const [intPart, fracPart] = s.split('.');
  const intNorm = (intPart ?? '0').replace(/^0+(?=\d)/, '') || '0';
  if (fracPart === undefined || fracPart === '') return intNorm;
  const fracNorm = fracPart.replace(/0+$/, '');
  return fracNorm === '' ? intNorm : `${intNorm}.${fracNorm}`;
}

function normStr(s: string | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

function sortedRows(rows: number[] | undefined): string {
  return [...(rows ?? [])].sort((a, b) => a - b).join(',');
}

/** Build the canonical idempotity-fingerprint input for a single activity. */
export function fingerprintInput(activity: ActivityDraft): string {
  const parts: string[] = [FINGERPRINT_BROKER, FINGERPRINT_SCHEMA_VERSION, activity.activityType];

  if (activity.group) {
    parts.push(
      'G',
      activity.group.orderId,
      normStr(activity.isin ?? activity.symbol),
      normStr(activity.currency),
      normDec(activity.quantity),
      normDec(activity.amount),
      normDec(activity.fee),
      sortedRows(activity.group.tradeSourceRowNumbers),
      sortedRows(activity.group.feeSourceRowNumbers),
      activity.group.accruedInterest
        ? sortedRows(activity.group.accruedInterest.sourceRowNumbers)
        : '',
    );
  } else {
    parts.push(
      'S',
      normStr(activity.isin ?? activity.symbol),
      normStr(activity.currency),
      normDec(activity.amount),
      activity.date,
      sortedRows(activity.sourceRowNumbers),
    );
  }

  return parts.join('|');
}

/** Build the coarser overlap-key input (economic + timestamp, no source rows). */
export function overlapKeyInput(activity: ActivityDraft): string {
  return [
    FINGERPRINT_BROKER,
    FINGERPRINT_SCHEMA_VERSION,
    activity.activityType,
    normStr(activity.isin ?? activity.symbol),
    normStr(activity.currency),
    normDec(activity.amount),
    normDec(activity.quantity),
    activity.date,
  ].join('|');
}

/** Compute a hex SHA-256 fingerprint for a single activity. */
export async function fingerprintActivity(activity: ActivityDraft): Promise<string> {
  return sha256Hex(fingerprintInput(activity));
}

export interface FingerprintReport {
  /** activityIndex → idempotity hex digest (unique per event). */
  byActivityIndex: Map<number, string>;
  /** Idempotity collisions within the batch (must be empty for a clean file). */
  collisions: Set<number>;
  /** Overlap clusters: groups of activities sharing a coarser economic+timestamp key. */
  overlapClusters: { key: string; activityIndices: number[] }[];
  /** Activities that belong to an overlap cluster of size > 1. */
  overlapActivityIndices: Set<number>;
}

/**
 * Compute idempotity fingerprints and overlap clusters for all activities.
 */
export async function computeFingerprints(activities: ActivityDraft[]): Promise<FingerprintReport> {
  const digests = await Promise.all(
    activities.map((a, i) => sha256Hex(fingerprintInput(a)).then((h) => [i, h] as const)),
  );
  const byActivityIndex = new Map<number, string>();
  const digestToIndices = new Map<string, number[]>();
  for (const [i, h] of digests) {
    byActivityIndex.set(i, h);
    const list = digestToIndices.get(h) ?? [];
    list.push(i);
    digestToIndices.set(h, list);
  }
  const collisions = new Set<number>();
  for (const [, idxs] of digestToIndices) {
    if (idxs.length > 1) for (const i of idxs) collisions.add(i);
  }

  // Overlap clusters by coarser economic+timestamp key.
  const overlapToIndices = new Map<string, number[]>();
  for (let i = 0; i < activities.length; i++) {
    const key = overlapKeyInput(activities[i]);
    const list = overlapToIndices.get(key) ?? [];
    list.push(i);
    overlapToIndices.set(key, list);
  }
  const overlapClusters: { key: string; activityIndices: number[] }[] = [];
  const overlapActivityIndices = new Set<number>();
  for (const [key, idxs] of overlapToIndices) {
    if (idxs.length > 1) {
      overlapClusters.push({ key, activityIndices: idxs });
      for (const i of idxs) overlapActivityIndices.add(i);
    }
  }

  return { byActivityIndex, collisions, overlapClusters, overlapActivityIndices };
}

/** SHA-256 → lowercase hex via Web Crypto. */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'Web Crypto subtle is unavailable; fingerprints require globalThis.crypto.subtle',
    );
  }
  const data = new TextEncoder().encode(input);
  const buf = await subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
