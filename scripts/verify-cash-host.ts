/** Opt-in local acceptance: writes ONLY to the repository's disposable host.
 * No screenshots, traces, raw errors, account identifiers or balances emitted.
 * Securities use manual identities to isolate cash economics from market data.
 */
import { Decimal } from 'decimal.js';
import type { ActivityDetails, HostAPI } from '@wealthfolio/addon-sdk';
import { loadCashTruth } from '../tests/acceptance/cash-truth';
import { runImport } from '../src/wealthfolio/import';

const origin = 'http://127.0.0.1:18088/api/v1';
let cookie = '';
let phase = 'source';
async function request(path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Disposable host request failed (${response.status}).`);
  cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
  return response.json();
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const truth = loadCashTruth();
  assert(truth.mutationsConserved, 'Source cash mutations were not conserved.');
  assert(
    truth.batch.summary.unsupportedCount === 0 &&
      truth.batch.summary.invalidCount === 0 &&
      truth.batch.summary.unaccountedCount === 0,
    'Source rows did not all pass review.',
  );
  phase = 'login';
  await request('/auth/login', { password: 'synthetic-test-password' });
  phase = 'empty-host';
  assert((await request('/accounts')).length === 0, 'Disposable host must have no accounts.');
  phase = 'account-create';
  const account = await request('/accounts', {
    name: 'Local Cash Acceptance',
    accountType: 'SECURITIES',
    currency: 'EUR',
    isDefault: true,
    isActive: true,
    trackingMode: 'TRANSACTIONS',
  });
  const api = {
    activities: {
      checkImport: (activities: unknown[]) => request('/activities/import/check', { activities }),
      import: (activities: unknown[]) => request('/activities/import', { activities }),
      saveMany: (payload: unknown) => request('/activities/bulk', payload),
      getAll: async (accountId: string) => {
        const rows = await request('/activities/search', {
          page: 0,
          pageSize: 10000,
          accountIdFilter: accountId,
        });
        return rows.data as ActivityDetails[];
      },
    },
  } as unknown as HostAPI;
  const resolve = async (draft: (typeof truth.batch.activities)[number]) => ({
    symbol: draft.symbol,
    quoteCcy: draft.currency,
    quoteMode: 'MANUAL' as const,
    instrumentType: 'EQUITY',
  });
  phase = 'import';
  const first = await runImport(api, account.id, truth.batch.activities, resolve);
  // Only structural outcomes are printed; host errors may contain private data.
  console.log(
    JSON.stringify({
      phase: 'first',
      created: first.created,
      blocked: first.blocked,
      failed: first.failures.length,
      fatal: Boolean(first.fatal),
    }),
  );
  assert(
    first.created === truth.batch.activities.length &&
      !first.fatal &&
      first.failures.length === 0 &&
      first.blocked === 0,
    'Host did not cleanly import every mapped activity.',
  );
  phase = 'repeat-import';
  const repeat = await runImport(api, account.id, truth.batch.activities, resolve);
  console.log(
    JSON.stringify({
      phase: 'repeat',
      created: repeat.created,
      duplicates: repeat.skippedDuplicates,
      blocked: repeat.blocked,
      failed: repeat.failures.length,
    }),
  );
  assert(
    repeat.created === 0 && repeat.skippedDuplicates === truth.batch.activities.length,
    'Host repeat import was not idempotent.',
  );
  const expected = new Map(
    truth.reconciliation.cashByCurrency.map((c) => [c.currency, new Decimal(c.netAmount)]),
  );
  assert(truth.matchesTargets(expected), 'Mapped cash does not match source balance targets.');
  let matches = false;
  phase = 'cash-holdings';
  for (let attempt = 0; attempt < 60; attempt++) {
    const holdings = await request(`/holdings?accountId=${encodeURIComponent(account.id)}`);
    const totals = new Map<string, Decimal>();
    for (const holding of holdings) {
      // The actual host holding DTO is checked during this local gate.
      if (holding.holdingType !== 'cash') continue;
      totals.set(holding.localCurrency, new Decimal(holding.quantity));
    }
    matches = [...new Set([...expected.keys(), ...totals.keys()])].every((ccy) =>
      // Equity cash is qty * effective price in 3.6.1, so repeating
      // divisions can leave sub-cent decimal residue. Compare at the source
      // statement's monetary precision, not exact arbitrary-precision equality.
      (totals.get(ccy) ?? new Decimal(0))
        .toDecimalPlaces(2)
        .eq((expected.get(ccy) ?? new Decimal(0)).toDecimalPlaces(2)),
    );
    if (matches) break;
    await new Promise((done) => setTimeout(done, 1000));
  }
  assert(matches, 'Actual host cash holdings differ from mapped source economics.');
  console.log(
    JSON.stringify({
      sourceRows: truth.parsed.rows.length,
      activities: first.created,
      failed: 0,
      repeatCreated: repeat.created,
      hostCashMatches: matches,
      sourceBalancesMatch: true,
    }),
  );
}

main().catch(() => {
  console.error(
    `Disposable-host cash acceptance failed at ${phase}. Inspect locally without publishing statement data.`,
  );
  process.exitCode = 1;
});
