/**
 * Pure activity-draft model produced by the DEGIRO mapper.
 *
 * No React, no `Wealthfolio addon SDK`. The shape mirrors the Wealthfolio
 * 3.6.1 `ActivityImport`/`ActivityCreate` contract closely enough that the host
 * adapter (T06/T09) can convert 1:1, but every monetary field is a decimal
 * STRING so arithmetic stays exact through the pure core.
 */

/** Wealthfolio activity types emitted by this importer. */
export type ActivityType =
  'BUY' | 'SELL' | 'DIVIDEND' | 'TAX' | 'DEPOSIT' | 'WITHDRAWAL' | 'INTEREST' | 'FEE';

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  'BUY',
  'SELL',
  'DIVIDEND',
  'TAX',
  'DEPOSIT',
  'WITHDRAWAL',
  'INTEREST',
  'FEE',
];

/**
 * Accrued-interest provenance for `Meegekochte Rente` rows attached to a BUY.
 *
 * T03 preserves these faithfully; T09 decides whether Wealthfolio must receive
 * the amount folded into the BUY `amount`, `fee`, or another field. Until then
 * a draft carrying accrued interest is blocked from production import.
 */
export interface AccruedInterestProvenance {
  /** 1-based source row numbers of the contributing `Meegekochte Rente` rows. */
  sourceRowNumbers: number[];
  /** Summed accrued-interest amount as a decimal string (negative = paid). */
  totalAmount: string;
  currency: string;
}

/** Grouping provenance for an activity derived from order-id bucketed rows. */
export interface GroupProvenance {
  orderId: string;
  /** 1-based source row numbers of the BUY/SELL trade rows. */
  tradeSourceRowNumbers: number[];
  /** 1-based source row numbers of `Transactiekosten` fee rows merged in. */
  feeSourceRowNumbers: number[];
  /** Accrued interest attached to this order, if any. */
  accruedInterest?: AccruedInterestProvenance;
  /**
   * FX rate (trade currency per EUR) consumed from a `Valuta` row in this
   * group, as a decimal string. Present for non-EUR trades.
   */
  fxRate?: string;
  /** Number of trade (partial-fill) rows aggregated into this activity. */
  fillCount: number;
}

/**
 * A normalized activity awaiting host conversion. All money/quantity fields are
 * decimal strings; `unitPrice` is the cash-consistent effective price derived
 * from authoritative mutation totals.
 */
export interface ActivityDraft {
  /** ISO 8601 timestamp with Europe/Amsterdam offset. */
  date: string;
  isin?: string;
  /** Resolved symbol; `$CASH-<CCY>` for cash movements. */
  symbol: string;
  symbolName?: string;
  /** Decimal string. */
  quantity: string;
  activityType: ActivityType;
  /** Decimal string (effective unit price). */
  unitPrice: string;
  currency: string;
  /** Decimal string (broker fees, already currency-converted). */
  fee: string;
  /** Decimal string (absolute economic amount). */
  amount: string;
  comment?: string;
  /** 1-based source row numbers that produced this activity. */
  sourceRowNumbers: number[];
  /** Present when this activity was derived from an order-id group. */
  group?: GroupProvenance;
  /** Present on BUY drafts that carry `Meegekochte Rente`. */
  accruedInterest?: AccruedInterestProvenance;
  isValid: boolean;
  errors: Record<string, string[]>;
  warnings: Record<string, string[]>;
}

/** Cash pseudo-symbol for a currency, e.g. `$CASH-EUR`. */
export function cashSymbol(currency: string): string {
  return `$CASH-${currency}`;
}

/** True for a real instrument symbol (not a `$CASH-…` pseudo-symbol). */
export function isInstrumentSymbol(symbol: string | undefined): symbol is string {
  return !!symbol && !symbol.startsWith('$CASH-');
}
