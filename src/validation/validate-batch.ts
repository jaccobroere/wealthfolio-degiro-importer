/**
 * Batch orchestrator: turn parsed DEGIRO rows into a fully-accounted
 * `BatchOutcome` (one outcome per row) plus normalized `ActivityDraft[]`.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * Routing rules (every well-formed row gets exactly one outcome):
 *  - `KNOWN_SKIP` classification         → known-skip outcome with reason.
 *  - rows WITH an order id and a groupable kind (BUY/SELL/TRADE_FEE/
 *    ACCRUED_INTEREST/FX/TAX)            → order-id group → group-member
 *                                          outcomes + derived activity.
 *  - BUY/SELL WITHOUT an order id        → single-row group (preserved).
 *  - TRADE_FEE/ACCRUED_INTEREST w/o oid  → known-skip (orphan).
 *  - FX w/o order id                     → known-skip (fx-helper).
 *  - DIVIDEND/TAX/DEPOSIT/WITHDRAWAL/
 *    INTEREST/FEE                        → standalone activity (or zero-amount
 *                                          / positive-reversal skip).
 *  - anything else                       → unsupported (blocks the batch).
 */

import type { DegiroRow } from '../domain/degiro-row';
import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchOutcome, BatchSummary, RowOutcome } from '../domain/import-outcome';
import { classifyRow } from '../mapping/classify-row';
import { mapOrderGroup } from '../mapping/map-order-group';
import { mapStandalone } from '../mapping/map-standalone';
import { validateRow } from './validate-row';

/** Kinds that belong to an order-id group when an order id is present. */
const GROUPABLE_KINDS = new Set(['BUY', 'SELL', 'TRADE_FEE', 'ACCRUED_INTEREST', 'FX', 'TAX']);

/** Whether a classification kind is groupable. */
function isGroupable(
  kind: unknown,
): kind is 'BUY' | 'SELL' | 'TRADE_FEE' | 'ACCRUED_INTEREST' | 'FX' | 'TAX' {
  return kind !== null && typeof kind === 'string' && GROUPABLE_KINDS.has(kind as string);
}

/**
 * Produce a fully-accounted batch outcome from parsed rows. `activities` are in
 * deterministic chronological order; `outcomes` are in source-row order.
 */
