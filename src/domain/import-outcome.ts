/**
 * Outcome model: every source row produces exactly one outcome.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. No raw row values, products,
 * tickers, balances, or order ids are carried in outcome summaries — only
 * counts, reason codes, and source row numbers (needed for provenance and
 * fingerprints).
 */

import type { SkipReason } from './skip-reason';

/**
 * Per-row outcome. `rowIndex` is the 1-based source-data line number.
 *
 * - `activity`     — standalone row mapped 1:1 to an activity.
 * - `group-member` — row consumed into an order-id grouped activity.
 * - `known-skip`   — explicitly allow-listed broker bookkeeping noise.
 * - `unsupported`  — unrecognized row; blocks the batch (never auto-skip).
 * - `invalid`      — row failed structural parsing (wrong field count, etc.).
 */
export type RowOutcome =
  | { kind: 'activity'; rowIndex: number; activityIndex: number }
  | {
      kind: 'group-member';
      rowIndex: number;
      orderId: string;
      activityIndex: number;
      role: 'trade' | 'fee' | 'accrued-interest' | 'fx' | 'tax';
    }
  | { kind: 'known-skip'; rowIndex: number; reason: SkipReason; note?: string }
  | { kind: 'unsupported'; rowIndex: number; reason: string }
  | { kind: 'invalid'; rowIndex: number; reason: string };

export interface BatchSummary {
  /** Number of parsed source rows accounted for. */
  sourceRowCount: number;
  /** Number of normalized activities derived. */
  activityCount: number;
  byOutcome: Record<RowOutcome['kind'], number>;
  byActivityType: Record<string, number>;
  skipReasons: Record<string, number>;
  /** Count of `unsupported` outcomes (must be zero to import). */
  unsupportedCount: number;
  /** Count of `invalid` outcomes (must be zero to import). */
  invalidCount: number;
  /** sourceRowCount minus the sum of all outcomes; must be zero. */
  unaccountedCount: number;
}

export interface BatchOutcome {
  outcomes: RowOutcome[];
  activities: import('./activity-draft').ActivityDraft[];
  summary: BatchSummary;
}
