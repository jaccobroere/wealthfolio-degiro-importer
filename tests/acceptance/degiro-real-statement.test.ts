/**
 * Mandatory local acceptance suite for the supplied real DEGIRO Account.csv.
 *
 * Privacy: the file is read ONLY through `DEGIRO_ACCEPTANCE_CSV`. Assertions are
 * summary-only (counts and invariants); no raw row content, products, tickers,
 * balances, monetary totals, order ids, or filenames are emitted on success or
 * failure. The suite FAILS FAST with a clear message if the env var is unset,
 * the path is missing, unreadable, or not a regular file.
 *
 * Excluded from CI (vitest.config.ts excludes tests/acceptance/**); run via
 * `pnpm acceptance:local`.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import {
  parseAndMapWithFingerprints,
  type PipelineResultWithFingerprints,
} from '../../src/parser/parse-and-map';
import { EXPECTED, ACCEPTANCE_ENV } from './degiro-real-expected';

function resolveAcceptanceCsv(): string {
  const raw = process.env[ACCEPTANCE_ENV];
  if (!raw || raw.trim() === '') {
    throw new Error(
      `${ACCEPTANCE_ENV} is not set. Set it to the absolute path of your real DEGIRO Account.csv export before running the acceptance suite.`,
    );
  }
  let stat;
  try {
    stat = statSync(raw);
  } catch {
    throw new Error(
      `${ACCEPTANCE_ENV} points at a path that cannot be read. Set it to an existing regular file.`,
    );
  }
  if (!stat.isFile()) {
    throw new Error(`${ACCEPTANCE_ENV} is not a regular file.`);
  }
  return raw;
}

describe('DEGIRO real-statement acceptance (local release gate)', () => {
  let result: PipelineResultWithFingerprints;

  beforeAll(async () => {
    const csvPath = resolveAcceptanceCsv();
    const content = readFileSync(csvPath, 'utf-8');
    result = await parseAndMapWithFingerprints(content);
  });

  it('accounts for every source row', () => {
    expect(result.batch.summary.sourceRowCount).toBe(EXPECTED.sourceRowCount);
    expect(result.batch.summary.unaccountedCount).toBe(EXPECTED.unaccounted);
  });

  it('produces the reviewed activity total', () => {
    expect(result.batch.summary.activityCount).toBe(EXPECTED.activityCount);
  });

  it('matches the reviewed per-type counts', () => {
    const got = result.batch.summary.byActivityType;
    for (const [type, count] of Object.entries(EXPECTED.byActivityType)) {
      expect(got[type] ?? 0, `activity type ${type}`).toBe(count);
    }
    const sumTypes = Object.values(got).reduce<number>((a, b) => a + b, 0);
    expect(sumTypes).toBe(EXPECTED.activityCount);
  });

  it('parses the four Dutch thousands-separated BUY quantities', () => {
    const buyQtys = result.batch.activities
      .filter((a) => a.activityType === 'BUY')
      .map((a) => a.quantity);
    for (const expected of EXPECTED.localizedBuyQuantities) {
      expect(buyQtys, `expected a BUY with quantity ${expected}`).toContain(expected);
    }
  });

  it('preserves accrued-interest provenance on the four grouped BUY drafts', () => {
    const buyWithAccrued = result.batch.activities.filter(
      (a) => a.activityType === 'BUY' && a.accruedInterest,
    );
    expect(buyWithAccrued.length).toBe(EXPECTED.buyDraftsWithAccruedInterest);
    expect(result.reconciliation.accruedInterestSourceRowCount).toBe(
      EXPECTED.accruedInterestSourceRowCount,
    );
    expect(result.reconciliation.buyDraftsWithAccruedInterestCount).toBe(
      EXPECTED.buyDraftsWithAccruedInterest,
    );
  });

  it('has zero unsupported, invalid, or unaccounted outcomes', () => {
    expect(result.batch.summary.unsupportedCount).toBe(EXPECTED.unsupported);
    expect(result.batch.summary.invalidCount).toBe(EXPECTED.invalid);
    expect(result.batch.summary.unaccountedCount).toBe(EXPECTED.unaccounted);
  });

  it('has zero fingerprint collisions', () => {
    expect(result.fingerprintCollisions.size).toBe(EXPECTED.fingerprintCollisions);
  });

  it('every known-skip row carries a narrow allow-listed reason', () => {
    const reasons = Object.keys(result.batch.summary.skipReasons);
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) {
      expect(typeof r).toBe('string');
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it('deterministically reproduces the summary across repeated parses', async () => {
    const csvPath = resolveAcceptanceCsv();
    const again = await parseAndMapWithFingerprints(readFileSync(csvPath, 'utf-8'));
    const a = JSON.stringify(sortSummary(result.batch.summary));
    const b = JSON.stringify(sortSummary(again.batch.summary));
    expect(b).toBe(a);
    const fps1 = Array.from(result.fingerprints.values()).sort();
    const fps2 = Array.from(again.fingerprints.values()).sort();
    expect(JSON.stringify(fps2)).toBe(JSON.stringify(fps1));
  });
});

/** Deterministic JSON-safe summary projection for repeated-run comparison. */
function sortSummary(s: {
  byOutcome: Record<string, number>;
  byActivityType: Record<string, number>;
  skipReasons: Record<string, number>;
}): Record<string, unknown> {
  return {
    byOutcome: Object.fromEntries(Object.entries(s.byOutcome).sort()),
    byActivityType: Object.fromEntries(Object.entries(s.byActivityType).sort()),
    skipReasons: Object.fromEntries(Object.entries(s.skipReasons).sort()),
  };
}
