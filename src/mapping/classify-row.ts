/**
 * Row classification for DEGIRO account-statement rows.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * Both the trade regexes and downstream numeric parsing accept `.` and `,`
 * (Dutch locale). The classifier never converts numbers itself — it only
 * decides the row kind and, for skips, the narrow allow-listed reason. Any row
 * that matches no activity kind and no skip rule becomes `UNKNOWN` which the
 * batch turns into an `unsupported` outcome that blocks the import.
 */

import { Decimal } from 'decimal.js';
import {
  FLATEX_ACCOUNT_ISIN,
  MONEY_MARKET_FUND_ISIN,
  type DegiroRow,
} from '../domain/degiro-row';
import { tryParseDegiroDecimal } from '../parser/parse-decimal';
import type { SkipReason } from '../domain/skip-reason';

export type RowKind =
  | 'BUY'
  | 'SELL'
  | 'TRADE_FEE'
  | 'TAX'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'DIVIDEND'
  | 'INTEREST'
  | 'FEE'
  | 'FX'
  | 'ACCRUED_INTEREST'
  | { kind: 'KNOWN_SKIP'; reason: SkipReason }
  | 'UNKNOWN';

export interface Classification {
  kind: RowKind;
}

/** Match "Koop 14 @ …" / "Verkoop 84 @ …" accepting `.` and `,` in the quantity. */
const TRADE_BUY_RE = /^koop\s+[\d.,]+\s+@/i;
const TRADE_SELL_RE = /^verkoop\s+[\d.,]+\s+@/i;

/** Change amount of the row as a Decimal (null when absent/unparseable). */
export function changeAmount(row: DegiroRow): Decimal | null {
  return tryParseDegiroDecimal(row.changeAmountRaw);
}

/** Classify a single parsed DEGIRO row. */
export function classifyRow(row: DegiroRow): Classification {
  const d = row.description;
  const low = d.toLowerCase();
  const amount = changeAmount(row);

  // ── ISIN-based skip: money-market fund (must precede trade/UNKNOWN rules so
  //    `conversie geldmarktfonds: koop …` noise is not misread as a trade). ─
  if (row.isin === MONEY_MARKET_FUND_ISIN) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'money-market-fund' } };
  }

  // ── Description-based known skips (narrow allow-list). These take precedence
  //    over the flatex-account ISIN fallback so e.g. `degiro cash sweep
  //    transfer` rows are labelled cash-sweep regardless of their ISIN. ──────
  if (low.includes('cash sweep transfer')) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'cash-sweep' } };
  }
  if (low.startsWith('overboeking')) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'flatex-internal-transfer' } };
  }
  if (low.startsWith('flatex terugstorting')) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'flatex-internal-transfer' } };
  }
  if (low.startsWith('reservation')) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'reservation-hold' } };
  }
  if (low.includes('wijziging isin') || low.startsWith('productwijziging')) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'isin-rename' } };
  }
  // Promotional welcome credit (no ISIN, no order id). v1 deferral.
  if (low === 'verrekening welkomstactie' || low.startsWith('verrekening welkomstactie')) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'promotional-credit' } };
  }
  // Cash-equivalent bond coupons (NL00… ISINs). v1 models equity dividends only.
  if (low === 'coupon') {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'cash-equivalent-coupon' } };
  }
  // Account-level interest bookkeeping with no ISIN; flatex interest rows carry
  // the modelled INTEREST activities.
  if (low === 'rente') {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'account-interest-bookkeeping' } };
  }

  // Flatex bank-account pseudo-ISIN fallback for rows not matched by description.
  if (row.isin === FLATEX_ACCOUNT_ISIN) {
    return { kind: { kind: 'KNOWN_SKIP', reason: 'flatex-internal-transfer' } };
  }

  // ── FX conversion legs ────────────────────────────────────────────────────
  if (low.startsWith('valuta debitering') || low.startsWith('valuta creditering')) {
    return { kind: 'FX' };
  }

  // ── Trades (accept Dutch thousands separator in the quantity) ─────────────
  if (TRADE_BUY_RE.test(d)) return { kind: 'BUY' };
  if (TRADE_SELL_RE.test(d)) return { kind: 'SELL' };

  // ── Accrued interest on a BUY order (preserved as provenance, never a fee) ─
  if (low.startsWith('meegekochte rente')) {
    return { kind: 'ACCRUED_INTEREST' };
  }

  // ── Broker transaction fees (merged into the parent trade) ────────────────
  if (low.includes('transactiekosten')) return { kind: 'TRADE_FEE' };

  // ── Taxes ──────────────────────────────────────────────────────────────────
  if (low.includes('transactiebelasting') || low.includes('dividendbelasting')) {
    return { kind: 'TAX' };
  }

  // ── Deposits ───────────────────────────────────────────────────────────────
  // Guard "terugstorting" (refund/withdrawal) from matching "storting".
  if (low.includes('storting') && !low.includes('terugstorting')) {
    return { kind: 'DEPOSIT' };
  }
  if (low.includes('deposit')) return { kind: 'DEPOSIT' };

  // ── Withdrawals (negative = money leaving; positive = reversal skip) ──────
  if (low.includes('processed flatex withdrawal')) {
    if (amount && amount.isNegative()) return { kind: 'WITHDRAWAL' };
    return { kind: { kind: 'KNOWN_SKIP', reason: 'positive-reversal' } };
  }
  if (low.includes('terugstorting') && !low.includes('flatex')) {
    if (amount && amount.isNegative()) return { kind: 'WITHDRAWAL' };
    return { kind: { kind: 'KNOWN_SKIP', reason: 'positive-reversal' } };
  }

  // ── Income ─────────────────────────────────────────────────────────────────
  if (low === 'dividend' || low.startsWith('dividend')) return { kind: 'DIVIDEND' };
  // Both "flatex interest" and "flatex interest income" (the latter is 0.00 and
  // becomes a zero-amount skip during standalone mapping).
  if (low.includes('flatex interest')) return { kind: 'INTEREST' };

  // ── Standalone fees ────────────────────────────────────────────────────────
  if (low.includes('aansluitingskosten')) return { kind: 'FEE' };
  if (low.includes('service-fee') || low.includes('service fee')) return { kind: 'FEE' };
  if (low.includes('b.t.w')) return { kind: 'FEE' };

  return { kind: 'UNKNOWN' };
}

/** Extract quantity, price and currency from a trade description. */
export interface TradeInfo {
  quantity: Decimal;
  price: Decimal;
  currency: string;
}

const TRADE_INFO_RE = /(?:koop|verkoop)\s+([\d.,]+)\s+@\s+([\d.,]+)\s+([A-Za-z]{3})/i;

/** Parse "Koop 14 @ 119,285 EUR" → { quantity, price, currency } using Dutch locale. */
export function parseTradeDescription(description: string): TradeInfo | null {
  const m = TRADE_INFO_RE.exec(description);
  if (!m) return null;
  const quantity = tryParseDegiroDecimal(m[1]);
  const price = tryParseDegiroDecimal(m[2]);
  if (!quantity || !price) return null;
  return { quantity, price, currency: m[3].toUpperCase() };
}
