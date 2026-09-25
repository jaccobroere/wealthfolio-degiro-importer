import { describe, expect, it } from 'vitest';

import {
  contentKey,
  matchExistingActivities,
  type ExistingActivityLike,
  type MatchableActivity,
} from '../../src/duplicates/existing-match';

function draft(opts: Partial<MatchableActivity> = {}): MatchableActivity {
  return {
    activityType: 'DIVIDEND',
    date: '2024-04-30T07:57:00+02:00',
    quantity: '1',
    unitPrice: '4.37',
    amount: '4.37',
    currency: 'EUR',
    assetSymbol: 'SYNB',
    ...opts,
  };
}

function stored(id: string, opts: Partial<ExistingActivityLike> = {}): ExistingActivityLike {
  return {
    id,
    activityType: 'DIVIDEND',
    date: '2024-04-30T05:57:00.000Z',
    quantity: null,
    unitPrice: null,
    amount: '4.37',
    currency: 'EUR',
    assetSymbol: 'SYNB',
    assetId: 'asset-ibgm',
    ...opts,
  };
}

describe('matchExistingActivities', () => {
  it('matches the same event regardless of source row numbers or stored precision', () => {
    const report = matchExistingActivities([draft()], [stored('a', { amount: '4.3700' })]);
    expect(report.matches).toEqual([{ kind: 'existing', existingId: 'a' }]);
    expect(report.counts).toMatchObject({ new: 0, existing: 1, extraCopies: 0 });
  });

  it('compares trades on quantity, not on a price that differs between versions', () => {
    const buy = draft({
      activityType: 'BUY',
      quantity: '37',
      unitPrice: '12.4108108108108',
      amount: '459.20',
      assetSymbol: 'SYNA',
    });
    const copy = stored('a', {
      activityType: 'BUY',
      quantity: '37',
      // Stored by an older version with the rounded display price.
      unitPrice: '12.41',
      amount: null,
      assetSymbol: 'SYNA',
    });
    expect(matchExistingActivities([buy], [copy]).matches[0]).toEqual({
      kind: 'existing',
      existingId: 'a',
    });
    expect(matchExistingActivities([buy], [{ ...copy, quantity: '38' }]).matches[0]?.kind).toBe(
      'new',
    );
  });

  it('accepts a stored copy that has no security linked, and reports it as unlinked', () => {
    const report = matchExistingActivities(
      [draft()],
      [stored('orphan', { assetSymbol: '', assetId: '' })],
    );
    expect(report.matches).toEqual([{ kind: 'existing-unlinked', existingId: 'orphan' }]);
  });

  it('prefers the linked copy and reports the unlinked one as an extra copy', () => {
    const orphan = stored('orphan', { assetSymbol: '', assetId: '' });
    const linked = stored('linked');
    const report = matchExistingActivities([draft()], [orphan, linked]);
    expect(report.matches).toEqual([{ kind: 'existing', existingId: 'linked' }]);
    expect(report.extraCopies.map((e) => e.id)).toEqual(['orphan']);
  });

  it('never matches a same-value activity on a different security', () => {
    const report = matchExistingActivities(
      [draft()],
      [stored('other', { assetSymbol: 'SYNC', assetId: 'asset-eun1' })],
    );
    expect(report.matches[0]?.kind).toBe('new');
    expect(report.extraCopies).toEqual([]);
  });

  it('is a multiset match for genuinely repeated bookkeeping rows', () => {
    const fee = draft({
      activityType: 'FEE',
      amount: '2.50',
      unitPrice: '2.50',
      assetSymbol: undefined,
    });
    const storedFee = (id: string) =>
      stored(id, { activityType: 'FEE', amount: '2.5', assetSymbol: '', assetId: '' });
    const report = matchExistingActivities([fee, fee, fee], [storedFee('f1'), storedFee('f2')]);
    expect(report.matches.map((m) => m.kind)).toEqual(['existing', 'existing', 'new']);
    expect(report.counts.new).toBe(1);
  });

  it('keeps activities on different days or in different currencies apart', () => {
    expect(
      matchExistingActivities([draft()], [stored('a', { date: '2024-05-01T05:57:00Z' })]).matches[0]
        ?.kind,
    ).toBe('new');
    expect(
      matchExistingActivities([draft()], [stored('a', { currency: 'USD' })]).matches[0]?.kind,
    ).toBe('new');
  });

  it('builds no key for unusable values instead of matching everything', () => {
    expect(contentKey({ ...draft(), amount: '', unitPrice: '', quantity: '' })).toBeUndefined();
    expect(contentKey({ ...draft(), date: 'not a date' })).toBeUndefined();
  });
});
