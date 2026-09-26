/**
 * Ranking of market-data listings for one security.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. The adapter maps host
 * search results to `ListingCandidate`.
 *
 * Why: a security usually trades on several exchanges in different
 * currencies. Yahoo's ISIN search returns only the primary listing — for many
 * UCITS ETFs that is London in GBp — so accepting "the only result" put EUR
 * holdings on a GBP listing. Ranking prefers, in order:
 *
 * 1. the same instrument (the name of the ISIN hit, or the source ticker);
 * 2. a listing in the currency the security was actually traded in, according
 *    to the statement;
 * 3. the reviewer's preferred exchanges, in their order.
 *
 * A listing is only *suggested* when it is the same instrument, in the traded
 * currency, and strictly ahead of every other such listing on exchange
 * preference. Anything less stays for the reviewer to choose.
 */

/** The fields of a host search result that ranking needs. */
export interface ListingCandidate {
  symbol: string;
  canonicalSymbol?: string;
  exchangeMic?: string;
  exchangeName?: string;
  currency?: string;
  longName?: string;
  shortName?: string;
  quoteType?: string;
}

/** What is known about the security from the statement and the reviewer. */
export interface ListingContext {
  /** Currency of the statement's buys/sells for this security. */
  tradedCurrency?: string;
  /** Instrument name to match, e.g. the name of the ISIN search hit. */
  anchorName?: string;
  /** Source ticker to match when there is no name anchor (e.g. Revolut). */
  sourceSymbol?: string;
  /** Exchange MICs in order of preference. */
  preferredExchanges: readonly string[];
}

export interface RankedListing<T extends ListingCandidate = ListingCandidate> {
  candidate: T;
  /** Index of the candidate in the input array. */
  index: number;
  sameInstrument: boolean;
  currencyMatch: boolean;
  /** Position in `preferredExchanges`, or `Infinity` when not listed. */
  exchangeRank: number;
}

/**
 * Default exchange preference: euro-area venues first, then the main US
 * venues (which only break ties among USD listings — currency comes first).
 */
export const DEFAULT_PREFERRED_EXCHANGES: readonly string[] = [
  'XAMS',
  'XETR',
  'XPAR',
  'XBRU',
  'XMIL',
  'XMAD',
  'XLIS',
  'XFRA',
  'XNAS',
  'XNYS',
  'ARCX',
  'BATS',
];

/** Minor-unit quote currencies (`GBp`) compare equal to their major unit. */
export function normalizeCurrency(currency: string | undefined): string {
  const c = (currency ?? '').trim();
  if (c === 'GBp' || c === 'GBX') return 'GBP';
  if (c === 'ZAc') return 'ZAR';
  if (c === 'ILA') return 'ILS';
  return c.toUpperCase();
}

function normalizeName(name: string | undefined): string {
  return (name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function rootSymbol(c: ListingCandidate): string {
  return (c.canonicalSymbol ?? c.symbol.split('.')[0] ?? '').trim().toUpperCase();
}

/** Parse a comma/space separated MIC list, e.g. from a settings field. */
export function parseExchangeList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const mic = part.trim().toUpperCase();
    if (mic && !out.includes(mic)) out.push(mic);
  }
  return out;
}

/** Rank candidates, best first. Stable for equal ranks (keeps input order). */
export function rankListings<T extends ListingCandidate>(
  candidates: readonly T[],
  ctx: ListingContext,
): RankedListing<T>[] {
  const anchor = normalizeName(ctx.anchorName);
  const source = (ctx.sourceSymbol ?? '').trim().toUpperCase();
  const traded = normalizeCurrency(ctx.tradedCurrency);
  const prefs = ctx.preferredExchanges.map((m) => m.toUpperCase());
  const ranked = candidates.map((candidate, index) => {
    const names = [normalizeName(candidate.longName), normalizeName(candidate.shortName)];
    const sameInstrument = anchor
      ? names.includes(anchor)
      : source
        ? rootSymbol(candidate) === source
        : true;
    const currencyMatch = traded !== '' && normalizeCurrency(candidate.currency) === traded;
    const pos = prefs.indexOf((candidate.exchangeMic ?? '').toUpperCase());
    return {
      candidate,
      index,
      sameInstrument,
      currencyMatch,
      exchangeRank: pos === -1 ? Number.POSITIVE_INFINITY : pos,
    };
  });
  return ranked.sort(
    (a, b) =>
      Number(b.sameInstrument) - Number(a.sameInstrument) ||
      Number(b.currencyMatch) - Number(a.currencyMatch) ||
      a.exchangeRank - b.exchangeRank ||
      a.index - b.index,
  );
}

/**
 * The listing to suggest, or undefined when the reviewer must choose: the
 * best-ranked listing must be the same instrument, in the traded currency,
 * and strictly preferred over every other such listing.
 */
export function suggestListing<T extends ListingCandidate>(
  ranked: readonly RankedListing<T>[],
): RankedListing<T> | undefined {
  const eligible = ranked.filter((r) => r.sameInstrument && r.currencyMatch);
  const [best, next] = eligible;
  if (!best) return undefined;
  if (next && next.exchangeRank === best.exchangeRank) return undefined;
  return best;
}

/** Stable identity used to de-duplicate results across several searches. */
export function listingKey(c: ListingCandidate): string {
  return `${c.symbol.toUpperCase()}|${(c.exchangeMic ?? '').toUpperCase()}`;
}
