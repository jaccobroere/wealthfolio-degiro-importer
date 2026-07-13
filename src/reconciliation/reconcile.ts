/**
 * Reconciliation: privacy-safe structural invariants over a batch.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. Reports net quantity per
 * instrument, cash-movement counts per currency, fees/taxes/accrued-interest
 * presence, known-internal-movement counts, and any residual/unaccounted rows.
 * Monetary totals are kept as Decimal strings but are NOT part of the locked
 * acceptance invariants (which are counts and presence flags only) to avoid
 * leaking personal monetary information.
 */

import { Decimal } from 'decimal.js';
import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchOutcome } from '../domain/import-outcome';
import type { SkipReason } from '../domain/skip-reason';

/** Net signed quantity per resolved instrument (ISIN or symbol). */
export interface QuantityPosition {
  key: string;
  isin?: string;
  symbol: string;
  /** BUY positive, SELL negative. */
  netQuantity: string;
  tradeActivityCount: number;
}

/** Cash-movement roll-up per currency. */
export interface CashRollup {
  currency: string;
  /** Sum of absolute activity amounts in this currency. */
  totalAbsoluteAmount: string;
  /** Net signed cash movement (deposits/interest/dividends positive, etc.). */
  netAmount: string;
  fees: string;
  taxes: string;
  accruedInterest: string;
  activityCount: number;
}

export interface Reconciliation {
  /** Net positions for instruments that had BUY/SELL activity. */
  positions: QuantityPosition[];
  /** Cash roll-up per currency touched by activities. */
  cashByCurrency: CashRollup[];
  /** Count of activities carrying accrued-interest provenance. */
  accruedInterestActivityCount: number;
  /** Total source rows behind accrued-interest provenance (should be 4). */
  accruedInterestSourceRowCount: number;
  /** Count of known-skip rows that still represent internal cash movements. */
  knownInternalMovementCount: number;
  /** Counts of known-skip rows by reason. */
  skipReasons: Record<string, number>;
  /** Source rows not mapped to any outcome (must be 0). */
  unaccountedCount: number;
  /** Count of grouped BUY drafts that carry accrued interest. */
  buyDraftsWithAccruedInterestCount: number;
}

const INTERNAL_CASH_SKIP_REASONS: ReadonlySet<SkipReason> = new Set<SkipReason>([
  'cash-sweep',
  'flatex-internal-transfer',
  'fx-helper',
]);

/** Compute reconciliation invariants from a batch outcome. */
export function reconcile(batch: BatchOutcome): Reconciliation {
  interface PositionAcc {
    key: string;
    isin?: string;
    symbol: string;
    net: Decimal;
    tradeActivityCount: number;
  }
  const positionsMap = new Map<string, PositionAcc>();
  const cashMap = new Map<
    string,
    {
      currency: string;
      totalAbs: Decimal;
      net: Decimal;
      fees: Decimal;
      taxes: Decimal;
      accrued: Decimal;
      count: number;
    }
  >();

  let accruedActivityCount = 0;
  const accruedSourceRows = new Set<number>();
  let buyWithAccrued = 0;

  for (const a of batch.activities) {
    // Positions: BUY/SELL only.
    if (a.activityType === 'BUY' || a.activityType === 'SELL') {
      const key = a.isin ?? a.symbol;
      const signed =
        a.activityType === 'BUY' ? new Decimal(a.quantity) : new Decimal(a.quantity).neg();
      const existing = positionsMap.get(key);
      if (existing) {
        existing.net = existing.net.plus(signed);
        existing.tradeActivityCount += 1;
      } else {
        positionsMap.set(key, {
          key,
          ...(a.isin ? { isin: a.isin } : {}),
          symbol: a.symbol,
          net: signed,
          tradeActivityCount: 1,
        });
      }
    }

    // Accrued interest presence (grouped BUY drafts).
    if (a.accruedInterest) {
      accruedActivityCount += 1;
      if (a.activityType === 'BUY') buyWithAccrued += 1;
      for (const r of a.accruedInterest.sourceRowNumbers) accruedSourceRows.add(r);
    }

    // Cash roll-up per currency.
    const cur = a.currency || 'EUR';
    const amount = new Decimal(a.amount);
    const fee = new Decimal(a.fee);
    const signedAmount = signedAmountFor(a, amount);
    const taxForThis = a.activityType === 'TAX' ? amount : new Decimal(0);
    const roll = cashMap.get(cur) ?? {
      currency: cur,
      totalAbs: new Decimal(0),
      net: new Decimal(0),
      fees: new Decimal(0),
      taxes: new Decimal(0),
      accrued: new Decimal(0),
      count: 0,
    };
    roll.totalAbs = roll.totalAbs.plus(amount);
    roll.net = roll.net.plus(signedAmount);
    roll.fees = roll.fees.plus(fee);
    roll.taxes = roll.taxes.plus(taxForThis);
    if (a.accruedInterest) {
      roll.accrued = roll.accrued.plus(new Decimal(a.accruedInterest.totalAmount).abs());
    }
    roll.count += 1;
    cashMap.set(cur, roll);
  }

  let knownInternalMovementCount = 0;
  const skipReasons: Record<string, number> = { ...batch.summary.skipReasons };
  for (const o of batch.outcomes) {
    if (o.kind === 'known-skip' && INTERNAL_CASH_SKIP_REASONS.has(o.reason)) {
      knownInternalMovementCount += 1;
    }
  }

  return {
    positions: Array.from(positionsMap.values()).map((p) => ({
      key: p.key,
      ...(p.isin ? { isin: p.isin } : {}),
      symbol: p.symbol,
      netQuantity: p.net.toString(),
      tradeActivityCount: p.tradeActivityCount,
    })),
    cashByCurrency: Array.from(cashMap.values()).map((c) => ({
      currency: c.currency,
      totalAbsoluteAmount: c.totalAbs.toString(),
      netAmount: c.net.toString(),
      fees: c.fees.toString(),
      taxes: c.taxes.toString(),
      accruedInterest: c.accrued.toString(),
      activityCount: c.count,
    })),
    accruedInterestActivityCount: accruedActivityCount,
    accruedInterestSourceRowCount: accruedSourceRows.size,
    knownInternalMovementCount,
    skipReasons,
    unaccountedCount: batch.summary.unaccountedCount,
    buyDraftsWithAccruedInterestCount: buyWithAccrued,
  };
}

/** Signed cash effect of an activity for net reconciliation. */
function signedAmountFor(a: ActivityDraft, amount: Decimal): Decimal {
  switch (a.activityType) {
    case 'DEPOSIT':
    case 'DIVIDEND':
    case 'INTEREST':
      return amount; // cash in
    case 'WITHDRAWAL':
    case 'FEE':
    case 'TAX':
      return amount.neg(); // cash out
    case 'BUY':
      return amount.neg(); // cash out for purchase
    case 'SELL':
      return amount; // cash in from sale
    default:
      return amount;
  }
}
