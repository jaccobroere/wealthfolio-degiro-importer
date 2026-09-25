/**
 * Content-based matching of statement activities against the activities that
 * already exist on the destination account.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. The adapter maps host
 * activities to `ExistingActivityLike` before calling in.
 *
 * Why this exists: a DEGIRO export is usually re-imported as a full history
 * on top of an earlier import. Neither earlier safety net survives that:
 *
 * - the idempotency fingerprint anchors source row numbers, and every new
 *   row at the top of a newer export shifts them all; and
 * - Wealthfolio 3.6.1's import duplicate key hashes the asset reference,
 *   which is `SYMBOL@MIC` while an asset does not exist yet and its UUID once
 *   it does, so the same activity yields two different keys across imports.
 *
 * Matching therefore uses only what is stable across exports and asset
 * states: activity type, UTC day, currency, and the economic value
 * (quantity + trade value for BUY/SELL, amount otherwise). It is a multiset
 * match — three identical fees on one day in the file consume at most three
 * identical existing fees — so genuinely repeated bookkeeping rows survive.
 *
 * Asset identity is a tie-breaker, not part of the key: an existing activity
 * linked to the same symbol is preferred; one with no asset at all (left by
 * earlier add-on versions that imported before the security existed) is
 * accepted next; one linked to a different security never matches.
 */

import { Decimal } from 'decimal.js';

import type { ActivityType } from '../domain/activity-draft';

/** Minimal view of an activity already stored on the account. */
export interface ExistingActivityLike {
  id: string;
  activityType: string;
  /** ISO timestamp (or anything `new Date()` accepts). */
  date: string | Date;
  quantity?: string | null;
  unitPrice?: string | null;
  amount?: string | null;
  currency: string;
  /** Linked asset symbol; empty or missing when the activity has no asset. */
  assetSymbol?: string | null;
  assetId?: string | null;
  assetName?: string | null;
  exchangeMic?: string | null;
}

/** Minimal view of a statement activity to be matched. */
export interface MatchableActivity {
  activityType: ActivityType;
  date: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  currency: string;
  /** Reviewed canonical symbol for instrument activities; undefined for cash. */
  assetSymbol?: string;
}

/** How one statement activity relates to the account. */
export type ExistingMatch =
  | { kind: 'new' }
  /** Already on the account, linked to the same security (or both cash). */
  | { kind: 'existing'; existingId: string }
  /** Already on the account, but that copy has no security linked. */
  | { kind: 'existing-unlinked'; existingId: string };

export interface ExistingMatchReport {
  /** One entry per input activity, in input order. */
  matches: ExistingMatch[];
  /**
   * Account activities that share type, day, currency and value with an
   * activity in this statement, but are left over after every statement
   * activity has been matched — i.e. extra copies of the same event.
   */
  extraCopies: ExistingActivityLike[];
  counts: {
    new: number;
    existing: number;
    existingUnlinked: number;
    extraCopies: number;
  };
}

/** Activity types whose Wealthfolio representation carries a security. */
const ASSET_BACKED_TYPES: ReadonlySet<string> = new Set(['BUY', 'SELL', 'DIVIDEND']);

function dec(value: string | null | undefined): Decimal | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined;
  try {
    return new Decimal(value).abs();
  } catch {
    return undefined;
  }
}

