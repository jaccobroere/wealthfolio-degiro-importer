/**
 * Broader market-data search for one security.
 *
 * Yahoo's ISIN search returns only the primary listing (often London), so the
 * ISIN alone never offers the euro-area listing a DEGIRO holding usually
 * trades on. This runs, in order: the ISIN, the ticker root(s) that ISIN hit
 * reveals, the ISIN hit's own name (euro listings often use another ticker,
 * e.g. IWDA vs SWDA), and the statement's product name; then merges and
 * de-duplicates the results. The ISIN hit's name is returned as the anchor that ranking
 * uses to keep only listings of the same instrument.
 */
import type { HostAPI, SymbolSearchResult } from '@wealthfolio/addon-sdk';

import { listingKey, normalizeCurrency } from '../mapping/listing-choice';
import { searchTicker } from './api';

export interface BroadSearchInput {
  isin?: string;
  /** Source ticker, when the statement has one. */
  ticker?: string;
  /** Statement product name, used as an extra query. */
  name?: string;
  /** Currency the statement traded the security in (anchors ticker search). */
  tradedCurrency?: string;
}

export interface BroadSearchResult {
  results: SymbolSearchResult[];
  /** Name of the instrument the ISIN resolved to, if it resolved. */
  anchorName?: string;
}

/** At most this many ticker roots from the ISIN hit are searched. */
const MAX_ROOT_QUERIES = 2;

/**
 * Yahoo suffixes tried for a bare ticker when no listing in the traded
 * currency turned up (e.g. `SYNA.AS` for a ticker bought in EUR).
 */
const SUFFIXES_BY_CURRENCY: Record<string, readonly string[]> = {
  EUR: ['.AS', '.DE', '.PA', '.MI'],
  GBP: ['.L'],
  CHF: ['.SW'],
};

async function safeSearch(api: HostAPI, query: string): Promise<SymbolSearchResult[]> {
  try {
    return await searchTicker(api, query);
  } catch {
    return [];
  }
}

export async function broadSearch(
  api: HostAPI,
  input: BroadSearchInput,
): Promise<BroadSearchResult> {
  const merged = new Map<string, SymbolSearchResult>();
  const add = (results: SymbolSearchResult[]) => {
    for (const r of results) if (!merged.has(listingKey(r))) merged.set(listingKey(r), r);
  };
  const searched = new Set<string>();
  const run = async (query: string | undefined) => {
    const q = query?.trim();
    if (!q || searched.has(q.toUpperCase())) return [];
    searched.add(q.toUpperCase());
    const results = await safeSearch(api, q);
    add(results);
    return results;
  };

  let anchorName: string | undefined;
  if (input.isin) {
    const byIsin = await run(input.isin);
    anchorName = byIsin[0]?.longName || byIsin[0]?.shortName || undefined;
    const roots = [
      ...new Set(byIsin.map((r) => (r.canonicalSymbol ?? r.symbol.split('.')[0] ?? '').trim())),
    ].filter(Boolean);
    for (const root of roots.slice(0, MAX_ROOT_QUERIES)) await run(root);
    await run(anchorName);
  }
  if (input.ticker) {
    // Without an ISIN, anchor on the listing with the same ticker root —
    // preferably in the traded currency — and search its name to find the
    // same instrument's listings under other tickers.
    const byTicker = await run(input.ticker);
    if (!anchorName) {
      const root = input.ticker.trim().toUpperCase();
      const sameRoot = byTicker.filter(
        (r) => (r.canonicalSymbol ?? r.symbol.split('.')[0] ?? '').toUpperCase() === root,
      );
      const traded = normalizeCurrency(input.tradedCurrency);
      const inTraded = (rs: SymbolSearchResult[]) =>
        rs.find((r) => traded !== '' && normalizeCurrency(r.currency) === traded);
      let anchor = inTraded(sameRoot);
      for (const suffix of anchor ? [] : (SUFFIXES_BY_CURRENCY[traded] ?? [])) {
        anchor = inTraded(await run(`${root}${suffix}`));
        if (anchor) break;
      }
      anchor ??= sameRoot[0];
      anchorName = anchor?.longName || anchor?.shortName || undefined;
      await run(anchorName);
    }
  }
  await run(input.name);

  return { results: [...merged.values()], ...(anchorName ? { anchorName } : {}) };
}
