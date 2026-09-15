/**
 * Reviewer overrides applied to source rows during the review step.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * The importer never silently drops or guesses a row. When a row is
 * unrecognized or malformed the reviewer has exactly two explicit escapes:
 *
 *  - `ignore` — the row is excluded from the import and accounted as a
 *    `user-ignored` known-skip, so row conservation still holds and the count
 *    stays visible in every summary.
 *  - `edit`   — the reviewer corrects field values in place; the patched row is
 *    re-classified and re-validated by the normal pipeline. Activities derived
 *    from an edited row carry a `sourceEdited` warning so the change stays
 *    auditable all the way to the reconcile step.
 *
 * Overrides live in wizard state only. They are re-applied to the pristine
 * parsed rows on every rebuild and are never written back to the user's CSV.
 */

import type { DegiroRow } from './degiro-row';

/**
 * Source fields a reviewer may correct.
 *
 * Covers every field `validateRow` can reject plus every field the classifier
 * and mappers read. `orderId` is deliberately excluded: re-keying an order
 * group would silently merge or split trades. `valueDate` and `balanceCurrency`
 * are excluded because nothing downstream reads them.
 */
export type EditableField =
  | 'date'
  | 'time'
  | 'product'
  | 'isin'
  | 'description'
  | 'fxRaw'
  | 'changeCurrency'
  | 'changeAmountRaw'
  | 'balanceAmountRaw';

/** Ordered most- to least-commonly corrected; the editor renders them in order. */
export const EDITABLE_FIELDS: readonly EditableField[] = [
  'description',
  'changeAmountRaw',
  'changeCurrency',
  'isin',
  'product',
  'date',
  'time',
  'fxRaw',
  'balanceAmountRaw',
];

/** Human-readable labels for the editor UI. */
export const EDITABLE_FIELD_LABELS: Record<EditableField, string> = {
  date: 'Date (DD-MM-YYYY)',
  time: 'Time (HH:MM)',
  description: 'Description',
  product: 'Product',
  isin: 'ISIN',
  changeCurrency: 'Change currency',
  changeAmountRaw: 'Change amount',
  fxRaw: 'FX rate',
  balanceAmountRaw: 'Balance amount',
};

/** A partial set of corrected field values for one source row. */
export type RowPatch = Partial<Record<EditableField, string>>;

/** What the reviewer decided to do with one source row. */
export type RowOverride = { kind: 'ignore' } | { kind: 'edit'; patch: RowPatch };

/** Overrides keyed by 1-based source row number. */
export type RowOverrides = Readonly<Record<number, RowOverride>>;

/** Fields in `patch` whose value actually differs from the row's current value. */
export function changedFields(row: DegiroRow, patch: RowPatch): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => {
    const next = patch[f];
    return next !== undefined && next !== row[f];
  });
}

/** Apply a patch to a row, returning a new row. Unknown/equal fields are ignored. */
export function applyRowPatch(row: DegiroRow, patch: RowPatch): DegiroRow {
  const next: DegiroRow = { ...row };
  for (const f of changedFields(row, patch)) {
    next[f] = patch[f] as string;
  }
  return next;
}

/**
 * Reduce a patch to the fields that actually change the row.
 *
 * Returns `null` when the patch is a no-op, so callers can drop the override
 * entirely instead of recording an edit that changes nothing.
 */
export function normalizePatch(row: DegiroRow, patch: RowPatch): RowPatch | null {
  const changed = changedFields(row, patch);
  if (changed.length === 0) return null;
  const out: RowPatch = {};
  for (const f of changed) out[f] = patch[f] as string;
  return out;
}