function utcDay(date: string | Date): string | undefined {
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** The economic value compared for a given activity type. */
function valuePart(
  activityType: string,
  quantity: string | null | undefined,
  unitPrice: string | null | undefined,
  amount: string | null | undefined,
): string | undefined {
  const qty = dec(quantity);
  const price = dec(unitPrice);
  const amt = dec(amount);
  if (activityType === 'BUY' || activityType === 'SELL') {
    if (!qty) return undefined;
    const value = price ? qty.times(price) : amt;
    if (!value) return undefined;
    return `q=${qty.toString()}|v=${value.toDecimalPlaces(2).toFixed(2)}`;
  }
  const value = amt && !amt.isZero() ? amt : qty && price ? qty.times(price) : amt;
  if (!value) return undefined;
  return `v=${value.toDecimalPlaces(2).toFixed(2)}`;
}

/** Content key shared by a statement activity and its stored copy. */
export function contentKey(a: {
  activityType: string;
  date: string | Date;
  quantity?: string | null;
  unitPrice?: string | null;
  amount?: string | null;
  currency: string;
}): string | undefined {
  const day = utcDay(a.date);
  const value = valuePart(a.activityType, a.quantity, a.unitPrice, a.amount);
  if (!day || !value) return undefined;
  return [a.activityType.toUpperCase(), day, a.currency.trim().toUpperCase(), value].join('|');
}

function normSymbol(symbol: string | null | undefined): string {
  return (symbol ?? '').trim().toUpperCase();
}

/** True when a stored activity has no security linked. */
export function isUnlinked(e: ExistingActivityLike): boolean {
  return normSymbol(e.assetSymbol) === '' && (e.assetId ?? '').trim() === '';
}

/** True for an asset-backed activity stored without its security. */
export function isOrphanedAssetActivity(e: ExistingActivityLike): boolean {
  return ASSET_BACKED_TYPES.has(e.activityType.toUpperCase()) && isUnlinked(e);
}

/**
 * Match statement activities against the account's existing activities.
 *
 * Deterministic: statement activities are matched in input order, and within
 * a content key existing activities are consumed in their given order.
 */
export function matchExistingActivities(
  activities: readonly MatchableActivity[],
  existing: readonly ExistingActivityLike[],
): ExistingMatchReport {
  const byKey = new Map<string, ExistingActivityLike[]>();
  for (const e of existing) {
    const key = contentKey(e);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }

  const consumed = new Set<string>();
  const matches: ExistingMatch[] = activities.map(() => ({ kind: 'new' }));
  const keys = activities.map((a) => contentKey(a));

  // Pass 1: same security (or both cash). Pass 2: one side has no security.
  for (const pass of [1, 2] as const) {
    activities.forEach((a, i) => {
      if (matches[i]!.kind !== 'new') return;
      const key = keys[i];
      if (!key) return;
      const wanted = normSymbol(a.assetSymbol);
      const candidate = byKey.get(key)?.find((e) => {
        if (consumed.has(e.id)) return false;
        const have = isUnlinked(e) ? '' : normSymbol(e.assetSymbol);
        if (pass === 1) return have === wanted;
        return (have === '') !== (wanted === '');
      });
      if (!candidate) return;
      consumed.add(candidate.id);
      matches[i] =
        wanted !== '' && isUnlinked(candidate)
          ? { kind: 'existing-unlinked', existingId: candidate.id }
          : { kind: 'existing', existingId: candidate.id };
    });
  }

  // Extra copies: unconsumed entries sharing a key with a matched activity
  // and compatible with its security. A same-value activity on a different
  // security is a different event, not a copy.
  const matchedSymbolsByKey = new Map<string, Set<string>>();
  matches.forEach((m, i) => {
    const key = keys[i];
    if (m.kind === 'new' || !key) return;
    const set = matchedSymbolsByKey.get(key) ?? new Set<string>();
    set.add(normSymbol(activities[i]!.assetSymbol));
    matchedSymbolsByKey.set(key, set);
  });
  const extraCopies: ExistingActivityLike[] = [];
  for (const [key, symbols] of matchedSymbolsByKey) {
    for (const e of byKey.get(key) ?? []) {
      if (consumed.has(e.id)) continue;
      if (isUnlinked(e) || symbols.has(normSymbol(e.assetSymbol))) extraCopies.push(e);
    }
  }

  return {
    matches,
    extraCopies,
    counts: {
      new: matches.filter((m) => m.kind === 'new').length,
      existing: matches.filter((m) => m.kind === 'existing').length,
      existingUnlinked: matches.filter((m) => m.kind === 'existing-unlinked').length,
      extraCopies: extraCopies.length,
    },
  };
}
