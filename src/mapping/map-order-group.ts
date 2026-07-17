/**
 * Order-id group mapping: aggregate partial fills, derive a cash-consistent
 * effective unit price, merge broker fees, and emit accrued-interest cash
 * settlements without changing the BUY's cost basis.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. All arithmetic uses
 * `decimal.js` over decimal strings.
 */

import { Decimal } from 'decimal.js';
import type { DegiroRow } from '../domain/degiro-row';
import { type ActivityDraft, type GroupProvenance, cashSymbol } from '../domain/activity-draft';
import { changeAmount, classifyRow, parseTradeDescription } from './classify-row';
import { tryParseDegiroDecimal } from '../parser/parse-decimal';
import { toIsoDate } from '../parser/parse-date';

/** Roles a row can play within an order-id group. */
export type GroupMemberRole = 'trade' | 'fee' | 'accrued-interest' | 'fx' | 'tax';

export interface GroupMember {
  row: DegiroRow;
  role: GroupMemberRole;
}

export interface OrderGroupResult {
  /** Activities derived from this group (1 trade + 0..n FTT tax activities). */
  activities: ActivityDraft[];
  /** Per-row membership record (rowIndex → activityIndex + role). */
  memberships: { rowIndex: number; activityIndex: number; role: GroupMemberRole }[];
  /** Rows in this group that are skipped as orphan (no parent trade). */
  orphanSkips: { rowIndex: number; role: 'trade' | 'fx' | 'fee' | 'tax' }[];
}

/**
 * Process all rows sharing one order id. Produces one aggregated BUY/SELL
 * activity (partial fills summed with Decimal, effective unit price derived from
 * authoritative mutation totals, broker fees merged and currency-converted), one
 * cash settlement for accrued interest, and one TAX activity per in-group FTT charge.
 */
