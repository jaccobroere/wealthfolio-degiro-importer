import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapOrderGroup } from '../../src/mapping/map-order-group';
import { parseDegiroCsv } from '../../src/parser/parse-csv';

const FIXTURES = join(__dirname, '..', 'fixtures');

describe('mapOrderGroup', () => {
  it('aggregates partial fills with Decimal and derives effective unit price', () => {
    // Two partial fills of the same order: 10 @ 100 and 15 @ 100 → 25 units.
    const csv = [
      'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
      '02-01-2026,10:00,02-01-2026,SYNTHETIC ETP,IE00PF000001,"Koop 10 @ 100,00 EUR",,EUR,"-1000,00",EUR,"0,00",ord-pf-1',
      '02-01-2026,10:01,02-01-2026,SYNTHETIC ETP,IE00PF000001,"Koop 15 @ 100,00 EUR",,EUR,"-1500,00",EUR,"0,00",ord-pf-1',
    ].join('\n');
    const { rows } = parseDegiroCsv(csv);
    const result = mapOrderGroup(rows, 0);
    expect(result.activities).toHaveLength(1);
    const a = result.activities[0];
    expect(a.activityType).toBe('BUY');
    expect(a.quantity).toBe('25');
    expect(a.amount).toBe('2500');
    expect(a.unitPrice).toBe('100');
    expect(a.group?.fillCount).toBe(2);
  });

  it('merges broker fees and preserves accrued interest provenance', () => {
    const { rows } = parseDegiroCsv(
      readFileSync(join(FIXTURES, 'degiro-localized-quantities.csv'), 'utf-8'),
    );
    // Group rows by orderId manually for a single localized order.
    const groupRows = rows.filter((r) => r.orderId === 'ord-localized-0001');
    const result = mapOrderGroup(groupRows, 0);
    expect(result.activities).toHaveLength(1);
    const a = result.activities[0];
    expect(a.quantity).toBe('1234'); // localized thousands separator
    expect(a.accruedInterest, 'accrued interest must be preserved as provenance').toBeDefined();
    expect(a.accruedInterest!.sourceRowNumbers).toHaveLength(1);
    expect(a.accruedInterest!.totalAmount).toBe('-1.23');
    expect(a.fee).toBe('2'); // merged transactiekosten
    // The fee row should be a group-member with role 'fee'.
    expect(result.memberships.some((m) => m.role === 'fee')).toBe(true);
    expect(result.memberships.some((m) => m.role === 'accrued-interest')).toBe(true);
  });

  it('converts EUR fees to trade currency for USD trades using the FX rate', () => {
    const csv = [
      'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
      '02-01-2026,10:00,02-01-2026,SYNTHETIC USD,IE00USD00001,"Koop 10 @ 50 USD",,USD,"-500,00",USD,"0,00",ord-usd-1',
      '02-01-2026,10:00,02-01-2026,,,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"0,00",ord-usd-1',
      '02-01-2026,10:00,02-01-2026,,,Valuta Debitering,"1,1",USD,"-500,00",USD,"0,00",ord-usd-1',
    ].join('\n');
    const { rows } = parseDegiroCsv(csv);
    const result = mapOrderGroup(rows, 0);
    const a = result.activities[0];
    expect(a.currency).toBe('USD');
    // fee 2 EUR * 1.1 = 2.2 USD
    expect(a.fee).toBe('2.2');
    expect(a.group?.fxRate).toBe('1.1');
  });

  it('skips orphan FX/fee rows when a group has no trade', () => {
    const csv = [
      'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
      '02-01-2026,10:00,02-01-2026,,,Valuta Creditering,"1,1",USD,"20,00",USD,"0,00",ord-orphan-1',
    ].join('\n');
    const { rows } = parseDegiroCsv(csv);
    const result = mapOrderGroup(rows, 0);
    expect(result.activities).toHaveLength(0);
    expect(result.orphanSkips).toHaveLength(1);
    expect(result.orphanSkips[0].role).toBe('fx');
  });
});
