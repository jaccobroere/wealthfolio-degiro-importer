/**
 * Batch orchestrator: turn parsed DEGIRO rows into a fully-accounted
 * `BatchOutcome` (one outcome per row) plus normalized `ActivityDraft[]`.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * Routing rules (every well-formed row gets exactly one outcome):
 *  - `KNOWN_SKIP` classification         → known-skip outcome with reason.
 *  - rows WITH an order id and a groupable kind (BUY/SELL/TRADE_FEE/
 *    ACCRUED_INTEREST/TAX)               → order-id group → group-member
 *                                          outcomes + derived activity.
 *  - BUY/SELL WITHOUT an order id        → single-row group (preserved).
 *  - TRADE_FEE/ACCRUED_INTEREST w/o oid  → known-skip (orphan).
 *  - FX                                 → paired cash transfers, grouped by
 *                                          order or exact timestamp/value date.
 *  - DIVIDEND/TAX/DEPOSIT/WITHDRAWAL/
 *    INTEREST/FEE/CREDIT                 → standalone activity (or zero-amount skip).
 *  - anything else                       → unsupported (blocks the batch).
 *
 * Reviewer overrides are applied first: an ignored row short-circuits to a
 * `user-ignored` known-skip, and an edited row continues through every rule
 * above with its patched values.
 */

import type { DegiroRow } from '../domain/degiro-row';
import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchOutcome, BatchSummary, RowOutcome } from '../domain/import-outcome';
import type { SkipReason } from '../domain/skip-reason';
import { applyRowPatch, changedFields, type RowOverrides } from '../domain/row-override';
import { classifyRow } from '../mapping/classify-row';
import { mapOrderGroup, type OrphanRole } from '../mapping/map-order-group';
import { mapStandalone } from '../mapping/map-standalone';
import { mapFxGroup } from '../mapping/map-fx-group';
import { validateRow } from './validate-row';

/** Warning key attached to activities derived from a reviewer-edited row. */
export const SOURCE_EDITED_WARNING = 'sourceEdited';

/**
 * Warning key attached to an activity whose order group contains a row the
 * reviewer changed. The activity is still built, but from different rows or
 * different values, so its quantity, amount, or fee may no longer reflect the
 * whole order.
 */
export const GROUP_ROW_CHANGED_WARNING = 'groupRowChanged';

/** Kinds that belong to an order-id group when an order id is present. */
const GROUPABLE_KINDS = new Set(['BUY', 'SELL', 'TRADE_FEE', 'ACCRUED_INTEREST', 'TAX']);

/** Whether a classification kind is groupable. */
function isGroupable(
  kind: unknown,
): kind is 'BUY' | 'SELL' | 'TRADE_FEE' | 'ACCRUED_INTEREST' | 'TAX' {
  return kind !== null && typeof kind === 'string' && GROUPABLE_KINDS.has(kind as string);
}

/**
 * Produce a fully-accounted batch outcome from parsed rows. `activities` are in
 * deterministic chronological order; `outcomes` are in source-row order.
 */
