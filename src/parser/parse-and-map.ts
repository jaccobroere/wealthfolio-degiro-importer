/**
 * End-to-end pure pipeline: CSV text → parsed rows → batch outcome →
 * reconciliation (+ optional fingerprints).
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 */

import { Decimal } from 'decimal.js';
import { parseDegiroCsv, type ParsedCsv } from './parse-csv';
import { buildBatch } from '../validation/validate-batch';
import { reconcile, type Reconciliation } from '../reconciliation/reconcile';
import { computeFingerprints } from '../duplicates/fingerprint';
import type { BatchOutcome } from '../domain/import-outcome';

export interface PipelineResult {
  parsed: ParsedCsv;
  batch: BatchOutcome;
  reconciliation: Reconciliation;
}

/**
 * Parse DEGIRO CSV text and produce the fully-accounted batch + reconciliation.
 * Throws only on an unrecognized header (`DegiroCsvError`); per-row problems
 * become `invalid`/`unsupported` outcomes inside the batch.
 */
export function parseAndMap(content: string): PipelineResult {
  const parsed = parseDegiroCsv(content);
  const batch = buildBatch(parsed.rows);
  const reconciliation = reconcile(batch);
  return { parsed, batch, reconciliation };
}

/** Pipeline result augmented with fingerprints and overlap detection. */
export interface PipelineResultWithFingerprints extends PipelineResult {
  /** activityIndex → idempotity hex digest (unique per event). */
  fingerprints: Map<number, string>;
  /** Idempotity collisions within the batch (must be empty for a clean file). */
  fingerprintCollisions: Set<number>;
  hasFingerprintCollision: boolean;
  /** Overlap clusters (coarser economic+timestamp key), size > 1. Informational. */
  overlapClusters: { key: string; activityIndices: number[] }[];
  overlapClusterCount: number;
  overlapActivityCount: number;
}

/** Same as `parseAndMap` plus deterministic SHA-256 fingerprints per activity. */
export async function parseAndMapWithFingerprints(
  content: string,
): Promise<PipelineResultWithFingerprints> {
  const base = parseAndMap(content);
  const report = await computeFingerprints(base.batch.activities);
  return {
    ...base,
    fingerprints: report.byActivityIndex,
    fingerprintCollisions: report.collisions,
    hasFingerprintCollision: report.collisions.size > 0,
    overlapClusters: report.overlapClusters,
    overlapClusterCount: report.overlapClusters.length,
    overlapActivityCount: report.overlapActivityIndices.size,
  };
}

/** Re-export the Decimal type for callers that build expected values. */
export { Decimal };
