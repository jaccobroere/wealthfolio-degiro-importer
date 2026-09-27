import { describe, expect, it } from 'vitest';
import { parseAndMap } from '../../src/parser/parse-and-map';

const header = 'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id';
const statement = [
  header,
  '02-01-2026,10:00,02-01-2026,,,iDEAL storting,,EUR,"100,00",EUR,"100,00",',
  '02-01-2026,11:00,02-01-2026,SYNTHETIC,US0000000001,"Koop 2 @ 10,00 USD",,USD,"-20,00",USD,"-20,00",cash-test',
  '02-01-2026,11:00,02-01-2026,,,Transactiekosten,,EUR,"-1,00",EUR,"99,00",cash-test',
  '02-01-2026,11:00,02-01-2026,,,Valuta Debitering,,EUR,"-16,00",EUR,"83,00",cash-test',
  '02-01-2026,11:00,02-01-2026,,,Valuta Creditering,"1,25",USD,"20,00",USD,"0,00",cash-test',
  '03-01-2026,10:00,03-01-2026,SYNTHETIC,US0000000001,Dividend,,USD,"5,00",USD,"5,00",',
  '03-01-2026,10:01,03-01-2026,SYNTHETIC,US0000000001,Dividend,,USD,"-1,00",USD,"4,00",',
  '03-01-2026,10:01,03-01-2026,,,Valuta Debitering,,USD,"-4,00",USD,"0,00",',
  '03-01-2026,10:01,03-01-2026,,,Valuta Creditering,,EUR,"3,00",EUR,"86,00",',
  '04-01-2026,10:00,04-01-2026,,,Flatex Interest,,EUR,"-0,10",EUR,"85,90",',
  '04-01-2026,10:01,04-01-2026,SYNTHETIC BOND,DE0000000001,Coupon,,EUR,"2,00",EUR,"87,90",',
  '04-01-2026,10:02,04-01-2026,,,Dividendbelasting,,EUR,"0,20",EUR,"88,10",',
  '04-01-2026,10:03,04-01-2026,,,Verrekening welkomstactie,,EUR,"0,30",EUR,"88,40",',
  '04-01-2026,10:04,04-01-2026,FUND,LU1959429272,Koersverandering geldmarktfonds (EUR),,EUR,"-0,02",EUR,"0,00",',
  '04-01-2026,10:05,04-01-2026,,,DEGIRO Cash Sweep Transfer,,EUR,"-88,38",EUR,"0,00",',
  '04-01-2026,10:05,04-01-2026,,,Overboeking naar uw geldrekening bij flatexDEGIRO Bank: 88.38 EUR,,,,EUR,"88,38",',
].join('\n');

describe('DEGIRO economic cash movements', () => {
  it('imports the consolidated cash balance without duplicating a bank sweep', () => {
    const { batch, reconciliation } = parseAndMap(statement);
    expect(batch.summary.unsupportedCount).toBe(0);
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(
      reconciliation.cashByCurrency
        .map(({ currency, netAmount }) => ({ currency, netAmount }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    ).toEqual([
      { currency: 'EUR', netAmount: '88.38' },
      { currency: 'USD', netAmount: '0' },
    ]);
    const pairs = batch.activities.filter((a) => a.sourceGroupId);
    expect(pairs).toHaveLength(4);
    expect(new Set(pairs.map((a) => a.sourceGroupId)).size).toBe(2);
    expect(batch.activities.find((a) => a.activityType === 'BUY')?.fee).toBe('0');
    expect(
      batch.activities.some(
        (a) => a.activityType === 'FEE' && a.currency === 'EUR' && a.amount === '1',
      ),
    ).toBe(true);
  });

  it('blocks an incomplete FX conversion instead of silently skipping its cash', () => {
    const { batch } = parseAndMap(
      [header, '02-01-2026,10:00,02-01-2026,,,Valuta Creditering,,USD,"5,00",USD,"5,00",'].join(
        '\n',
      ),
    );
    expect(batch.summary.unsupportedCount).toBe(1);
    expect(batch.summary.skipReasons['fx-helper']).toBeUndefined();
  });

  it('includes merged fees in the cash preview', () => {
    const { reconciliation } = parseAndMap(
      [
        header,
        '02-01-2026,10:00,02-01-2026,SYNTHETIC,IE0000000001,"Koop 2 @ 10,00 EUR",,EUR,"-20,00",EUR,"0,00",fee-test',
        '02-01-2026,10:00,02-01-2026,,,Transactiekosten,,EUR,"-1,00",EUR,"0,00",fee-test',
      ].join('\n'),
    );
    expect(reconciliation.cashByCurrency[0].netAmount).toBe('-21');
  });

  it('aggregates FX partial fills in their own currencies', () => {
    const { batch, reconciliation } = parseAndMap(
      [
        header,
        '02-01-2026,10:00,02-01-2026,,,Valuta Debitering,,EUR,"-8,00",EUR,"0,00",partial-fx',
        '02-01-2026,10:00,02-01-2026,,,Valuta Creditering,,USD,"10,00",USD,"0,00",partial-fx',
        '02-01-2026,10:01,02-01-2026,,,Valuta Debitering,,EUR,"-8,00",EUR,"0,00",partial-fx',
        '02-01-2026,10:01,02-01-2026,,,Valuta Creditering,,USD,"10,00",USD,"0,00",partial-fx',
      ].join('\n'),
    );
    expect(batch.activities).toHaveLength(2);
    expect(batch.activities.every((a) => a.sourceRowNumbers.length === 2)).toBe(true);
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(reconciliation.cashByCurrency.map((c) => c.netAmount)).toEqual(['-16', '20']);
  });

  it('blocks conversions with a currency changing direction in the same bucket', () => {
    const { batch } = parseAndMap(
      [
        header,
        '02-01-2026,10:00,02-01-2026,,,Valuta Debitering,,EUR,"-8,00",EUR,"0,00",',
        '02-01-2026,10:00,02-01-2026,,,Valuta Creditering,,USD,"10,00",USD,"0,00",',
        '02-01-2026,10:00,02-01-2026,,,Valuta Debitering,,USD,"-1,00",USD,"0,00",',
      ].join('\n'),
    );
    expect(batch.activities).toHaveLength(0);
    expect(batch.summary.unsupportedCount).toBe(3);
  });

  it('preserves a nonzero money-market mutation even without a price-change label', () => {
    const { batch, reconciliation } = parseAndMap(
      [
        header,
        '02-01-2026,10:00,02-01-2026,FUND,LU1959429272,Conversie geldmarktfonds,,EUR,"-0,01",EUR,"0,00",',
      ].join('\n'),
    );
    expect(batch.activities[0].activityType).toBe('FEE');
    expect(reconciliation.cashByCurrency[0].netAmount).toBe('-0.01');
  });
});
