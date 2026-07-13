import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAndMap, parseAndMapWithFingerprints } from '../src/parser/parse-and-map';

const FIXTURES = join(__dirname, 'fixtures');

describe('parseAndMap — upstream example fixture (golden)', () => {
  const { batch } = parseAndMap(readFileSync(join(FIXTURES, 'degiro-example.csv'), 'utf-8'));

  it('accounts for every source row', () => {
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(batch.summary.unsupportedCount).toBe(0);
    expect(batch.summary.invalidCount).toBe(0);
  });

  it('produces the reviewed per-type counts for the example', () => {
    // Example has: 1 SELL, 1 DIVIDEND (USD), 1 INTEREST, 2 deposits
    // (iDEAL storting + flatex storting), 2 FEE (aansluitingskosten 2025/2026),
    // 1 FTT tax. The transactiekosten rows lack an order id in the example, so
    // they become orphan-trade-fee skips.
    expect(batch.summary.byActivityType.SELL).toBe(1);
    expect(batch.summary.byActivityType.DIVIDEND).toBe(1);
    expect(batch.summary.byActivityType.INTEREST).toBe(1);
    expect(batch.summary.byActivityType.DEPOSIT).toBe(2);
    expect(batch.summary.byActivityType.FEE).toBe(2);
    expect(batch.summary.byActivityType.TAX).toBe(1);
  });

  it('classifies FX rows and cash sweeps as known-skip', () => {
    expect(batch.summary.skipReasons['fx-helper']).toBeGreaterThanOrEqual(2);
    expect(batch.summary.byOutcome['known-skip']).toBeGreaterThan(0);
  });
});

describe('parseAndMap — localized-quantities fixture (the bug fix)', () => {
  const { batch } = parseAndMap(
    readFileSync(join(FIXTURES, 'degiro-localized-quantities.csv'), 'utf-8'),
  );

  it('produces exactly four BUY activities with corrected quantities', () => {
    expect(batch.summary.byActivityType.BUY).toBe(4);
    const qtys = batch.activities
      .filter((a) => a.activityType === 'BUY')
      .map((a) => a.quantity)
      .sort();
    expect(qtys).toEqual(['1234', '1750', '2506', '6408']);
  });

  it('preserves accrued interest on all four BUY drafts', () => {
    const withAccrued = batch.activities.filter(
      (a) => a.activityType === 'BUY' && a.accruedInterest,
    );
    expect(withAccrued).toHaveLength(4);
  });

  it('has zero unsupported/invalid/unaccounted', () => {
    expect(batch.summary.unsupportedCount).toBe(0);
    expect(batch.summary.invalidCount).toBe(0);
    expect(batch.summary.unaccountedCount).toBe(0);
  });
});

describe('parseAndMap — unknown-type fixture (blocks, never auto-skip)', () => {
  const { batch } = parseAndMap(readFileSync(join(FIXTURES, 'degiro-unknown-type.csv'), 'utf-8'));

  it('surfaces an unsupported outcome for the unrecognized row', () => {
    expect(batch.summary.unsupportedCount).toBe(1);
    expect(batch.summary.byOutcome.unsupported).toBe(1);
  });
});

describe('parseAndMap — overlap fixture (overlap detection, not silent merge)', () => {
  it('preserves both identical dividends as distinct events and flags an overlap cluster', async () => {
    const result = await parseAndMapWithFingerprints(
      readFileSync(join(FIXTURES, 'degiro-overlap.csv'), 'utf-8'),
    );
    // Idempotity fingerprints are unique per source row → zero within-batch collisions.
    expect(result.hasFingerprintCollision).toBe(false);
    // The two economically identical dividends share a coarser overlap key.
    const dividendCluster = result.overlapClusters.find((c) => c.activityIndices.length === 2);
    expect(dividendCluster, 'expected one overlap cluster of size 2').toBeDefined();
    expect(result.overlapActivityCount).toBeGreaterThanOrEqual(2);
  });

  it('re-importing (parsing twice) yields identical fingerprints — exact duplicate detection', async () => {
    const content = readFileSync(join(FIXTURES, 'degiro-overlap.csv'), 'utf-8');
    const a = await parseAndMapWithFingerprints(content);
    const b = await parseAndMapWithFingerprints(content);
    const fps1 = Array.from(a.fingerprints.values()).sort();
    const fps2 = Array.from(b.fingerprints.values()).sort();
    expect(JSON.stringify(fps2)).toBe(JSON.stringify(fps1));
  });
});
