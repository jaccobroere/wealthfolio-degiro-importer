/**
 * Symbol-mapping persistence and canonical-identity verification.
 *
 * Reuses confirmed instrument mappings through `getImportMapping` /
 * `saveImportMapping`. A saved mapping is auto-applied ONLY after verifying
 * the same canonical identity (symbol + MIC + provider). New or ambiguous
 * `searchTicker` results block for review; a user-requested bulk action may
 * accept a single unambiguous result, but the first of multiple results is
 * NEVER auto-selected.
 */
import type {
  AssetResolutionInput,
  ImportMappingData,
  SymbolSearchResult,
} from '@wealthfolio/addon-sdk';

import { IMPORTER_ID } from './types';

/**
 * Canonical identity for an instrument mapping. Two mappings with the same
 * identity are considered the same instrument.
 */
export interface CanonicalIdentity {
  symbol: string;
  exchangeMic?: string;
  providerId?: string;
  /** Host market-search quote currency, required by asset-linked writes. */
  quoteCcy?: string;
  /** Host market-search instrument classification hint. */
  instrumentType?: string;
  /** Provider-native code for the explicitly selected market result. */
  providerSymbol?: string;
  /** Host asset kind, when the market result supplies one. */
  kind?: string;
}

/** Namespaced key for the symbol-mappings sub-table of `ImportMappingData`. */
function mappingKey(sourceTickerOrIsin: string): string {
  return `${IMPORTER_ID}::${sourceTickerOrIsin}`;
}

/**
 * Read the saved symbol mappings for this importer from an
 * `ImportMappingData` object. Returns a map of source-id → canonical identity.
 */
export function readSavedMappings(mapping: ImportMappingData): Map<string, CanonicalIdentity> {
  const out = new Map<string, CanonicalIdentity>();
  const sm = mapping.symbolMappings ?? {};
  for (const [key, value] of Object.entries(sm)) {
    if (!key.startsWith(`${IMPORTER_ID}::`)) continue;
    const sourceId = key.slice(`${IMPORTER_ID}::`.length);
    if (typeof value !== 'string' || value.length === 0) continue;
    // Stored as a JSON-encoded CanonicalIdentity.
    try {
      const parsed = JSON.parse(value) as CanonicalIdentity;
      if (parsed && typeof parsed.symbol === 'string') {
        out.set(sourceId, {
          symbol: parsed.symbol,
          exchangeMic: parsed.exchangeMic,
          providerId: parsed.providerId,
        });
      }
    } catch {
      // Ignore malformed entries; they block auto-apply (safe default).
    }
  }
  return out;
}

/**
 * Serialize a canonical identity for storage in `symbolMappings`.
 */
function encodeIdentity(identity: CanonicalIdentity): string {
  return JSON.stringify(identity);
}

/**
 * Build an updated `ImportMappingData` with one new confirmed mapping added.
 * Does not mutate the input.
 */
export function withSavedMapping(
  mapping: ImportMappingData,
  sourceTickerOrIsin: string,
  identity: CanonicalIdentity,
): ImportMappingData {
  const key = mappingKey(sourceTickerOrIsin);
  const symbolMappings = { ...(mapping.symbolMappings ?? {}) };
  symbolMappings[key] = encodeIdentity(identity);
  return { ...mapping, symbolMappings };
}

/**
 * Convert a `SymbolSearchResult` to a `CanonicalIdentity`.
 */
export function resultToIdentity(result: SymbolSearchResult): CanonicalIdentity {
  return {
    symbol: result.canonicalSymbol ?? result.symbol,
    exchangeMic: result.canonicalExchangeMic ?? result.exchangeMic,
    providerId: result.providerId,
    ...(result.currency ? { quoteCcy: result.currency } : {}),
    ...(result.quoteType ? { instrumentType: result.quoteType } : {}),
    ...(result.providerSymbol ? { providerSymbol: result.providerSymbol } : {}),
    ...(result.assetKind ? { kind: result.assetKind } : {}),
  };
}

/**
 * Convert a `CanonicalIdentity` to an `AssetResolutionInput` for the
 * conversion boundary.
 */
export function identityToAsset(identity: CanonicalIdentity): AssetResolutionInput {
  return {
    symbol: identity.symbol,
    exchangeMic: identity.exchangeMic,
    providerId: identity.providerId,
    quoteCcy: identity.quoteCcy,
    instrumentType: identity.instrumentType,
    providerSymbol: identity.providerSymbol,
    kind: identity.kind,
  };
}

/**
 * Outcome of attempting to resolve a source ticker/ISIN to an instrument.
 */
export type ResolutionOutcome =
  | { status: 'resolved'; identity: CanonicalIdentity; fromSaved: boolean }
  | { status: 'ambiguous'; results: SymbolSearchResult[] }
  | { status: 'no-results' }
  | { status: 'blocked'; reason: string };

/**
 * Resolve a source ticker/ISIN against saved mappings and the market-data
 * search.
 *
 * Rules (verified 3.6.1 contract):
 * - A saved mapping is auto-applied ONLY when its canonical identity matches
 *   a search result's identity (defensive re-verification).
 * - If no saved mapping exists, the search must return exactly one result
 *   with a canonical identity; otherwise the row is blocked for review.
 * - The first search result is NEVER auto-selected when multiple results
 *   are returned.
 */
export function resolveSymbol(
  sourceTickerOrIsin: string,
  saved: Map<string, CanonicalIdentity>,
  searchResults: SymbolSearchResult[],
): ResolutionOutcome {
  const savedIdentity = saved.get(sourceTickerOrIsin);
  if (savedIdentity) {
    // Re-verify the saved identity against the current search results.
    if (searchResults.length > 0) {
      const match = searchResults.find((r) => {
        const id = resultToIdentity(r);
        return (
          id.symbol === savedIdentity.symbol &&
          (id.exchangeMic ?? undefined) === (savedIdentity.exchangeMic ?? undefined) &&
          (id.providerId ?? undefined) === (savedIdentity.providerId ?? undefined)
        );
      });
      if (match) {
        // Take the asset-resolution fields from the fresh host response. This
        // upgrades pre-existing persisted mappings that lacked mandatory quote
        // currency hints without weakening canonical-identity verification.
        return { status: 'resolved', identity: resultToIdentity(match), fromSaved: true };
      }
      // Saved identity no longer matches any search result → block (do not
      // silently fall through to auto-select).
      return {
        status: 'blocked',
        reason: 'Saved mapping does not match any current search result; review required',
      };
    }
    // No search results to re-verify against: trust the saved mapping only
    // if it has a symbol (defensive). This path is for offline re-import.
    if (savedIdentity.symbol) {
      return { status: 'resolved', identity: savedIdentity, fromSaved: true };
    }
    return { status: 'blocked', reason: 'Saved mapping is incomplete; review required' };
  }

  // No saved mapping: require an unambiguous single result.
  if (searchResults.length === 0) return { status: 'no-results' };
  if (searchResults.length > 1) return { status: 'ambiguous', results: searchResults };

  const single = searchResults[0];
  const identity = resultToIdentity(single);
  if (!identity.symbol)
    return { status: 'blocked', reason: 'Single search result has no canonical symbol' };
  return { status: 'resolved', identity, fromSaved: false };
}
