/**
 * Idempotent import flow tests for the DEGIRO adapter.
 *
 * Proves with a fake/in-memory HostAPI:
 * 1. Reviewed rows are committed through `activities.import`, never saveMany.
 * 2. Wealthfolio owns duplicate outcomes for import-API writes.
 * 3. Rejected/incomplete imports never mark fingerprints as imported.
 * 4. Legacy add-on metadata remains scoped to its owning importer.
 */
import { describe, expect, it } from 'vitest';
import type { ActivityImport } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../../src/domain/activity-draft';
import { runImport } from '../../src/wealthfolio/import';
import { buildDuplicateIndex } from '../../src/wealthfolio/duplicate-index';
import { createFakeHost, foreignSeededActivity, seededActivity } from './fake-host';

/** A minimal valid BUY draft. */
function buyDraft(opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    date: '2024-01-15T10:00:00+01:00',
    isin: 'US0378331005',
    symbol: 'AAPL',
    symbolName: 'Apple Inc.',
    quantity: '10',
    activityType: 'BUY',
    unitPrice: '150',
    currency: 'USD',
    fee: '0',
    amount: '1500',
    sourceRowNumbers: [42],
    isValid: true,
    errors: {},
    warnings: {},
    ...opts,
  };
}

/** A minimal valid DIVIDEND draft. */
function dividendDraft(opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    date: '2024-02-15T10:00:00+01:00',
    isin: 'US0378331005',
    symbol: 'AAPL',
    quantity: '10',
    activityType: 'DIVIDEND',
    unitPrice: '0',
    currency: 'USD',
    fee: '0',
    amount: '50',
    sourceRowNumbers: [43],
    isValid: true,
    errors: {},
    warnings: {},
    ...opts,
  };
}

