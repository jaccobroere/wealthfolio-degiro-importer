import { describe, expect, it } from 'vitest';
import { toIsoDate, amsterdamOffsetForDate } from '../../src/parser/parse-date';

describe('toIsoDate (Europe/Amsterdam DST-aware)', () => {
  it('uses CET (+01:00) in winter', () => {
    expect(amsterdamOffsetForDate('2026-01-15')).toBe('+01:00');
    expect(toIsoDate('15-01-2026', '10:00')).toBe('2026-01-15T10:00:00+01:00');
  });

  it('uses CEST (+02:00) in summer', () => {
    expect(amsterdamOffsetForDate('2026-07-15')).toBe('+02:00');
    expect(toIsoDate('15-07-2026', '09:30')).toBe('2026-07-15T09:30:00+02:00');
  });

  it('pads single-digit day/month/hour', () => {
    expect(toIsoDate('2-1-2026', '9:05')).toBe('2026-01-02T09:05:00+01:00');
  });

  it('rejects malformed date/time', () => {
    expect(() => toIsoDate('2026-01-02', '10:00')).toThrow();
    expect(() => toIsoDate('02-01-2026', '10')).toThrow();
  });
});