export function buildBatch(rows: DegiroRow[], overrides: RowOverrides = {}): BatchOutcome {
  const outcomes: RowOutcome[] = [];
  const activities: ActivityDraft[] = [];

  // 0) Reviewer overrides. Ignored rows are accounted immediately as explicit
  //    skips; edited rows enter the pipeline with their patched values.
  const effectiveRows: DegiroRow[] = [];
  const editedRowIndices = new Set<number>();
  const touchedOrderIds = new Set<string>();
  for (const row of rows) {
    const override = overrides[row.rowIndex];
    if (override?.kind === 'ignore') {
      outcomes.push({ kind: 'known-skip', rowIndex: row.rowIndex, reason: 'user-ignored' });
      if (row.orderId !== '') touchedOrderIds.add(row.orderId);
      continue;
    }
    if (override?.kind === 'edit' && changedFields(row, override.patch).length > 0) {
      editedRowIndices.add(row.rowIndex);
      if (row.orderId !== '') touchedOrderIds.add(row.orderId);
      effectiveRows.push(applyRowPatch(row, override.patch));
      continue;
    }
    effectiveRows.push(row);
  }

  // 1) Structural per-row validation.
  const validRows: DegiroRow[] = [];
  for (const row of effectiveRows) {
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
  const fxGroups = new Map<string, DegiroRow[]>();
  const standaloneRows: DegiroRow[] = [];

  for (const row of validRows) {
    const c = classifyRow(row).kind;

    if (c === 'FX') {
      const key = row.orderId || `${row.date}:${row.time}:${row.valueDate}`;
      const bucket = fxGroups.get(key) ?? [];
      bucket.push(row);
      fxGroups.set(key, bucket);
    } else if (isGroupable(c) && row.orderId !== '') {
      const bucket = orderByOrderId.get(row.orderId) ?? [];
      bucket.push(row);
      orderByOrderId.set(row.orderId, bucket);
    } else {
      // KNOWN_SKIP, ungrouped trades, fees without oid, and standalone
      // activity kinds are all resolved in the standalone pass below.
      standaloneRows.push(row);
    }
  }

  for (const groupRows of fxGroups.values()) {
    const mapped = mapFxGroup(groupRows);
    if (mapped.length === 0) {
      for (const row of groupRows)
        outcomes.push({
          kind: 'unsupported',
          rowIndex: row.rowIndex,
          reason: 'Incomplete or ambiguous currency conversion; both cash legs are required',
        });
      continue;
    }
    for (const activity of mapped) {
      const activityIndex = activities.length;
      activities.push(activity);
      for (const rowIndex of activity.sourceRowNumbers)
        outcomes.push({
          kind: 'group-member',
          rowIndex,
          orderId: groupRows[0].orderId,
          activityIndex,
          role: 'fx',
        });
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
        reason: orphanSkipReason(orphan.role),
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
          reason: orphanSkipReason(orphan.role),
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
      c === 'FEE' ||
      c === 'CREDIT'
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

  annotateEditedActivities(activities, editedRowIndices);
  annotateChangedGroups(activities, touchedOrderIds);

  const summary = summarize(rows.length, outcomes, activities);
  return { outcomes, activities, summary };
}

/**
 * Mark every activity that draws on a reviewer-edited source row.
 *
 * The warning keeps edits visible in the review counts and the reconcile step;
 * it never invalidates the draft, and it is not part of the fingerprint, so an
 * edited activity still matches its previously-imported twin when the corrected
 * values are identical.
 */
function annotateEditedActivities(
  activities: ActivityDraft[],
  editedRowIndices: Set<number>,
): void {
  if (editedRowIndices.size === 0) return;
  for (const a of activities) {
    if (!a.sourceRowNumbers.some((n) => editedRowIndices.has(n))) continue;
    a.warnings = {
      ...a.warnings,
      [SOURCE_EDITED_WARNING]: ['Built from source values you edited during review'],
    };
  }
}

/**
 * Mark every activity whose order group contains a row the reviewer changed.
 *
 * `annotateEditedActivities` is not enough here. An activity's
 * `sourceRowNumbers` lists only its trade and fee rows, and a changed row may
 * not be among them at all: an ignored row is dropped before grouping, an edit
 * can reclassify a fill out of its group entirely. In each case the trade's
 * quantity, amount, or fee can move while the activity still reviews as clean.
 *
 * Keyed on the order id, which is not editable, so a row cannot change which
 * group it is accounted against. Rows with no order id are excluded: each forms
 * its own single-row group and cannot affect another activity.
 */
function annotateChangedGroups(activities: ActivityDraft[], touchedOrderIds: Set<string>): void {
  if (touchedOrderIds.size === 0) return;
  for (const a of activities) {
    const orderId = a.group?.orderId;
    if (!orderId || !touchedOrderIds.has(orderId)) continue;
    a.warnings = {
      ...a.warnings,
      [GROUP_ROW_CHANGED_WARNING]: [
        'You changed another row of this order — its quantity, amount, or fee may be incomplete',
      ],
    };
  }
}

/**
 * Skip reason for a group row that yielded no activity.
 *
 * `trade` only arises when a group's fills sum to zero quantity, so there is no
 * economic movement to record; `tax` only arises for a positive (reversal) FTT
 * row, which nets against its paid counterpart.
 */
function orphanSkipReason(role: OrphanRole): SkipReason {
  switch (role) {
    case 'fx':
      return 'fx-helper';
    case 'fee':
    case 'accrued':
      return 'orphan-trade-fee';
    case 'tax':
      return 'positive-reversal';
    case 'trade':
      return 'zero-amount';
  }
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
