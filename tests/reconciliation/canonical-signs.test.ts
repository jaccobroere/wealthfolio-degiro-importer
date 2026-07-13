import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseAndMapWithFingerprints } from '../../src/parser/parse-and-map';

const fixture = path.join(import.meta.dirname, '../fixtures/degiro-canonical-signs.csv');

describe('canonical DEGIRO cash signs', () => {
  it('reconciles deposit, buy, sell, withdrawal, and dividend to EUR 52', async () => {
    const result = await parseAndMapWithFingerprints(readFileSync(fixture, 'utf8'));

    expect(result.batch.summary.unaccountedCount).toBe(0);
    expect(result.batch.summary.invalidCount).toBe(0);
    expect(result.reconciliation.cashByCurrency).toContainEqual(
      expect.objectContaining({ currency: 'EUR', netAmount: '52' }),
    );
  });
});
