import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDegiroCsv, detectHeaderVariant } from '../../src/parser/parse-csv';

const FIXTURES = join(__dirname, '..', 'fixtures');

describe('parseDegiroCsv', () => {
  it('parses the 12-column Dutch upstream example fixture', () => {
    const content = readFileSync(join(FIXTURES, 'degiro-example.csv'), 'utf-8');
    const { rows, headerVariant, structuralErrors } = parseDegiroCsv(content);
    expect(headerVariant).toBe('dutch');
    expect(structuralErrors).toHaveLength(0);
    // The upstream example.csv has 14 data rows.
    expect(rows.length).toBe(14);
    // Spot-check the physical 12-column mapping via a known trade row (no value
    // assertions on money to keep this a structural test).
    const verkoop = rows.find((r) => r.description.startsWith('Verkoop'));
    expect(verkoop).toBeDefined();
    expect(verkoop!.orderId).not.toBe('');
    expect(verkoop!.changeCurrency).toBe('EUR');
  });

  it('parses the 12-column English header variant', () => {
    const en = [
      'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id',
      '02-01-2026,09:00,02-01-2026,,,iDEAL deposit,,EUR,"1000,00",EUR,"1000,00",',
    ].join('\n');
    const { rows, headerVariant } = parseDegiroCsv(en);
    expect(headerVariant).toBe('english');
    expect(rows).toHaveLength(1);
    expect(rows[0].changeAmountRaw.replace(/"/g, '')).toBe('1000,00');
  });

  it('records structural errors for short rows instead of throwing', () => {
    const short = [
      'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
      '02-01-2026,09:00,too,few,cols',
    ].join('\n');
    const { rows, structuralErrors } = parseDegiroCsv(short);
    expect(rows).toHaveLength(0);
    expect(structuralErrors.length).toBe(1);
    expect(structuralErrors[0].fieldCount).toBe(5);
  });

  it('throws on an unrecognized header', () => {
    expect(() => parseDegiroCsv('a,b,c\n1,2,3')).toThrow();
  });

  it('strips a UTF-8 BOM', () => {
    const bom =
      '\uFEFF' +
      [
        'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
        '02-01-2026,09:00,02-01-2026,,,iDEAL storting,,EUR,"1000,00",EUR,"1000,00",',
      ].join('\n');
    const { rows, headerVariant } = parseDegiroCsv(bom);
    expect(headerVariant).toBe('dutch');
    expect(rows).toHaveLength(1);
  });
});

describe('detectHeaderVariant', () => {
  it('recognizes Dutch and English headers', () => {
    expect(
      detectHeaderVariant(
        'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id'.split(','),
      ),
    ).toBe('dutch');
    expect(
      detectHeaderVariant(
        'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id'.split(','),
      ),
    ).toBe('english');
  });
  it('rejects unknown headers', () => {
    expect(detectHeaderVariant('foo,bar,baz'.split(','))).toBeNull();
  });
});
