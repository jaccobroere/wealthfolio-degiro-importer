import { describe, expect, it } from 'vitest';
import {
  applyRowPatch,
  changedFields,
  normalizePatch,
  EDITABLE_FIELDS,
} from '../../src/domain/row-override';
import type { DegiroRow } from '../../src/domain/degiro-row';

function row(over: Partial<DegiroRow> = {}): DegiroRow {
  return {
    rowIndex: 7,
    date: '02-01-2026',
    time: '10:00',
    valueDate: '02-01-2026',
    product: 'SYNTHETIC EQUITY',
    isin: 'IE00UNK0001',
    description: 'Onbekende Actie Die Niemand Kent',
    fxRaw: '',
    changeCurrency: 'EUR',
    changeAmountRaw: '-42,00',
    balanceCurrency: 'EUR',
    balanceAmountRaw: '958,00',
    orderId: '',
    ...over,
  };
}

describe('row overrides', () => {
  it('reports only the fields that actually differ', () => {
    const r = row();
    expect(changedFields(r, { description: 'Dividend' })).toEqual(['description']);
    // Same value is not a change.
    expect(changedFields(r, { description: r.description })).toEqual([]);
    // Undefined entries are ignored.
    expect(changedFields(r, {})).toEqual([]);
  });

  it('applies only changed fields and leaves the original row untouched', () => {
    const r = row();
    const patched = applyRowPatch(r, { description: 'Dividend', changeAmountRaw: '12,50' });
    expect(patched.description).toBe('Dividend');
    expect(patched.changeAmountRaw).toBe('12,50');
    expect(patched.rowIndex).toBe(r.rowIndex);
    expect(patched.orderId).toBe(r.orderId);
    // The pristine row is never mutated: rebuilds always start from it.
    expect(r.description).toBe('Onbekende Actie Die Niemand Kent');
  });

  it('never lets a patch touch a non-editable field', () => {
    const r = row();
    const patched = applyRowPatch(r, { orderId: 'hijacked' } as never);
    expect(patched.orderId).toBe('');
  });

  it('normalizes a no-op patch to null so it is dropped instead of recorded', () => {
    const r = row();
    expect(normalizePatch(r, { description: r.description, isin: r.isin })).toBeNull();
    expect(normalizePatch(r, {})).toBeNull();
    expect(normalizePatch(r, { description: 'Dividend', isin: r.isin })).toEqual({
      description: 'Dividend',
    });
  });

  it('exposes every field the validator or mappers read, and nothing more', () => {
    expect([...EDITABLE_FIELDS].sort()).toEqual(
      [
        'balanceAmountRaw',
        'changeAmountRaw',
        'changeCurrency',
        'date',
        'description',
        'fxRaw',
        'isin',
        'product',
        'time',
      ].sort(),
    );
    expect(EDITABLE_FIELDS).not.toContain('orderId');
  });
});
