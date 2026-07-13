import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import {
  parseAndMapWithFingerprints,
  type PipelineResultWithFingerprints,
} from '../../src/parser/parse-and-map';
import { loadBaseline } from './load-baseline';

type Baseline = {
  sourceRowCount: number;
  activityCount: number;
  byActivityType: Record<string, number>;
  localizedBuyQuantities: string[];
  buyDraftsWithAccruedInterest: number;
  accruedInterestSourceRowCount: number;
  unsupported: number;
  invalid: number;
  unaccounted: number;
  fingerprintCollisions: number;
};
function statementPath(): string {
  const path = process.env.DEGIRO_ACCEPTANCE_CSV;
  if (!path) throw new Error('DEGIRO_ACCEPTANCE_CSV is not set.');
  if (!statSync(path).isFile()) throw new Error('DEGIRO_ACCEPTANCE_CSV is not a file.');
  return path;
}

describe('DEGIRO local acceptance gate', () => {
  let result: PipelineResultWithFingerprints;
  let baseline: Baseline;
  beforeAll(async () => {
    baseline = loadBaseline<Baseline>();
    result = await parseAndMapWithFingerprints(readFileSync(statementPath(), 'utf8'));
  });
  it('matches the reviewed local structural baseline', () => {
    expect(result.batch.summary.sourceRowCount).toBe(baseline.sourceRowCount);
    expect(result.batch.summary.activityCount).toBe(baseline.activityCount);
    expect(result.batch.summary.byActivityType).toEqual(baseline.byActivityType);
    expect(result.batch.summary.unsupportedCount).toBe(baseline.unsupported);
    expect(result.batch.summary.invalidCount).toBe(baseline.invalid);
    expect(result.batch.summary.unaccountedCount).toBe(baseline.unaccounted);
    expect(result.fingerprintCollisions.size).toBe(baseline.fingerprintCollisions);
  });
  it('preserves localized quantities and accrued-interest provenance', () => {
    const quantities = result.batch.activities
      .filter((a) => a.activityType === 'BUY')
      .map((a) => a.quantity);
    for (const quantity of baseline.localizedBuyQuantities) expect(quantities).toContain(quantity);
    expect(
      result.batch.activities.filter((a) => a.activityType === 'BUY' && a.accruedInterest),
    ).toHaveLength(baseline.buyDraftsWithAccruedInterest);
    expect(result.reconciliation.accruedInterestSourceRowCount).toBe(
      baseline.accruedInterestSourceRowCount,
    );
    expect(result.reconciliation.buyDraftsWithAccruedInterestCount).toBe(
      baseline.buyDraftsWithAccruedInterest,
    );
  });
  it('is deterministic across repeated parses', async () => {
    const again = await parseAndMapWithFingerprints(readFileSync(statementPath(), 'utf8'));
    expect(JSON.stringify(again.batch.summary)).toBe(JSON.stringify(result.batch.summary));
    expect([...again.fingerprints.values()].sort()).toEqual(
      [...result.fingerprints.values()].sort(),
    );
  });
});
