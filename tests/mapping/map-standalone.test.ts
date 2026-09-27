import { describe, expect, it } from 'vitest';
import { mapStandalone } from '../../src/mapping/map-standalone';
import type { DegiroRow } from '../../src/domain/degiro-row';

function row(over: Partial<DegiroRow> & { description: string }): DegiroRow {
  return {
    rowIndex: 1,
    date: '02-01-2026',
    time: '10:00',
    valueDate: '02-01-2026',
    product: '',
    isin: '',
    fxRaw: '',
    changeCurrency: 'EUR',
    changeAmountRaw: '',
    balanceCurrency: 'EUR',
    balanceAmountRaw: '',
    orderId: '',
    ...over,
  };
}

describe('mapStandalone', () => {
  it('maps a deposit', () => {
    const res = mapStandalone(row({ description: 'iDEAL storting', changeAmountRaw: '1000,00' }));
    expect(res.kind).toBe('activity');
    if (res.kind !== 'activity') return;
    expect(res.activity.activityType).toBe('DEPOSIT');
    expect(res.activity.symbol).toBe('$CASH-EUR');
    expect(res.activity.amount).toBe('1000');
  });

  it('maps a withdrawal as a positive amount with WITHDRAWAL type', () => {
    const res = mapStandalone(
      row({ description: 'Processed Flatex Withdrawal', changeAmountRaw: '-500,00' }),
    );
    expect(res.kind).toBe('activity');
    if (res.kind !== 'activity') return;
    expect(res.activity.activityType).toBe('WITHDRAWAL');
    expect(res.activity.amount).toBe('500');
  });

  it('maps a dividend with ISIN', () => {
    const res = mapStandalone(
      row({
        description: 'Dividend',
        isin: 'IE00B4L5Y983',
        product: 'X',
        changeAmountRaw: '20,33',
        changeCurrency: 'USD',
      }),
    );
    expect(res.kind).toBe('activity');
    if (res.kind !== 'activity') return;
    expect(res.activity.activityType).toBe('DIVIDEND');
    expect(res.activity.currency).toBe('USD');
    expect(res.activity.isValid).toBe(true);
  });

  it('skips zero-amount interest rows', () => {
    const res = mapStandalone(
      row({ description: 'Flatex Interest Income', changeAmountRaw: '0,00' }),
    );
    expect(res.kind).toBe('known-skip');
    if (res.kind !== 'known-skip') return;
    expect(res.reason).toBe('zero-amount');
  });

  it('maps tax refunds as credits and paid tax as charges', () => {
    expect(
      mapStandalone(row({ description: 'Dividendbelasting', changeAmountRaw: '1,00' })).kind,
    ).toBe('activity');
    const res = mapStandalone(row({ description: 'Dividendbelasting', changeAmountRaw: '-1,00' }));
    expect(res.kind).toBe('activity');
  });

  it('maps negative interest as a cash charge', () => {
    const res = mapStandalone(row({ description: 'Flatex Interest', changeAmountRaw: '-0,41' }));
    expect(res.kind).toBe('activity');
    if (res.kind !== 'activity') return;
    expect(res.activity.activityType).toBe('FEE');
    expect(res.activity.subtype).toBe('INTEREST_CHARGE');
  });
});
