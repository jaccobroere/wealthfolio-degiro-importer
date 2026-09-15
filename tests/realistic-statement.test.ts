/**
 * Golden regression test for `tests/fixtures/degiro-realistic-statement.csv`.
 *
 * The fixture is a 200-row, fully synthetic account statement shaped like a real
 * multi-year DEGIRO export: reverse-chronological rows, Dutch-locale decimals,
 * EUR + USD ledgers, grouped and ungrouped trades, and the full breadth of
 * broker-bookkeeping noise the classifier has to account for. Everything in it
 * (instruments, amounts, dates, order ids) is invented; it exists so the repo has
 * one large, realistic conservation gate that CI and contributors can run.
 *
 * The assertions below are deliberately exact. A change in these numbers means a
 * classification or mapping rule moved, and that has to be a deliberate edit.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal } from 'decimal.js';
import { parseAndMap, parseAndMapWithFingerprints } from '../src/parser/parse-and-map';
import { tryParseDegiroDecimal } from '../src/parser/parse-decimal';
import { MONEY_MARKET_FUND_ISIN, type DegiroRow } from '../src/domain/degiro-row';
import { classifyRow } from '../src/mapping/classify-row';

const FIXTURE = join(__dirname, 'fixtures', 'degiro-realistic-statement.csv');
const CONTENT = readFileSync(FIXTURE, 'utf-8');

const { parsed, batch, reconciliation } = parseAndMap(CONTENT);

describe('realistic statement fixture — conservation', () => {
  it('parses every line as a well-formed 12-column row', () => {
    expect(parsed.headerVariant).toBe('dutch');
    expect(parsed.structuralErrors).toEqual([]);
    expect(parsed.rows).toHaveLength(200);
  });

  it('accounts for every source row exactly once, with nothing blocking', () => {
    expect(batch.summary.sourceRowCount).toBe(200);
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(batch.summary.unsupportedCount).toBe(0);
    expect(batch.summary.invalidCount).toBe(0);

    // One outcome per row, and no row claimed twice by two different rules.
    expect(batch.outcomes).toHaveLength(200);
    const seen = new Set(batch.outcomes.map((o) => o.rowIndex));
    expect(seen.size).toBe(200);
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });

  it('splits the rows into the reviewed outcome families', () => {
    expect(batch.summary.byOutcome).toEqual({
      activity: 63,
      'group-member': 57,
      'known-skip': 80,
      unsupported: 0,
      invalid: 0,
    });
  });
});

describe('realistic statement fixture — activity taxonomy', () => {
  it('produces the exact per-activity-type counts', () => {
    expect(batch.summary.activityCount).toBe(88);
    expect(batch.summary.byActivityType).toEqual({
      BUY: 14,
      SELL: 6,
      DIVIDEND: 13,
      TAX: 15,
      DEPOSIT: 12,
      WITHDRAWAL: 1,
      INTEREST: 17,
      FEE: 9,
      CREDIT: 1,
    });
  });

  it('produces the exact known-skip reason counts', () => {
    expect(batch.summary.skipReasons).toEqual({
      'money-market-fund': 22,
      'flatex-internal-transfer': 15,
      'cash-sweep': 13,
      'fx-helper': 6,
      'zero-amount': 6,
      'reservation-hold': 4,
      'account-interest-bookkeeping': 3,
      'isin-rename': 3,
      'orphan-trade-fee': 2,
      'positive-reversal': 2,
      'promotional-credit': 2,
      'cash-equivalent-coupon': 2,
    });
  });

  it('keeps every derived activity valid and in two currencies', () => {
    expect(batch.activities.filter((a) => !a.isValid)).toHaveLength(0);
    expect([...new Set(batch.activities.map((a) => a.currency))].sort()).toEqual(['EUR', 'USD']);
  });

  it('never produces a negative net position from the trade groups', () => {
    expect(reconciliation.positions).toHaveLength(12);
    for (const position of reconciliation.positions) {
      expect(new Decimal(position.netQuantity).isNegative()).toBe(false);
    }
  });

  it('settles accrued interest as separate cash events, not as cost basis', () => {
    const accrued = batch.activities.filter((a) => a.accruedInterest);
    expect(accrued).toHaveLength(2);
    // A paid `Meegekochte Rente` is a FEE; a refunded one is a CREDIT.
    expect(accrued.map((a) => a.activityType).sort()).toEqual(['CREDIT', 'FEE']);
    expect(reconciliation.accruedInterestSettlementCount).toBe(2);
    // The bond BUY itself keeps its own unit price — the accrued row is not merged in.
    const bondBuy = batch.activities.find(
      (a) => a.activityType === 'BUY' && a.isin === 'DE0001102382',
    );
    expect(bondBuy?.quantity).toBe('1250');
  });
});

describe('realistic statement fixture — securities lending revenue (regression)', () => {
  const rows = parsed.rows.filter((r) =>
    r.description.toLowerCase().startsWith('inkomsten uit securities lending'),
  );

  it('covers the row type at all', () => {
    expect(rows).toHaveLength(15);
  });

  it('classifies every `Inkomsten uit Securities Lending - <Maand>` row as INTEREST', () => {
    for (const row of rows) {
      expect(classifyRow(row).kind).toBe('INTEREST');
    }
  });

  it('maps each one to a standalone positive INTEREST activity on the cash symbol', () => {
    const lending = batch.activities.filter((a) =>
      (a.comment ?? '').toLowerCase().startsWith('inkomsten uit securities lending'),
    );
    expect(lending).toHaveLength(15);
    for (const activity of lending) {
      expect(activity.activityType).toBe('INTEREST');
      expect(activity.symbol).toBe('$CASH-EUR');
      expect(activity.currency).toBe('EUR');
      expect(new Decimal(activity.amount).isPositive()).toBe(true);
      // Account-level income: no instrument is attached.
      expect(activity.isin).toBeUndefined();
      expect(Object.keys(activity.warnings)).toEqual([]);
    }
    // Securities-lending income sits alongside the `Flatex Interest` charges.
    expect(batch.summary.byActivityType.INTEREST).toBe(lending.length + 2);
  });
});

/**
 * A DEGIRO export interleaves several independent running-balance ledgers in the
 * one `Saldo` column, so the chain is only consistent once the rows are split by
 * ledger:
 *
 *  - `cash:EUR` / `cash:USD` — the trading cash balances.
 *  - `flatex-bank` — the `Overboeking …` rows. They carry no `Mutatie` at all;
 *    their balance is the flatexDEGIRO bank account, moved by the amount quoted
 *    in the description (`naar uw geldrekening` = in, `van uw geldrekening` = out).
 *  - `money-market-fund` — the LU1959429272 rows track the fund position, not cash.
 *
 * Walking each ledger oldest → newest, `balance == previousBalance + change` must
 * hold exactly. This is what makes the fixture a usable stand-in for a real
 * statement rather than a bag of plausible-looking numbers.
 */
