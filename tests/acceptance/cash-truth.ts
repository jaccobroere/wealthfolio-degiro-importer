import { Decimal } from 'decimal.js';
import { readFileSync } from 'node:fs';
import { parseAndMap } from '../../src/parser/parse-and-map';
import { parseDegiroDecimal } from '../../src/parser/parse-decimal';

/** Local full-history truth signal. Never return sensitive values in diagnostics. */
export function loadCashTruth() {
  const path = process.env.DEGIRO_ACCEPTANCE_CSV;
  if (!path) throw new Error('DEGIRO_ACCEPTANCE_CSV is required.');
  const result = parseAndMap(readFileSync(path, 'utf8'));
  const { parsed, batch, reconciliation } = result;
  // Each activity must conserve the signed cash mutations of its source rows,
  // independently of classification and reconciliation's arithmetic.
  const byRow = new Map(parsed.rows.map((r) => [r.rowIndex, r]));
  const outflows = new Set(['BUY', 'FEE', 'TAX', 'WITHDRAWAL', 'TRANSFER_OUT']);
  const mutationsConserved = batch.activities.every((a) => {
    const source = a.sourceRowNumbers.reduce((sum, n) => {
      const row = byRow.get(n)!;
      return sum.plus(parseDegiroDecimal(row.changeAmountRaw));
    }, new Decimal(0));
    const amount = new Decimal(a.amount);
    const effect = (outflows.has(a.activityType) ? amount.negated() : amount).minus(a.fee);
    return effect.eq(source);
  });
  // CSV order is newest first. Flatex bank summaries have a separate ledger
  // from historical trading/MMF balances; the latest bank balance is the
  // consolidated EUR cash target, not the last historic trading balance.
  const bank = parsed.rows.find((r) => r.description.toLowerCase().startsWith('overboeking'));
  if (!bank) throw new Error('Cash acceptance requires a Flatex bank balance.');
  const targets = new Map([[bank.balanceCurrency, parseDegiroDecimal(bank.balanceAmountRaw)]]);
  for (const cash of reconciliation.cashByCurrency) {
    if (targets.has(cash.currency)) continue;
    const latest = parsed.rows.find((r) => r.balanceCurrency === cash.currency);
    if (!latest) throw new Error('Cash acceptance requires a currency balance.');
    targets.set(cash.currency, parseDegiroDecimal(latest.balanceAmountRaw));
  }
  const matchesTargets = (totals: Map<string, Decimal>) =>
    [...targets].every(([currency, target]) =>
      (totals.get(currency) ?? new Decimal(0))
        .minus(target)
        .abs()
        .lte(currency === bank.balanceCurrency ? '0' : '0.01'),
    );
  return { ...result, mutationsConserved, matchesTargets };
}
