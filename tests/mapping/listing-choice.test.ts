import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFERRED_EXCHANGES,
  normalizeCurrency,
  parseExchangeList,
  rankListings,
  suggestListing,
  type ListingCandidate,
} from '../../src/mapping/listing-choice';

const FUND = 'Synthetic MSCI Emerging UCITS ETF USD Acc';
const listing = (symbol: string, mic: string, currency: string, longName = FUND) =>
  ({
    symbol,
    canonicalSymbol: symbol.split('.')[0],
    exchangeMic: mic,
    currency,
    longName,
  }) as ListingCandidate;

const LON = listing('SYNA.L', 'XLON', 'GBp');
const AMS = listing('SYNA.AS', 'XAMS', 'EUR');
const MIL = listing('SYNA.MI', 'XMIL', 'EUR');
const XETR = listing('SYNB.DE', 'XETR', 'EUR');
const OTHER_US = listing('SYNA', 'ARCX', 'USD', 'Another India Active ETF');

const ctx = {
  tradedCurrency: 'EUR',
  anchorName: FUND,
  preferredExchanges: DEFAULT_PREFERRED_EXCHANGES,
};

describe('rankListings / suggestListing', () => {
  it('prefers the traded currency over the ISIN primary listing in London', () => {
    const ranked = rankListings([LON, MIL, AMS, OTHER_US], ctx);
    expect(ranked.map((r) => r.candidate.symbol)).toEqual(['SYNA.AS', 'SYNA.MI', 'SYNA.L', 'SYNA']);
    expect(suggestListing(ranked)?.candidate.symbol).toBe('SYNA.AS');
  });

  it('follows the reviewer’s exchange order', () => {
    const ranked = rankListings([AMS, XETR], { ...ctx, preferredExchanges: ['XETR', 'XAMS'] });
    expect(suggestListing(ranked)?.candidate.symbol).toBe('SYNB.DE');
  });

  it('suggests nothing when only another currency is available', () => {
    expect(suggestListing(rankListings([LON], ctx))).toBeUndefined();
  });

  it('suggests nothing on a tie between equally preferred listings', () => {
    const a = listing('SYNC.HE', 'XHEL', 'EUR');
    const b = listing('SYNC1.HE', 'XHEL', 'EUR');
    expect(suggestListing(rankListings([a, b], ctx))).toBeUndefined();
  });

  it('never suggests a different instrument with the same ticker', () => {
    const ranked = rankListings([OTHER_US], { ...ctx, tradedCurrency: 'USD' });
    expect(ranked[0]?.sameInstrument).toBe(false);
    expect(suggestListing(ranked)).toBeUndefined();
  });

  it('matches on the source ticker when there is no name anchor', () => {
    const ranked = rankListings([OTHER_US, listing('SYNX', 'XNAS', 'USD', 'x')], {
      tradedCurrency: 'USD',
      sourceSymbol: 'SYNA',
      preferredExchanges: [],
    });
    expect(ranked[0]?.candidate.symbol).toBe('SYNA');
    expect(suggestListing(ranked)?.candidate.symbol).toBe('SYNA');
  });
});

describe('helpers', () => {
  it('treats minor-unit quotes as their major currency', () => {
    expect(normalizeCurrency('GBp')).toBe('GBP');
    expect(normalizeCurrency('eur')).toBe('EUR');
  });

  it('parses an exchange list', () => {
    expect(parseExchangeList(' xams, XETR;xpar  XAMS')).toEqual(['XAMS', 'XETR', 'XPAR']);
  });
});
