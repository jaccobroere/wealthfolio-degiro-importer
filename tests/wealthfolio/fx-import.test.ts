import { describe, expect, it } from 'vitest';
import type { ActivityDraft } from '../../src/domain/activity-draft';
import { runImport } from '../../src/wealthfolio/import';
import { createFakeHost } from './fake-host';

const pair: ActivityDraft[] = [
  { activityType: 'TRANSFER_OUT', currency: 'EUR', amount: '16', sourceRowNumbers: [1] },
  { activityType: 'TRANSFER_IN', currency: 'USD', amount: '20', sourceRowNumbers: [2] },
].map((leg) => ({
  ...leg,
  activityType: leg.activityType as ActivityDraft['activityType'],
  symbol: `$CASH-${leg.currency}`,
  date: '2026-01-02T10:00:00+01:00',
  quantity: '0',
  unitPrice: '0',
  fee: '0',
  sourceGroupId: 'degiro-fx:synthetic',
  isValid: true,
  errors: {},
  warnings: {},
}));

describe('FX persistence on Wealthfolio 3.6.1', () => {
  it('saves linked internal cash legs and skips them on repeat and shifted exports', async () => {
    const host = createFakeHost();
    const first = await runImport(host.api, 'acct-1', pair);
    expect(first.created).toBe(2);
    expect(first.failures).toEqual([]);
    expect(host.importCalls).toHaveLength(0);
    const creates = host.saveManyCalls[0].request.creates!;
    expect(creates.map((a) => a.sourceGroupId)).toEqual(pair.map((a) => a.sourceGroupId));
    expect(creates.every((a) => JSON.parse(a.metadata as string).flow.is_external === false)).toBe(
      true,
    );
    const again = await runImport(host.api, 'acct-1', pair);
    expect(again.created).toBe(0);
    expect(again.skippedDuplicates).toBe(2);
    const shifted = await runImport(
      host.api,
      'acct-1',
      pair.map((a) => ({ ...a, sourceRowNumbers: a.sourceRowNumbers.map((n) => n + 10) })),
    );
    expect(shifted.created).toBe(0);
    expect(shifted.skippedDuplicates).toBe(2);
    expect(host.saveManyCalls).toHaveLength(1);
  });

  it('blocks both legs if the host rejects one during review', async () => {
    const host = createFakeHost({
      checkImportTransform: (rows) => rows.map((a, i) => ({ ...a, isValid: i !== 0 })),
    });
    const result = await runImport(host.api, 'acct-1', pair);
    expect(result.blocked).toBe(2);
    expect(result.created).toBe(0);
    expect(host.saveManyCalls).toHaveLength(0);
    expect(host.importCalls).toHaveLength(0);
  });

  it('counts only proven saves and retries just the missing companion', async () => {
    const options = { saveManyErrorCount: 1 };
    const host = createFakeHost(options);
    const first = await runImport(host.api, 'acct-1', pair);
    expect(first.created).toBe(1);
    expect(first.failedFingerprints).toHaveLength(1);
    options.saveManyErrorCount = 0;
    const retry = await runImport(host.api, 'acct-1', pair);
    expect(retry.created).toBe(1);
    expect(retry.skippedDuplicates).toBe(1);
    expect(host.saveManyCalls[1].request.creates).toHaveLength(1);
    expect((await runImport(host.api, 'acct-1', pair)).created).toBe(0);
    expect(host.storedActivities).toHaveLength(2);
  });

  it('never records failed conversions as imported', async () => {
    const host = createFakeHost({ saveManyError: new Error('host rejected request') });
    const result = await runImport(host.api, 'acct-1', pair);
    expect(result.created).toBe(0);
    expect(result.importedFingerprints).toEqual([]);
    expect(result.failedFingerprints).toHaveLength(2);
  });
});
