import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  parseDegiroDecimal,
  tryParseDegiroDecimal,
  DegiroDecimalError,
} from '../../src/parser/parse-decimal';

describe('parseDegiroDecimal (Dutch locale: . thousands, , decimal)', () => {
  it('parses the four thousands-separated BUY quantities (the bug fix)', () => {
    expect(parseDegiroDecimal('1.234').toString()).toBe('1234');
    expect(parseDegiroDecimal('2.506').toString()).toBe('2506');
    expect(parseDegiroDecimal('6.408').toString()).toBe('6408');
    expect(parseDegiroDecimal('1.750').toString()).toBe('1750');
  });

  it('treats comma as the decimal mark', () => {
    expect(parseDegiroDecimal('119,285').toString()).toBe('119.285');
    expect(parseDegiroDecimal('14,5').toString()).toBe('14.5');
    expect(parseDegiroDecimal('0,99').toString()).toBe('0.99');
  });

  it('parses combined thousands + decimal', () => {
    expect(parseDegiroDecimal('1.234,56').toString()).toBe('1234.56');
    expect(parseDegiroDecimal('12.345.678,90').toString()).toBe('12345678.9');
  });

  it('parses FX rates (value preserved exactly)', () => {
    expect(parseDegiroDecimal('1,0920').equals(new Decimal('1.092'))).toBe(true);
    expect(parseDegiroDecimal('1,0920').toString()).toBe('1.092');
  });

  it('parses plain integers and negatives', () => {
    expect(parseDegiroDecimal('14').toString()).toBe('14');
    expect(parseDegiroDecimal('-2,50').toString()).toBe('-2.5');
    expect(parseDegiroDecimal('-1.234').toString()).toBe('-1234');
  });

  it('rejects malformed or ambiguous input', () => {
    expect(() => parseDegiroDecimal('')).toThrow(DegiroDecimalError);
    expect(() => parseDegiroDecimal('abc')).toThrow(DegiroDecimalError);
    expect(() => parseDegiroDecimal('1,234.56')).toThrow(DegiroDecimalError); // dot after comma = ambiguous
    expect(() => parseDegiroDecimal('1,2,3')).toThrow(DegiroDecimalError); // multiple commas
    expect(() => parseDegiroDecimal('1.23')).toThrow(DegiroDecimalError); // dot as decimal with non-thousands grouping
  });

  it('tryParseDegiroDecimal returns null instead of throwing', () => {
    expect(tryParseDegiroDecimal('')).toBeNull();
    expect(tryParseDegiroDecimal('nope')).toBeNull();
    expect(tryParseDegiroDecimal('1.234')?.toString()).toBe('1234');
  });

  it('keeps full precision (no float rounding)', () => {
    // A value that float would mangle stays exact as Decimal.
    expect(parseDegiroDecimal('0,1').plus(parseDegiroDecimal('0,2')).toString()).toBe('0.3');
  });
});
