interface FigiResult {
  ticker: string;
  exchCode: string;
  currency?: string;
  name?: string;
  securityType?: string;
}

type FigiResponse = { data: FigiResult[] } | { error: string };

export interface FigiMatch {
  ticker: string;
  exchCode: string;
  currency?: string;
}

/**
 * Batch-resolve ISINs to tickers via OpenFIGI (free, no API key needed).
 * Returns a map of isin → best FigiMatch (currency-preferred), or null if not found.
 * https://www.openfigi.com/api
 */
export async function batchLookupFigi(
  entries: Array<{ isin: string; currency: string }>,
): Promise<Record<string, FigiMatch | null>> {
  const body = entries.map(e => ({ idType: 'ID_ISIN', idValue: e.isin }));

  const resp = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`OpenFIGI ${resp.status}`);

  const results: FigiResponse[] = await resp.json();
  const out: Record<string, FigiMatch | null> = {};

  for (let i = 0; i < entries.length; i++) {
    const { isin, currency } = entries[i];
    const item = results[i];

    if (!item || 'error' in item || !item.data?.length) {
      out[isin] = null;
      continue;
    }

    // Prefer a result whose currency matches the trade currency
    const match = item.data.find(r => r.currency === currency) ?? item.data[0];
    out[isin] = { ticker: match.ticker, exchCode: match.exchCode, currency: match.currency };
  }

  return out;
}