export function buildBatch(rows: DegiroRow[]): BatchOutcome {
  const outcomes: RowOutcome[] = [];
  const activities: ActivityDraft[] = [];

  // 1) Structural per-row validation.
  const validRows: DegiroRow[] = [];
  for (const row of rows) {
    const errors = validateRow(row);
    if (errors.length > 0) {
      outcomes.push({
        kind: 'invalid',
        rowIndex: row.rowIndex,
        reason: errors.join('; '),
      });
    } else {
      validRows.push(row);
    }
  }

  // 2) Partition: groupable-with-oid, ungrouped-trade, standalone, skip, unsupported.
  const orderByOrderId = new Map<string, DegiroRow[]>();
  const standaloneRows: DegiroRow[] = [];

  for (const row of validRows) {
    const c = classifyRow(row).kind;

    if (isGroupable(c) && row.orderId !== '') {
      const bucket = orderByOrderId.get(row.orderId) ?? [];
      bucket.push(row);
      orderByOrderId.set(row.orderId, bucket);
    } else {
      // KNOWN_SKIP, ungrouped trades, FX/fees without oid, and standalone
      // activity kinds are all resolved in the standalone pass below.
      standaloneRows.push(row);
    }
  }

  // 3) Process order-id groups in insertion order (Map preserves it; this is
  //    the order each order id first appeared among the source rows).
  for (const orderId of orderByOrderId.keys()) {
    const groupRows = orderByOrderId.get(orderId)!;
    const result = mapOrderGroup(groupRows, activities.length);
    for (const activity of result.activities) activities.push(activity);
    for (const m of result.memberships) {
      outcomes.push({
        kind: 'group-member',
        rowIndex: m.rowIndex,
        orderId,
        activityIndex: m.activityIndex,
        role: m.role,
      });
    }
    for (const orphan of result.orphanSkips) {
      outcomes.push({
        kind: 'known-skip',
        rowIndex: orphan.rowIndex,
        reason:
          orphan.role === 'fx'
            ? 'fx-helper'
            : orphan.role === 'fee'
              ? 'orphan-trade-fee'
              : 'positive-reversal',
      });
    }
  }

  // 4) Process ungrouped trades (BUY/SELL without oid) as single-row groups.
  for (const row of standaloneRows) {
    const c = classifyRow(row).kind;
    if (c === 'BUY' || c === 'SELL') {
      const result = mapOrderGroup([row], activities.length);
      for (const activity of result.activities) activities.push(activity);
      for (const m of result.memberships) {
        outcomes.push({
          kind: 'group-member',
          rowIndex: m.rowIndex,
          orderId: '',
          activityIndex: m.activityIndex,
          role: m.role,
        });
      }
      for (const orphan of result.orphanSkips) {
        outcomes.push({
          kind: 'known-skip',
          rowIndex: orphan.rowIndex,
          reason: 'orphan-trade-fee',
        });
      }
      continue;
    }
  }

  // 5) Process remaining standalone rows (non-trade kinds).
  for (const row of standaloneRows) {
    const c = classifyRow(row).kind;
    if (c === 'BUY' || c === 'SELL') continue; // already handled above
    if (typeof c === 'object' && c.kind === 'KNOWN_SKIP') {
      outcomes.push({ kind: 'known-skip', rowIndex: row.rowIndex, reason: c.reason });
      continue;
    }
    if (c === 'FX') {
      outcomes.push({ kind: 'known-skip', rowIndex: row.rowIndex, reason: 'fx-helper' });
      continue;
    }
    if (c === 'TRADE_FEE') {
      outcomes.push({ kind: 'known-skip', rowIndex: row.rowIndex, reason: 'orphan-trade-fee' });
      continue;
    }
    if (c === 'ACCRUED_INTEREST') {
      // Orphan accrued interest without a parent trade; preserved as a skip.
      outcomes.push({ kind: 'known-skip', rowIndex: row.rowIndex, reason: 'orphan-trade-fee' });
      continue;
    }
    if (
      c === 'DIVIDEND' ||
      c === 'TAX' ||
      c === 'DEPOSIT' ||
      c === 'WITHDRAWAL' ||
      c === 'INTEREST' ||
      c === 'FEE'
    ) {
      const res = mapStandalone(row);
      if (res.kind === 'activity') {
        const activityIndex = activities.length;
        activities.push(res.activity);
        outcomes.push({ kind: 'activity', rowIndex: row.rowIndex, activityIndex });
      } else if (res.kind === 'known-skip') {
        outcomes.push({ kind: 'known-skip', rowIndex: row.rowIndex, reason: res.reason });
      } else {
        outcomes.push({
          kind: 'unsupported',
          rowIndex: row.rowIndex,
          reason: 'standalone mapping rejected the row',
        });
      }
      continue;
    }
    // UNKNOWN or anything unexpected.
    outcomes.push({
      kind: 'unsupported',
      rowIndex: row.rowIndex,
      reason: 'unrecognized DEGIRO description',
    });
  }

  // Deterministic chronological activity order. Outcomes currently reference
  // activities by their pre-sort (push) index, so remap after sorting.
  const withPushIndex = activities.map((a, pushIdx) => ({ a, pushIdx }));
  withPushIndex.sort((x, y) => (x.a.date < y.a.date ? -1 : x.a.date > y.a.date ? 1 : 0));
  const pushToPost = new Map<number, number>();
  withPushIndex.forEach((entry, postIdx) => pushToPost.set(entry.pushIdx, postIdx));
  activities.length = 0;
  for (const entry of withPushIndex) activities.push(entry.a);
  for (const o of outcomes) {
    if (o.kind === 'activity' || o.kind === 'group-member') {
      o.activityIndex = pushToPost.get(o.activityIndex) ?? o.activityIndex;
    }
  }

  const summary = summarize(rows.length, outcomes, activities);
  return { outcomes, activities, summary };
}

/** Compute the privacy-safe batch summary (counts and reason codes only). */
export function summarize(
  sourceRowCount: number,
  outcomes: RowOutcome[],
  activities: ActivityDraft[],
): BatchSummary {
  const byOutcome = {
    activity: 0,
    'group-member': 0,
    'known-skip': 0,
    unsupported: 0,
    invalid: 0,
  };
  const byActivityType: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};
  let unsupportedCount = 0;
  let invalidCount = 0;

  for (const o of outcomes) {
    byOutcome[o.kind]++;
    if (o.kind === 'unsupported') unsupportedCount++;
    if (o.kind === 'invalid') invalidCount++;
    if (o.kind === 'known-skip') {
      skipReasons[o.reason] = (skipReasons[o.reason] ?? 0) + 1;
    }
  }
  for (const a of activities) {
    byActivityType[a.activityType] = (byActivityType[a.activityType] ?? 0) + 1;
  }

  const accounted =
    byOutcome.activity +
    byOutcome['group-member'] +
    byOutcome['known-skip'] +
    byOutcome.unsupported +
    byOutcome.invalid;

  return {
    sourceRowCount,
    activityCount: activities.length,
    byOutcome,
    byActivityType,
    skipReasons,
    unsupportedCount,
    invalidCount,
    unaccountedCount: sourceRowCount - accounted,
  };
}
