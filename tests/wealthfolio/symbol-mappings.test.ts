/**
 * Symbol-mapping persistence and resolution tests.
 *
 * Proves:
 * - A saved mapping auto-applies ONLY when canonical identity matches.
 * - Ambiguous `searchTicker` (multiple results, none matching a saved
 *   identity) blocks.
 * - The first search result is NEVER auto-selected.
 * - New single-result mappings resolve and can be persisted.
 */
import { describe, expect, it } from 'vitest';

import type { ImportMappingData, SymbolSearchResult } from '@wealthfolio/addon-sdk';

import {
  identityToAsset,
  readSavedMappings,
  resolveSymbol,
  resultToIdentity,
  withSavedMapping,
} from '../../src/wealthfolio/symbol-mappings';
import { IMPORTER_ID } from '../../src/wealthfolio/types';

function fakeResult(opts: Partial<SymbolSearchResult>): SymbolSearchResult {
  return {
    exchange: 'NASDAQ',
    exchangeMic: 'XNAS',
    canonicalSymbol: 'AAPL',
    canonicalExchangeMic: 'XNAS',
    providerId: 'yahoo',
    providerSymbol: 'AAPL',
    shortName: 'Apple',
    quoteType: 'EQUITY',
    symbol: 'AAPL',
    index: '0',
    score: 1,
    typeDisplay: 'Equity',
    longName: 'Apple Inc.',
    ...opts,
  };
}

function emptyMapping(accountId = 'acct-1'): ImportMappingData {
  return { accountId, fieldMappings: {}, activityMappings: {}, symbolMappings: {}, accountMappings: {} };
}

describe('DEGIRO adapter: symbol mappings', () => {
  it('reads saved mappings namespaced by importer id', () => {
    const identity = { symbol: 'AAPL', exchangeMic: 'XNAS', providerId: 'yahoo' };
    const mapping = withSavedMapping(emptyMapping(), 'US0378331005', identity);
    const read = readSavedMappings(mapping);
    expect(read.get('US0378331005')).toEqual(identity);
  });

  it('ignores saved mappings from other importers', () => {
    const mapping: ImportMappingData = {
      ...emptyMapping(),
      symbolMappings: {
        'revolut-importer::US0378331005': JSON.stringify({ symbol: 'AAPL', exchangeMic: 'XNAS' }),
        [`${IMPORTER_ID}::US0378331005`]: JSON.stringify({ symbol: 'AAPL', exchangeMic: 'XNAS', providerId: 'yahoo' }),
      },
    };
    const read = readSavedMappings(mapping);
    expect(read.get('US0378331005')?.providerId).toBe('yahoo');
  });

  it('auto-applies a saved mapping only when canonical identity matches a search result', () => {
    const identity = { symbol: 'AAPL', exchangeMic: 'XNAS', providerId: 'yahoo' };
    const saved = new Map([['US0378331005', identity]]);
    const results = [fakeResult({})];
    const outcome = resolveSymbol('US0378331005', saved, results);
    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') {
      expect(outcome.identity).toEqual(identity);
      expect(outcome.fromSaved).toBe(true);
    }
  });

  it('blocks when a saved mapping does not match any current search result', () => {
    const identity = { symbol: 'AAPL', exchangeMic: 'XNAS', providerId: 'yahoo' };
    const saved = new Map([['US0378331005', identity]]);
    // Search now returns a different instrument.
    const results = [fakeResult({ canonicalSymbol: 'MSFT', exchangeMic: 'XNAS', providerId: 'yahoo' })];
    const outcome = resolveSymbol('US0378331005', saved, results);
    expect(outcome.status).toBe('blocked');
  });

  it('ambiguous search (multiple results, no saved mapping) blocks', () => {
    const saved = new Map<string, { symbol: string; exchangeMic?: string; providerId?: string }>();
    const results = [
      fakeResult({ canonicalSymbol: 'AAPL' }),
      fakeResult({ canonicalSymbol: 'AAPL', exchangeMic: 'XLON' }),
    ];
    const outcome = resolveSymbol('US0378331005', saved, results);
    expect(outcome.status).toBe('ambiguous');
  });

  it('never auto-selects the first result when multiple results are returned', () => {
    const saved = new Map<string, { symbol: string; exchangeMic?: string; providerId?: string }>();
    const results = [
      fakeResult({ canonicalSymbol: 'AAPL', exchangeMic: 'XNAS' }),
      fakeResult({ canonicalSymbol: 'AAPL', exchangeMic: 'XLON' }),
    ];
    const outcome = resolveSymbol('US0378331005', saved, results);
    expect(outcome.status).not.toBe('resolved');
  });

  it('single unambiguous search result resolves when no saved mapping exists', () => {
    const saved = new Map<string, { symbol: string; exchangeMic?: string; providerId?: string }>();
    const results = [fakeResult({ canonicalSymbol: 'AAPL', exchangeMic: 'XNAS', providerId: 'yahoo' })];
    const outcome = resolveSymbol('US0378331005', saved, results);
    expect(outcome.status).toBe('resolved');
    if (outcome.status === 'resolved') {
      expect(outcome.fromSaved).toBe(false);
      expect(outcome.identity.symbol).toBe('AAPL');
    }
  });

  it('no search results and no saved mapping yields no-results', () => {
    const saved = new Map<string, { symbol: string; exchangeMic?: string; providerId?: string }>();
    const outcome = resolveSymbol('US0378331005', saved, []);
    expect(outcome.status).toBe('no-results');
  });

  it('identityToAsset produces an AssetResolutionInput', () => {
    const asset = identityToAsset({ symbol: 'AAPL', exchangeMic: 'XNAS', providerId: 'yahoo' });
    expect(asset.symbol).toBe('AAPL');
    expect(asset.exchangeMic).toBe('XNAS');
    expect(asset.providerId).toBe('yahoo');
  });

  it('resultToIdentity prefers canonicalSymbol over symbol', () => {
    const id = resultToIdentity(fakeResult({ symbol: 'AAPL.BA', canonicalSymbol: 'AAPL' }));
    expect(id.symbol).toBe('AAPL');
  });

  it('withSavedMapping does not mutate the input', () => {
    const original = emptyMapping();
    const updated = withSavedMapping(original, 'US0378331005', { symbol: 'AAPL' });
    expect(original.symbolMappings).toEqual({});
    expect(updated.symbolMappings[`${IMPORTER_ID}::US0378331005`]).toContain('AAPL');
  });
});