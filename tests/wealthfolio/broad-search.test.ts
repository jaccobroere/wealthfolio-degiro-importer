import { describe, expect, it } from 'vitest';
import type { SymbolSearchResult } from '@wealthfolio/addon-sdk';

import { broadSearch } from '../../src/wealthfolio/broad-search';
import { createFakeHost } from './fake-host';

const FUND = 'Synthetic MSCI Emerging UCITS ETF USD Acc';
const r = (symbol: string, mic: string, currency: string, longName = FUND) =>
  ({
    symbol,
    canonicalSymbol: symbol.split('.')[0],
    exchangeMic: mic,
    currency,
    longName,
    shortName: longName,
  }) as unknown as SymbolSearchResult;

describe('broadSearch', () => {
  it('follows an ISIN hit to its ticker root and name to find other listings', async () => {
    const host = createFakeHost({
      searchResults: {
        IE00SYN00001: [r('SYNA.L', 'XLON', 'GBp')],
        SYNA: [r('SYNA.L', 'XLON', 'GBp'), r('SYNA.AS', 'XAMS', 'EUR')],
        [FUND]: [r('SYNB.DE', 'XETR', 'EUR')],
      },
    });
    const { results, anchorName } = await broadSearch(host.api, { isin: 'IE00SYN00001' });
    expect(anchorName).toBe(FUND);
    expect(results.map((x) => x.symbol)).toEqual(['SYNA.L', 'SYNA.AS', 'SYNB.DE']);
  });

  it('probes exchange suffixes for a bare ticker traded in EUR', async () => {
    const host = createFakeHost({
      searchResults: {
        SYNA: [r('SYNA', 'ARCX', 'USD', 'Another Active ETF')],
        'SYNA.AS': [r('SYNA.AS', 'XAMS', 'EUR')],
      },
    });
    const { results, anchorName } = await broadSearch(host.api, {
      ticker: 'SYNA',
      tradedCurrency: 'EUR',
    });
    expect(anchorName).toBe(FUND);
    expect(results.map((x) => x.symbol)).toContain('SYNA.AS');
  });

  it('survives a failing search', async () => {
    const host = createFakeHost();
    host.api.market.searchTicker = async () => {
      throw new Error('offline');
    };
    expect(await broadSearch(host.api, { isin: 'IE00SYN00001', name: 'x' })).toEqual({
      results: [],
    });
  });
});