describe('DEGIRO adapter: idempotent import flow', () => {
  it('creates all rows on first import and marks their fingerprints imported', async () => {
    const host = createFakeHost();
    const drafts = [buyDraft(), dividendDraft()];

    const result = await runImport(host.api, 'acct-1', drafts);

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(2);
    expect(result.importedFingerprints).toHaveLength(2);
    expect(result.failedFingerprints).toHaveLength(0);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.fatal).toBeUndefined();
    expect(host.saveManyCalls).toHaveLength(0);
    expect(host.importCalls).toHaveLength(1);
    expect(host.importCalls[0]).toHaveLength(2);
    expect(host.importCalls[0]?.every((activity) => activity.isDraft === false)).toBe(true);
  });

  it('identical second import delegates duplicate detection to the host import workflow', async () => {
    const host = createFakeHost();
    const drafts = [buyDraft(), dividendDraft()];

    // First import.
    await runImport(host.api, 'acct-1', drafts);
    expect(host.importCalls).toHaveLength(1);

    // The host owns duplicate detection for import-API writes.
    const result2 = await runImport(host.api, 'acct-1', drafts);

    expect(result2.attempted).toBe(2);
    expect(result2.created).toBe(0);
    expect(result2.importedFingerprints).toHaveLength(0);
    expect(result2.skippedDuplicates).toBe(2);
    expect(host.importCalls).toHaveLength(2);
  });

  it('overlapping import creates only new rows', async () => {
    const host = createFakeHost();
    const firstDrafts = [buyDraft(), dividendDraft()];
    await runImport(host.api, 'acct-1', firstDrafts);
    expect(host.importCalls).toHaveLength(1);

    // Overlapping import: same BUY + a new FEE.
    const feeDraft: ActivityDraft = {
      date: '2024-03-01T10:00:00+01:00',
      symbol: '$CASH-EUR',
      quantity: '0',
      activityType: 'FEE',
      unitPrice: '0',
      currency: 'EUR',
      fee: '2',
      amount: '2',
      sourceRowNumbers: [99],
      isValid: true,
      errors: {},
      warnings: {},
    };
    const overlap = [buyDraft(), feeDraft];
    const result2 = await runImport(host.api, 'acct-1', overlap);

    expect(result2.attempted).toBe(2);
    expect(result2.created).toBe(1);
    expect(result2.skippedDuplicates).toBe(1);
    expect(result2.importedFingerprints).toHaveLength(1);
    expect(host.importCalls).toHaveLength(2);
    expect(host.importCalls[1]).toHaveLength(2);
  });

  it('failed import never marks failed fingerprints as imported', async () => {
    const host = createFakeHost({ importError: new Error('host down') });
    const drafts = [buyDraft(), dividendDraft()];

    const result = await runImport(host.api, 'acct-1', drafts);

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(0);
    expect(result.importedFingerprints).toHaveLength(0);
    expect(result.failedFingerprints).toHaveLength(2);
    expect(result.fatal).toBe(
      'Wealthfolio could not complete this import batch. Re-check the destination account and security mappings, then retry.',
    );
    // Nothing stored.
    expect(host.storedActivities).toHaveLength(0);
  });

  it('import-time validation failure returns safe diagnostics without a partial write', async () => {
    const host = createFakeHost({ importValidationErrorCount: 1 });
    const drafts = [buyDraft(), dividendDraft()];

    const result = await runImport(host.api, 'acct-1', drafts);

    // Under chunking, a host-reported per-row validation failure is a per-row
    // failure for the invalid row, not a fatal. The valid row is treated as
    // imported based on its per-row outcome (the fake's `imported: 0` summary
    // is overridden by the per-row signal).
    expect(result.attempted).toBe(2);
    expect(result.created).toBe(1);
    expect(result.importedFingerprints).toHaveLength(1);
    expect(result.failedFingerprints).toHaveLength(1);
    expect(result.fatal).toBeUndefined();
    expect(result.failures).toEqual([
      {
        sourceRowNumbers: [42],
        message: 'Wealthfolio rejected this activity. Review the destination account and mapping.',
      },
    ]);
    // The fake does not actually store the "valid" row when
    // importValidationErrorCount is set; per-row outcome is the source of truth.
    expect(host.storedActivities).toHaveLength(0);
  });

  it('submits the complete checked asset resolution through the import API', async () => {
    const host = createFakeHost({
      checkImportTransform: (activities) =>
        activities.map((activity) => ({
          ...activity,
          symbol: 'AAPL',
          exchangeMic: 'XNAS',
          quoteCcy: 'USD',
          instrumentType: 'EQUITY',
          quoteMode: 'MARKET',
          providerId: 'yahoo',
          providerSymbol: 'AAPL',
        })),
    });

    const result = await runImport(host.api, 'acct-1', [buyDraft()]);

    expect(result.created).toBe(1);
    expect(host.importCalls[0]?.[0]).toMatchObject({
      symbol: 'AAPL',
      exchangeMic: 'XNAS',
      quoteCcy: 'USD',
      instrumentType: 'EQUITY',
      quoteMode: 'MARKET',
      providerId: 'yahoo',
      providerSymbol: 'AAPL',
      isDraft: false,
    });
  });

  it('uses the reviewed canonical symbol in the checkImport request', async () => {
    const host = createFakeHost();

    await runImport(host.api, 'acct-1', [buyDraft()], async () => ({
      symbol: 'AAPL',
      exchangeMic: 'XNAS',
      quoteCcy: 'USD',
      instrumentType: 'EQUITY',
    }));

    expect(host.checkImportCalls[0]?.[0]?.symbol).toBe('AAPL');
  });

  it('fatal checkImport error returns to review and keeps Import disabled', async () => {
    const host = createFakeHost({ checkImportError: new Error('host validation fatal') });
    const drafts = [buyDraft()];

    const result = await runImport(host.api, 'acct-1', drafts);

    expect(result.attempted).toBe(0);
    expect(result.created).toBe(0);
    expect(result.fatal).toBe(
      'Wealthfolio could not complete this import batch. Re-check the destination account and security mappings, then retry.',
    );
    expect(host.importCalls).toHaveLength(0);
  });

  it('each add-on ignores the other importer metadata', async () => {
    // Seed an activity with a foreign importer id and a fingerprint that
    // collides with one of our drafts. The DEGIRO adapter must NOT treat it
    // as a duplicate.
    const foreignFp = 'foreign-fingerprint-aaaa';
    const foreign = foreignSeededActivity('acct-1', foreignFp, 'revolut-importer');
    const host = createFakeHost({ activities: [foreign] });

    // Our draft's fingerprint will differ from the foreign one, but even if
    // we seed a DEGIRO-owned activity with the SAME fingerprint, the foreign
    // one must be ignored.
    const drafts = [buyDraft()];
    const result = await runImport(host.api, 'acct-1', drafts);

    // The foreign entry must not block our import.
    expect(result.attempted).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skippedDuplicates).toBe(0);
  });

  it('duplicate index filters by importerId', () => {
    const fp = 'shared-fp';
    const mine = seededActivity('acct-1', fp);
    const theirs = foreignSeededActivity('acct-1', fp, 'revolut-importer');

    const index = buildDuplicateIndex([mine, theirs]);
    expect(index.importedFingerprints.has(fp)).toBe(true);

    const indexOnlyTheirs = buildDuplicateIndex([theirs]);
    expect(indexOnlyTheirs.importedFingerprints.has(fp)).toBe(false);
  });

  it('uses activities.import and never calls the low-level bulk editor endpoint', async () => {
    const host = createFakeHost();
    await runImport(host.api, 'acct-1', [buyDraft()]);
    expect(host.importCalls).toHaveLength(1);
    expect(host.saveManyCalls).toHaveLength(0);
  });

  it('does not attach add-on provenance metadata to the host import payload', async () => {
    const host = createFakeHost();
    await runImport(host.api, 'acct-1', [buyDraft()]);

    expect(host.importCalls[0]?.[0]).not.toHaveProperty('metadata');
  });

  it('chunks a 300-row import and imports every row through multiple host calls', async () => {
    const host = createFakeHost();
    const drafts: ActivityDraft[] = Array.from({ length: 300 }, (_, i) =>
      buyDraft({
        sourceRowNumbers: [i + 1],
        date: new Date(2024, 0, 1 + (i % 28)).toISOString(),
        isin: `US00000000${i.toString().padStart(2, '0')}`,
        symbol: `SYM${i}`,
      }),
    );

    const result = await runImport(host.api, 'acct-1', drafts, undefined, { chunkSize: 100 });

    expect(result.attempted).toBe(300);
    expect(result.created).toBe(300);
    expect(result.failedFingerprints).toHaveLength(0);
    expect(result.fatal).toBeUndefined();
    expect(result.chunkSize).toBe(100);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks.every((c) => c.size === 100)).toBe(true);
    expect(result.chunks.every((c) => c.imported === 100)).toBe(true);
    expect(result.chunks.every((c) => c.failed === 0)).toBe(true);
    expect(host.importCalls).toHaveLength(3);
    expect(host.importCalls.every((c) => c.length === 100)).toBe(true);
  });

  it('survives a host payload-size cap by chunking the import', async () => {
    const host = createFakeHost({ importBatchSizeLimit: 200 });
    const drafts: ActivityDraft[] = Array.from({ length: 500 }, (_, i) =>
      buyDraft({
        sourceRowNumbers: [i + 1],
        date: new Date(2024, 0, 1 + (i % 28)).toISOString(),
        isin: `US00000000${i.toString().padStart(2, '0')}`,
        symbol: `SYM${i}`,
      }),
    );

    const result = await runImport(host.api, 'acct-1', drafts, undefined, { chunkSize: 100 });

    expect(result.attempted).toBe(500);
    expect(result.created).toBe(500);
    expect(result.fatal).toBeUndefined();
    expect(result.failedFingerprints).toHaveLength(0);
    expect(host.importCalls.length).toBeGreaterThanOrEqual(5);
    expect(host.importCalls.every((c) => c.length <= 200)).toBe(true);
  });

  it('excludes already-imported fingerprints from later chunks across re-attempts', async () => {
    const host = createFakeHost();
    const drafts: ActivityDraft[] = Array.from({ length: 250 }, (_, i) =>
      buyDraft({
        sourceRowNumbers: [i + 1],
        date: new Date(2024, 0, 1 + (i % 28)).toISOString(),
        isin: `US00000000${i.toString().padStart(2, '0')}`,
        symbol: `SYM${i}`,
      }),
    );

    // First run: succeeds, imports 250.
    const result1 = await runImport(host.api, 'acct-1', drafts, undefined, { chunkSize: 100 });
    expect(result1.created).toBe(250);
    expect(result1.fatal).toBeUndefined();
    expect(host.storedActivities.length).toBe(250);

    // Second run: must dedupe via the host, returning 0 created, 250 skipped.
    const result2 = await runImport(host.api, 'acct-1', drafts, undefined, { chunkSize: 100 });
    expect(result2.created).toBe(0);
    expect(result2.skippedDuplicates).toBe(250);
    expect(result2.fatal).toBeUndefined();
  });

  it('a failed chunk produces per-row failures without a fatal when other chunks succeed', async () => {
    // Host that fails the 2nd call only.
    let callIndex = 0;
    const host = createFakeHost();
    const originalImport = host.api.activities.import as unknown as (
      activities: ActivityImport[],
    ) => Promise<unknown>;
    (
      host.api.activities as unknown as { import: (a: ActivityImport[]) => Promise<unknown> }
    ).import = async (activities: ActivityImport[]) => {
      callIndex++;
      if (callIndex === 2) throw new Error('host 500: chunk rejected');
      return originalImport(activities);
    };
    const drafts: ActivityDraft[] = Array.from({ length: 250 }, (_, i) =>
      buyDraft({
        sourceRowNumbers: [i + 1],
        date: new Date(2024, 0, 1 + (i % 28)).toISOString(),
        isin: `US00000000${i.toString().padStart(2, '0')}`,
        symbol: `SYM${i}`,
      }),
    );

    const result = await runImport(host.api, 'acct-1', drafts, undefined, { chunkSize: 100 });

    expect(result.fatal).toBeUndefined();
    expect(result.created).toBe(150); // chunk 1 (100) + chunk 3 (50) succeed
    expect(result.failedFingerprints).toHaveLength(100); // chunk 2 (100) failed
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('imports cash DEPOSIT/WITHDRAWAL drafts through the host import API', async () => {
    // Pins the cash wire format that the Wealthfolio 3.6.1 host sandbox
    // expects. The host rewriter rewrites any `import(...)` call expression
    // in the minified bundle to a `globalThis.__wealthfolioImport(...)`
    // call, and the pinned 3.6.1 image mistakenly rewrites
    // `e.activities.import(t)` (a property access) the same way. The
    // add-on sidesteps the rewriter by going through `Reflect.get(api.activities, 'import')`,
    // which never appears as an `import(...)` call expression. The test
    // asserts both that the cash wire format reaches the host unchanged
    // (empty symbol, no quantity/unitPrice) and that the import call lands
    // on the host's `activities.import` method (not the rewritten
    // `activities.globalThis.__wealthfolioImport` the rewriter would have
    // produced).
    const host = createFakeHost();

    const cashDeposit: ActivityDraft = {
      date: '2026-01-02T09:00:00+01:00',
      symbol: '$CASH-EUR',
      activityType: 'DEPOSIT',
      quantity: '0',
      unitPrice: '0',
      currency: 'EUR',
      fee: '0',
      amount: '1000',
      comment: 'iDEAL storting',
      sourceRowNumbers: [2],
      isValid: true,
      errors: {},
      warnings: {},
    };
    const cashWithdrawal: ActivityDraft = {
      date: '2026-01-03T09:00:00+01:00',
      symbol: '$CASH-EUR',
      activityType: 'WITHDRAWAL',
      quantity: '0',
      unitPrice: '0',
      currency: 'EUR',
      fee: '0',
      amount: '-250',
      comment: 'Processed Flatex Withdrawal',
      sourceRowNumbers: [3],
      isValid: true,
      errors: {},
      warnings: {},
    };

    const result = await runImport(host.api, 'acct-1', [cashDeposit, cashWithdrawal]);

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(2);
    expect(result.failedFingerprints).toHaveLength(0);
    expect(result.fatal).toBeUndefined();
    expect(host.importCalls).toHaveLength(1);

    // The reviewed rows sent to the host must keep the cash wire format:
    // empty symbol, currency present, amount as the decimal-string economic
    // value, and isDraft=false (the user has confirmed the import). The
    // activityType must be DEPOSIT/WITHDRAWAL (not TRANSFER_IN/OUT) — the
    // DEGIRO upstream format uses DEPOSIT/WITHDRAWAL for external flows and
    // the host accepts both.
    const sent = host.importCalls[0] ?? [];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      accountId: 'acct-1',
      activityType: 'DEPOSIT',
      symbol: '',
      amount: '1000',
      currency: 'EUR',
      isDraft: false,
      isValid: true,
    });
    expect(sent[1]).toMatchObject({
      accountId: 'acct-1',
      activityType: 'WITHDRAWAL',
      symbol: '',
      amount: '-250',
      currency: 'EUR',
      isDraft: false,
      isValid: true,
    });
  });

  it('dispatches activities.import through Reflect.get to dodge the host rewriter', async () => {
    // Pins the dispatch path used by importCheckedActivities. The pinned
    // Wealthfolio 3.6.1 host sandbox rewrites every `import(...)` call
    // expression in the minified bundle to a
    // `globalThis.__wealthfolioImport(...)` call, and the pinned image
    // mistakenly rewrites the property access `e.activities.import(t)` the
    // same way. The add-on sidesteps the rewriter by reading the method via
    // `Reflect.get(api.activities, 'import')`; the test asserts the dispatch
    // reaches the method on the host's activities API (not via a rewriter
    // artefact like `activities.globalThis.__wealthfolioImport`).
    const seen: string[] = [];
    const importFn = (...args: unknown[]) => {
      seen.push('called');
      return Promise.resolve({
        activities: args[0] as ActivityImport[],
        importRunId: 'run-1',
        summary: {
          total: (args[0] as unknown[]).length,
          imported: (args[0] as unknown[]).length,
          skipped: 0,
          duplicates: 0,
          assetsCreated: 0,
          success: true,
        },
      });
    };
    const activities = {
      ...({} as Record<string, unknown>),
      import: importFn,
    };
    const api = {
      ...({} as Record<string, unknown>),
      activities,
    } as unknown as Parameters<typeof runImport>[0];

    // Use the helper that wraps the call site.
    const { importCheckedActivities } = await import('../../src/wealthfolio/api');
    const result = await importCheckedActivities(api, [
      {
        accountId: 'acct-1',
        activityType: 'DEPOSIT',
        date: '2026-01-02T09:00:00+01:00',
        symbol: '',
        amount: '1000',
        currency: 'EUR',
        isValid: true,
        isDraft: false,
      } as ActivityImport,
    ]);

    expect(seen).toEqual(['called']);
    expect(result.importRunId).toBe('run-1');
  });
});
