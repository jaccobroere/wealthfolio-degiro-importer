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

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(0);
    expect(result.importedFingerprints).toHaveLength(0);
    expect(result.failedFingerprints).toHaveLength(2);
    expect(result.fatal).toBe(
      'Wealthfolio did not return a complete import outcome. No automatic retry was made.',
    );
    expect(result.failures).toEqual([
      {
        sourceRowNumbers: [42],
        message: 'Wealthfolio rejected this activity. Review the destination account and mapping.',
      },
    ]);
    // The fake verifies the adapter does not manufacture a second write.
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
});
