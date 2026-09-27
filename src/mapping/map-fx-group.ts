import { Decimal } from 'decimal.js';
import { cashSymbol, type ActivityDraft } from '../domain/activity-draft';
import type { DegiroRow } from '../domain/degiro-row';
import { toIsoDate } from '../parser/parse-date';
import { changeAmount } from './classify-row';

/** Two cash legs per conversion; partial fills are combined in their own currency. */
export function mapFxGroup(rows: DegiroRow[]): ActivityDraft[] {
  const currencies = new Map<string, { amount: Decimal; rows: number[] }>();
  for (const row of rows) {
    const amount = changeAmount(row);
    if (!amount || amount.isZero() || !row.changeCurrency) return [];
    const leg = currencies.get(row.changeCurrency) ?? { amount: new Decimal(0), rows: [] };
    // A currency changing direction in one bucket is ambiguous, not a valid pair.
    if (!leg.amount.isZero() && leg.amount.isNegative() !== amount.isNegative()) return [];
    leg.amount = leg.amount.plus(amount);
    leg.rows.push(row.rowIndex);
    currencies.set(row.changeCurrency, leg);
  }
  const legs = [...currencies];
  if (legs.length !== 2 || legs[0][1].amount.isNegative() === legs[1][1].amount.isNegative())
    return [];
  const first = rows[0];
  const date = toIsoDate(first.date, first.time);
  const sourceGroupId = `degiro-fx:${first.orderId || `${date}:${first.valueDate}`}`;
  return legs.map(([currency, leg]) => ({
    sourceGroupId,
    date,
    symbol: cashSymbol(currency),
    activityType: leg.amount.isNegative() ? 'TRANSFER_OUT' : 'TRANSFER_IN',
    quantity: '0',
    unitPrice: '0',
    amount: leg.amount.abs().toString(),
    currency,
    fee: '0',
    comment: 'DEGIRO currency conversion',
    sourceRowNumbers: leg.rows,
    isValid: true,
    errors: {},
    warnings: {},
  }));
}