export function mapOrderGroup(rows: DegiroRow[], activityIndexOffset: number): OrderGroupResult {
  const activities: ActivityDraft[] = [];
  const memberships: OrderGroupResult['memberships'] = [];
  const orphanSkips: OrderGroupResult['orphanSkips'] = [];

  const tradeRows: DegiroRow[] = [];
  const feeRows: DegiroRow[] = [];
  const accruedRows: DegiroRow[] = [];
  const fxRows: DegiroRow[] = [];
  const taxRows: DegiroRow[] = [];

  for (const row of rows) {
    const c = classifyRow(row).kind;
    if (c === 'BUY' || c === 'SELL') tradeRows.push(row);
    else if (c === 'TRADE_FEE') feeRows.push(row);
    else if (c === 'ACCRUED_INTEREST') accruedRows.push(row);
    else if (c === 'FX') fxRows.push(row);
    else if (c === 'TAX') taxRows.push(row);
    // Other kinds should not appear in an order-id group; ignore defensively.
  }

  if (tradeRows.length === 0) {
    // Orphan group (FX/fee/tax rows carrying an order id but no parent trade).
    for (const row of fxRows) orphanSkips.push({ rowIndex: row.rowIndex, role: 'fx' });
    for (const row of feeRows) orphanSkips.push({ rowIndex: row.rowIndex, role: 'fee' });
    for (const row of taxRows) orphanSkips.push({ rowIndex: row.rowIndex, role: 'tax' });
    return { activities, memberships, orphanSkips };
  }

  const firstTrade = tradeRows[0];
  const tradeKind = classifyRow(firstTrade).kind as 'BUY' | 'SELL';
  const isin = firstTrade.isin;
  const product = firstTrade.product;
  const symbol = isin || product;

  // Aggregate partial fills with Decimal.
  let totalQty = new Decimal(0);
  let totalAmount = new Decimal(0);
  let currency = 'EUR';
  for (const row of tradeRows) {
    const info = parseTradeDescription(row.description);
    if (!info) continue;
    totalQty = totalQty.plus(info.quantity);
    totalAmount = totalAmount.plus((changeAmount(row) ?? new Decimal(0)).abs());
    currency = info.currency;
  }

  if (totalQty.isZero()) {
    // No usable quantity — treat trade rows as orphan skips defensively.
    for (const row of tradeRows) orphanSkips.push({ rowIndex: row.rowIndex, role: 'trade' });
    return { activities, memberships, orphanSkips };
  }

  // Effective unit price from authoritative mutation totals.
  const unitPrice = totalAmount.div(totalQty);

  // Merge broker fees (always EUR on the statement; convert to trade currency
  // for non-EUR trades using the group's FX rate).
  let totalFee = feeRows.reduce(
    (s, r) => s.plus((changeAmount(r) ?? new Decimal(0)).abs()),
    new Decimal(0),
  );
  let fxRate: Decimal | undefined;
  if (currency !== 'EUR') {
    const fxRow = fxRows.find((r) => {
      const fx = tryParseDegiroDecimal(r.fxRaw);
      return fx && fx.isPositive();
    });
    if (fxRow) {
      fxRate = tryParseDegiroDecimal(fxRow.fxRaw) ?? undefined;
      if (fxRate) totalFee = totalFee.mul(fxRate);
    }
  }

  // Accrued interest provenance (Meegekochte Rente).
  let accrued:
    | {
        sourceRowNumbers: number[];
        totalAmount: Decimal;
        currency: string;
      }
    | undefined;
  if (accruedRows.length > 0) {
    const sum = accruedRows.reduce(
      (s, r) => s.plus(changeAmount(r) ?? new Decimal(0)),
      new Decimal(0),
    );
    accrued = {
      sourceRowNumbers: accruedRows.map((r) => r.rowIndex),
      totalAmount: sum,
      currency: accruedRows[0].changeCurrency || 'EUR',
    };
  }

  const tradeSourceRowNumbers = tradeRows.map((r) => r.rowIndex);
  const feeSourceRowNumbers = feeRows.map((r) => r.rowIndex);

  const group: GroupProvenance = {
    orderId: firstTrade.orderId,
    tradeSourceRowNumbers,
    feeSourceRowNumbers,
    fillCount: tradeRows.length,
    ...(fxRate ? { fxRate: fxRate.toString() } : {}),
    ...(accrued
      ? {
          accruedInterest: {
            sourceRowNumbers: accrued.sourceRowNumbers,
            totalAmount: accrued.totalAmount.toString(),
            currency: accrued.currency,
          },
        }
      : {}),
  };

  const tradeActivityIndex = activityIndexOffset + activities.length;
  const commentParts = tradeRows.map((r) => r.description).filter(Boolean);
  const tradeActivity: ActivityDraft = {
    date: toIsoDate(firstTrade.date, firstTrade.time),
    ...(isin ? { isin } : {}),
    symbol,
    ...(product ? { symbolName: product } : {}),
    quantity: totalQty.toString(),
    activityType: tradeKind,
    unitPrice: unitPrice.toString(),
    currency,
    fee: totalFee.toString(),
    amount: totalAmount.toString(),
    comment: commentParts.join(' | '),
    sourceRowNumbers: [...tradeSourceRowNumbers, ...feeSourceRowNumbers],
    group,
    isValid: !!symbol,
    errors: symbol ? {} : { symbol: ['No symbol found for this trade'] },
    warnings: {},
  };
  activities.push(tradeActivity);

  // Wealthfolio 3.6.1 has no accrued-interest field on a BUY. Keep the
  // principal and purchase cost basis intact, and represent the broker's cash
  // settlement separately. A positive amount is a reversal/refund, so it is a
  // CREDIT rather than a negative fee.
  const accruedSettlementActivityIndex = accrued
    ? activityIndexOffset + activities.length
    : undefined;
  if (accrued) {
    const settlementAmount = accrued.totalAmount.abs();
    activities.push({
      date: toIsoDate(firstTrade.date, firstTrade.time),
      symbol: cashSymbol(accrued.currency),
      quantity: '1',
      activityType: accrued.totalAmount.isNegative() ? 'FEE' : 'CREDIT',
      unitPrice: settlementAmount.toString(),
      currency: accrued.currency,
      fee: '0',
      amount: settlementAmount.toString(),
      comment: 'DEGIRO accrued interest settlement on bond purchase',
      sourceRowNumbers: accrued.sourceRowNumbers,
      group,
      accruedInterest: {
        sourceRowNumbers: accrued.sourceRowNumbers,
        totalAmount: accrued.totalAmount.toString(),
        currency: accrued.currency,
      },
      isValid: true,
      errors: {},
      warnings: {},
    });
  }

  // One membership per contributing row, with its precise role.
  for (const row of tradeRows) {
    memberships.push({ rowIndex: row.rowIndex, activityIndex: tradeActivityIndex, role: 'trade' });
  }
  for (const row of feeRows) {
    memberships.push({ rowIndex: row.rowIndex, activityIndex: tradeActivityIndex, role: 'fee' });
  }
  for (const row of accruedRows) {
    memberships.push({
      rowIndex: row.rowIndex,
      activityIndex: accruedSettlementActivityIndex ?? tradeActivityIndex,
      role: 'accrued-interest',
    });
  }
  for (const row of fxRows) {
    memberships.push({ rowIndex: row.rowIndex, activityIndex: tradeActivityIndex, role: 'fx' });
  }

  // In-group French FTT (`transactiebelasting`) → one TAX activity per paid row.
  // (Dividend withholding tax never carries an order id and is handled standalone.)
  for (const row of taxRows) {
    const taxActivity = buildGroupTaxActivity(row);
    if (taxActivity) {
      const idx = activityIndexOffset + activities.length;
      activities.push(taxActivity);
      memberships.push({ rowIndex: row.rowIndex, activityIndex: idx, role: 'tax' });
    }
  }

  return { activities, memberships, orphanSkips };
}

/** Build a TAX activity for a single FTT (`transactiebelasting`) row. */
export function buildGroupTaxActivity(row: DegiroRow): ActivityDraft | null {
  const amt = changeAmount(row);
  if (!amt || !amt.isNegative()) return null; // only paid (negative) FTT
  const abs = amt.abs();
  const currency = row.changeCurrency || 'EUR';
  const isin = row.isin;
  return {
    date: toIsoDate(row.date, row.time),
    ...(isin ? { isin } : {}),
    symbol: isin || row.product || cashSymbol(currency),
    ...(row.product ? { symbolName: row.product } : {}),
    quantity: '1',
    activityType: 'TAX',
    unitPrice: abs.toString(),
    currency,
    fee: '0',
    amount: abs.toString(),
    comment: [row.description, row.product].filter(Boolean).join(' '),
    sourceRowNumbers: [row.rowIndex],
    isValid: true,
    errors: {},
    warnings: {},
  };
}
