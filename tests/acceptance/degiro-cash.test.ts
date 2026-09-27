import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { loadCashTruth } from './cash-truth';
import { createFakeHost } from '../wealthfolio/fake-host';
import { runImport } from '../../src/wealthfolio/import';

describe('local full-history cash truth signal', () => {
  it('accounts for every source row and reconciles consolidated bank and foreign cash', async () => {
    const { parsed, batch, reconciliation, mutationsConserved, matchesTargets } = loadCashTruth();
    expect(batch.summary.invalidCount).toBe(0);
    expect(batch.summary.unsupportedCount).toBe(0);
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(new Set(batch.outcomes.map((o) => o.rowIndex)).size).toBe(parsed.rows.length);
    expect(mutationsConserved).toBe(true);
    expect(
      matchesTargets(
        new Map(reconciliation.cashByCurrency.map((c) => [c.currency, new Decimal(c.netAmount)])),
      ),
    ).toBe(true);
    const host = createFakeHost();
    const first = await runImport(host.api, 'synthetic-account', batch.activities);
    expect(first.fatal === undefined).toBe(true);
    expect(first.failures.length).toBe(0);
    expect(first.created).toBe(batch.activities.length);
    const repeat = await runImport(host.api, 'synthetic-account', batch.activities);
    expect(repeat.created).toBe(0);
    expect(repeat.skippedDuplicates).toBe(batch.activities.length);
  });
});
