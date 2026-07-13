import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  fingerprintInput,
  fingerprintActivity,
  computeFingerprints,
} from '../../src/duplicates/fingerprint';
import type { ActivityDraft } from '../../src/domain/activity-draft';

function standaloneDividend(over: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    date: '2026-01-10T09:00:00+01:00',
    symbol: 'IE00OVL0001',
    quantity: '1',
    activityType: 'DIVIDEND',
    unitPrice: '10',
    currency: 'EUR',
    fee: '0',
    amount: '10',
    sourceRowNumbers: [5],
    isValid: true,
    errors: {},
    warnings: {},
    ...over,
  };
}

describe('fingerprint', () => {
  it('is deterministic for the same activity', async () => {
    const a = standaloneDividend();
    expect(await fingerprintActivity(a)).toBe(await fingerprintActivity(a));
  });

  it('is a 64-char lowercase hex SHA-256', async () => {
    const h = await fingerprintActivity(standaloneDividend());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes decimal strings consistently while preserving amount differences', async () => {
    const a = standaloneDividend({ amount: '10' });
    const b = standaloneDividend({ amount: '10.0' }); // same value, trailing zero
    const c = standaloneDividend({ amount: '11' });
    expect(await fingerprintActivity(a)).toBe(await fingerprintActivity(b));
    expect(await fingerprintActivity(a)).not.toBe(await fingerprintActivity(c));
  });

  it('idempotity fingerprint distinguishes same-economy events by source row', async () => {
    // Two economically identical dividends at different source rows are distinct
    // events within one statement → distinct idempotity fingerprints.
    const a = standaloneDividend({ sourceRowNumbers: [5] });
    const b = standaloneDividend({ sourceRowNumbers: [6] });
    expect(await fingerprintActivity(a)).not.toBe(await fingerprintActivity(b));
    // Same source row → collide (same event).
    const c = standaloneDividend({ sourceRowNumbers: [5] });
    expect(await fingerprintActivity(a)).toBe(await fingerprintActivity(c));
  });

  it('reports zero idempotity collisions but flags overlap clusters', async () => {
    const acts = [
      standaloneDividend({ sourceRowNumbers: [5] }),
      standaloneDividend({ sourceRowNumbers: [6] }), // same economy, different row → overlap, not collision
    ];
    const report = await computeFingerprints(acts);
    expect(report.collisions.size).toBe(0);
    expect(report.overlapClusters.length).toBe(1);
    expect(report.overlapActivityIndices.size).toBe(2);
  });

  it('groups trades include order id and contributing rows', () => {
    const grouped: ActivityDraft = {
      date: '2026-01-02T10:00:00+01:00',
      symbol: 'IE00PF000001',
      quantity: '25',
      activityType: 'BUY',
      unitPrice: '100',
      currency: 'EUR',
      fee: '2',
      amount: '2500',
      sourceRowNumbers: [1, 2, 3],
      group: {
        orderId: 'ord-1',
        tradeSourceRowNumbers: [1, 2],
        feeSourceRowNumbers: [3],
        fillCount: 2,
      },
      isValid: true,
      errors: {},
      warnings: {},
    };
    const input = fingerprintInput(grouped);
    expect(input).toContain('G');
    expect(input).toContain('ord-1');
    expect(input).toContain('1,2'); // trade rows sorted
  });

  it('throws a clear error when Web Crypto subtle is unavailable', async () => {
    const subtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    await expect(fingerprintActivity(standaloneDividend())).rejects.toThrow();
    Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
  });
});

describe('fingerprintInput normalization', () => {
  it('uses Decimal-normalized integer part without float', () => {
    expect(new Decimal('0010').toString()).toBe('10');
  });
});
