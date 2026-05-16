import type { ActivityImport } from '../types';

const CASH_PREFIX = '$CASH-';

export function isStockSymbol(symbol: string | undefined): symbol is string {
  return !!symbol && !symbol.startsWith(CASH_PREFIX);
}

export interface SymbolEntry {
  isin: string;
  name: string;
  currency: string;
}

export function extractUniqueSymbols(activities: ActivityImport[]): SymbolEntry[] {
  const seen = new Map<string, SymbolEntry>();
  for (const a of activities) {
    if (isStockSymbol(a.symbol) && !seen.has(a.symbol)) {
      seen.set(a.symbol, {
        isin: a.symbol,
        name: a.symbolName ?? a.symbol,
        currency: a.currency ?? 'EUR',
      });
    }
  }
  return Array.from(seen.values());
}

export function applyMappings(
  activities: ActivityImport[],
  mappings: Record<string, string>,
): ActivityImport[] {
  return activities.map(a => {
    if (isStockSymbol(a.symbol) && mappings[a.symbol]) {
      return { ...a, symbol: mappings[a.symbol] };
    }
    return a;
  });
}
