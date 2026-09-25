/**
 * Occurrence numbering for genuinely repeated statement activities.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * DEGIRO sometimes books the same event several times on one day — e.g. three
 * identical dividend credits of one security at different times, each raising
 * the cash balance. Wealthfolio 3.6.1's import duplicate key is day-level
 * (type, UTC day, asset, quantity, price, amount, fee, currency, comment), so
 * it keeps only the first of those and silently drops the rest.
 *
 * Numbering the repeats lets the adapter give the 2nd and later copies a
 * distinct comment (`… #2`), which makes their host keys distinct. The first
 * copy keeps its comment unchanged, so it still matches copies stored by
 * earlier imports. Numbering is by input order within a key, which is stable
 * across exports because a statement lists a day's rows in a fixed order.
 */

import type { ActivityDraft } from '../domain/activity-draft';

/**
 * Types Wealthfolio always stores as cash: it clears their symbol before
 * computing the duplicate key, so the security must not separate them here
 * (e.g. equal dividend tax on two securities on one day).
 */
const HOST_CASH_TYPES: ReadonlySet<string> = new Set([
  'DEPOSIT',
  'WITHDRAWAL',
  'FEE',
  'TAX',
  'CREDIT',
]);

function hostLikeKey(a: ActivityDraft): string {
  const d = new Date(a.date);
  const day = Number.isNaN(d.getTime()) ? a.date : d.toISOString().slice(0, 10);
  return [
    a.activityType,
    day,
    HOST_CASH_TYPES.has(a.activityType) ? '' : (a.isin ?? a.symbol).toUpperCase(),
    a.quantity,
    a.unitPrice,
    a.amount,
    a.fee,
    a.currency,
    (a.comment ?? '').trim(),
  ].join('|');
}

/**
 * 1-based occurrence of each activity among activities that Wealthfolio would
 * consider the same. `1` for every activity that is not repeated.
 */
export function repeatOccurrences(activities: readonly ActivityDraft[]): number[] {
  const seen = new Map<string, number>();
  return activities.map((a) => {
    const key = hostLikeKey(a);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n;
  });
}

/** The comment for the `occurrence`-th copy of a repeated activity. */
export function occurrenceComment(
  comment: string | undefined,
  occurrence: number,
): string | undefined {
  if (occurrence <= 1) return comment;
  return `${comment?.trim() ? `${comment.trim()} ` : ''}#${occurrence}`;
}
