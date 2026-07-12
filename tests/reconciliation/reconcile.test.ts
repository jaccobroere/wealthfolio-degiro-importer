import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAndMap } from '../../src/parser/parse-and-map';
import { reconcile } from '../../src/reconciliation/reconcile';

const FIXTURES = join(__dirname, '..', 'fixtures');

describe('reconcile', () => {
  it('computes net BUY/SELL positions per instrument', () => {
    const csv = [
      'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
      '02-01-2026,10:00,02-01-2026,EQ,IE00REC0001,"Koop 10 @ 100,00 EUR",,EUR,"-1000,00",EUR,"0,00",o1',
      '03-01-2026,10:00,03-01-2026,EQ,IE00REC0001,"Verkoop 4 @ 100,00 EUR",,EUR,"400,00",EUR,"0,00",o2',
    ].join('\n');
    const { batch } = parseAndMap(csv);
    const rec = reconcile(batch);
    expect(rec.positions).toHaveLength(1);
    expect(rec.positions[0].netQuantity).toBe('6'); // 10 - 4
    expect(rec.positions[0].tradeActivityCount).toBe(2);
  });

  it('counts accrued-interest presence on the localized fixture', () => {
    const { batch } = parseAndMap(readFileSync(join(FIXTURES, 'degiro-localized-quantities.csv'), 'utf-8'));
    const rec = reconcile(batch);
    expect(rec.accruedInterestActivityCount).toBe(4);
    expect(rec.accruedInterestSourceRowCount).toBe(4);
    expect(rec.buyDraftsWithAccruedInterestCount).toBe(4);
  });

  it('reports known internal cash movements and skip reasons', () => {
    const csv = [
      'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
      '02-01-2026,10:00,02-01-2026,,,DEGIRO Cash Sweep Transfer,,EUR,"100,00",EUR,"0,00",',
      '02-01-2026,11:00,02-01-2026,,,Valuta Debitering,"1,1",USD,"-10,00",USD,"0,00",',
    ].join('\n');
    const { batch } = parseAndMap(csv);
    const rec = reconcile(batch);
    expect(rec.knownInternalMovementCount).toBe(2); // cash-sweep + fx-helper
    expect(rec.skipReasons['cash-sweep']).toBe(1);
    expect(rec.skipReasons['fx-helper']).toBe(1);
    expect(rec.unaccountedCount).toBe(0);
  });
});
