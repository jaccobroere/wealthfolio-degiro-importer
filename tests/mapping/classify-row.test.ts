import { describe, expect, it } from 'vitest';
import { classifyRow, parseTradeDescription } from '../../src/mapping/classify-row';
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

describe('classifyRow', () => {
  it('classifies trades accepting Dutch thousands separator in quantity', () => {
    expect(classifyRow(row({ description: 'Koop 1.861 @ 100,00 EUR' })).kind).toBe('BUY');
    expect(classifyRow(row({ description: 'Verkoop 84 @ 122 EUR' })).kind).toBe('SELL');
    expect(classifyRow(row({ description: 'Koop 14 @ 119,285 EUR' })).kind).toBe('BUY');
  });

  it('classifies fees, taxes, accrued interest, FX', () => {
    expect(classifyRow(row({ description: 'DEGIRO Transactiekosten en/of kosten van derden' })).kind).toBe('TRADE_FEE');
    expect(classifyRow(row({ description: 'Dividendbelasting' })).kind).toBe('TAX');
    expect(classifyRow(row({ description: 'Transactiebelasting' })).kind).toBe('TAX');
    expect(classifyRow(row({ description: 'Meegekochte Rente' })).kind).toBe('ACCRUED_INTEREST');
    expect(classifyRow(row({ description: 'Valuta Debitering' })).kind).toBe('FX');
    expect(classifyRow(row({ description: 'Valuta Creditering' })).kind).toBe('FX');
  });

  it('classifies deposits and withdrawals with terugstorting guard', () => {
    expect(classifyRow(row({ description: 'iDEAL storting' })).kind).toBe('DEPOSIT');
    expect(classifyRow(row({ description: 'iDEAL deposit' })).kind).toBe('DEPOSIT');
    expect(classifyRow(row({ description: 'flatex Storting' })).kind).toBe('DEPOSIT');
    // "terugstorting" must NOT match "storting".
    expect(classifyRow(row({ description: 'flatex terugstorting' })).kind).toMatchObject({ kind: 'KNOWN_SKIP' });
    // bare terugstorting negative = withdrawal
    expect(classifyRow(row({ description: 'Terugstorting', changeAmountRaw: '-100,00' })).kind).toBe('WITHDRAWAL');
  });

  it('classifies processed flatex withdrawal by sign', () => {
    expect(classifyRow(row({ description: 'Processed Flatex Withdrawal', changeAmountRaw: '-500,00' })).kind).toBe('WITHDRAWAL');
    expect(classifyRow(row({ description: 'Processed Flatex Withdrawal', changeAmountRaw: '500,00' })).kind).toMatchObject({
      kind: 'KNOWN_SKIP',
      reason: 'positive-reversal',
    });
  });

  it('classifies income and fees', () => {
    expect(classifyRow(row({ description: 'Dividend' })).kind).toBe('DIVIDEND');
    expect(classifyRow(row({ description: 'Flatex Interest', changeAmountRaw: '-0,41' })).kind).toBe('INTEREST');
    expect(classifyRow(row({ description: 'Flatex Interest Income', changeAmountRaw: '0,00' })).kind).toBe('INTEREST');
    expect(classifyRow(row({ description: 'DEGIRO Aansluitingskosten 2026 (Xetra - XET)' })).kind).toBe('FEE');
    expect(classifyRow(row({ description: 'Service fee' })).kind).toBe('FEE');
  });

  it('applies the narrow known-skip allow-list', () => {
    expect(classifyRow(row({ description: 'DEGIRO Cash Sweep Transfer' })).kind).toMatchObject({ kind: 'KNOWN_SKIP', reason: 'cash-sweep' });
    expect(classifyRow(row({ description: 'Overboeking naar uw geldrekening bij FlatexDEGIRO bank: 1.000,00 EUR' })).kind).toMatchObject({ kind: 'KNOWN_SKIP', reason: 'flatex-internal-transfer' });
    expect(classifyRow(row({ description: 'Reservation iDEAL' })).kind).toMatchObject({ kind: 'KNOWN_SKIP', reason: 'reservation-hold' });
    expect(classifyRow(row({ description: 'Productwijziging : Koop 1 @ 10,00 EUR' })).kind).toMatchObject({ kind: 'KNOWN_SKIP', reason: 'isin-rename' });
    expect(classifyRow(row({ description: 'Verrekening welkomstactie' })).kind).toMatchObject({ kind: 'KNOWN_SKIP', reason: 'promotional-credit' });
    expect(classifyRow(row({ description: 'Coupon' })).kind).toMatchObject({ kind: 'KNOWN_SKIP', reason: 'cash-equivalent-coupon' });
    expect(classifyRow(row({ description: 'Rente' })).kind).toMatchObject({ kind: 'KNOWN_SKIP', reason: 'account-interest-bookkeeping' });
  });

  it('skips the money-market fund by ISIN', () => {
    expect(classifyRow(row({ description: 'Koersverandering geldmarktfonds (EUR)', isin: 'LU1959429272' })).kind).toMatchObject({
      kind: 'KNOWN_SKIP',
      reason: 'money-market-fund',
    });
  });

  it('returns UNKNOWN for unrecognized descriptions (never a silent skip)', () => {
    expect(classifyRow(row({ description: 'Totally unknown broker event' })).kind).toBe('UNKNOWN');
  });
});

describe('parseTradeDescription', () => {
  it('extracts Dutch-locale quantity/price/currency', () => {
    const info = parseTradeDescription('Koop 1.861 @ 100,00 EUR');
    expect(info).not.toBeNull();
    expect(info!.quantity.toString()).toBe('1861');
    expect(info!.price.toString()).toBe('100');
    expect(info!.currency).toBe('EUR');
  });

  it('handles plain and comma decimals', () => {
    expect(parseTradeDescription('Verkoop 84 @ 122 EUR')!.quantity.toString()).toBe('84');
    expect(parseTradeDescription('Koop 14 @ 119,285 EUR')!.price.toString()).toBe('119.285');
  });

  it('returns null for non-trade descriptions', () => {
    expect(parseTradeDescription('Dividend')).toBeNull();
  });
});
