/**
 * Symbol helpers for the DEGIRO importer.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. Re-exports the cash/instrument
 * predicates from the domain model and provides unique-symbol extraction used by
 * the mapping review workflow.
 */

import { type ActivityDraft, cashSymbol, isInstrumentSymbol } from '../domain/activity-draft';

export { cashSymbol, isInstrumentSymbol };

export interface UniqueSymbolEntry {
  /** Source identifier (ISIN when present, otherwise product). */
  sourceId: string;
  isin?: string;
  name?: string;
  currency: string;
}

/**
 * Collect distinct instrument symbols (ISIN or product) needing market-data
 * resolution. Cash pseudo-symbols are excluded. Stable input order.
 */
export function extractUniqueSymbols(activities: ActivityDraft[]): UniqueSymbolEntry[] {
  const seen = new Map<string, UniqueSymbolEntry>();
  for (const a of activities) {
    if (!isInstrumentSymbol(a.symbol)) continue;
    if (seen.has(a.symbol)) continue;
    seen.set(a.symbol, {
      sourceId: a.isin ?? a.symbol,
      isin: a.isin,
      name: a.symbolName,
      currency: a.currency,
    });
  }
  return Array.from(seen.values());
}

/**
 * Apply a resolved canonical-symbol mapping (sourceId → canonical symbol). Only
 * instrument activities are remapped; cash activities are untouched.
 */
export function applySymbolMappings(
  activities: ActivityDraft[],
  mappings: Record<string, string>,
): ActivityDraft[] {
  return activities.map((a) => {
    if (!isInstrumentSymbol(a.symbol)) return a;
    const key = a.isin ?? a.symbol;
    const resolved = mappings[key];
    if (!resolved) return a;
    return { ...a, symbol: resolved };
  });
}