const FLATEX_TRANSFER_AMOUNT = /([\d.]+,\d+)\s+EUR/;

function ledgerOf(row: DegiroRow): string {
  if (row.isin === MONEY_MARKET_FUND_ISIN) return 'money-market-fund';
  if (row.description.toLowerCase().startsWith('overboeking')) return 'flatex-bank';
  return `cash:${row.balanceCurrency}`;
}

function changeOf(row: DegiroRow): Decimal {
  if (ledgerOf(row) === 'flatex-bank') {
    const match = FLATEX_TRANSFER_AMOUNT.exec(row.description);
    const amount = match ? tryParseDegiroDecimal(match[1]) : null;
    if (!amount) return new Decimal(0);
    return /naar uw geldrekening/i.test(row.description) ? amount : amount.neg();
  }
  // A row whose `Mutatie` currency differs from its `Saldo` currency (or which
  // has no `Mutatie` at all) leaves this ledger untouched.
  if (row.changeCurrency !== row.balanceCurrency) return new Decimal(0);
  return tryParseDegiroDecimal(row.changeAmountRaw) ?? new Decimal(0);
}

describe('realistic statement fixture — running-balance integrity', () => {
  it('carries a balance on every row', () => {
    for (const row of parsed.rows) {
      expect(row.balanceCurrency).not.toBe('');
      expect(tryParseDegiroDecimal(row.balanceAmountRaw)).not.toBeNull();
    }
  });

  it('is emitted newest-first', () => {
    const toKey = (r: DegiroRow) => r.date.split('-').reverse().join('');
    for (let i = 1; i < parsed.rows.length; i++) {
      expect(toKey(parsed.rows[i]) <= toKey(parsed.rows[i - 1])).toBe(true);
    }
  });

  it('keeps every ledger chain exact when walked oldest → newest', () => {
    const previous = new Map<string, Decimal>();
    const mismatches: string[] = [];

    for (let i = parsed.rows.length - 1; i >= 0; i--) {
      const row = parsed.rows[i];
      const ledger = ledgerOf(row);
      const balance = tryParseDegiroDecimal(row.balanceAmountRaw);
      expect(balance).not.toBeNull();
      const prior = previous.get(ledger);
      if (prior) {
        const expected = prior.plus(changeOf(row));
        if (!expected.equals(balance!)) {
          mismatches.push(`row ${row.rowIndex} (${ledger}): ${expected} != ${balance}`);
        }
      }
      previous.set(ledger, balance!);
    }

    expect(mismatches).toEqual([]);
    expect([...previous.keys()].sort()).toEqual([
      'cash:EUR',
      'cash:USD',
      'flatex-bank',
      'money-market-fund',
    ]);
    // Every USD purchase is settled back to a flat USD cash balance by its FX legs.
    expect(previous.get('cash:USD')!.toString()).toBe('0');
  });
});

describe('realistic statement fixture — fingerprints', () => {
  it('gives every activity a unique idempotency fingerprint', async () => {
    const result = await parseAndMapWithFingerprints(CONTENT);
    expect(result.hasFingerprintCollision).toBe(false);
    expect(result.fingerprints.size).toBe(88);
    expect(new Set(result.fingerprints.values()).size).toBe(88);
  });

  it('re-parsing the same statement reproduces identical fingerprints', async () => {
    const a = await parseAndMapWithFingerprints(CONTENT);
    const b = await parseAndMapWithFingerprints(CONTENT);
    expect([...b.fingerprints.values()].sort()).toEqual([...a.fingerprints.values()].sort());
  });
});
