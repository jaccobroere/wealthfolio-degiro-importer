import { describe, expect, it } from 'vitest';

import { importReducer, initialImportState } from '../../src/state/import-state';

describe('DEGIRO account-scoped mapping state', () => {
  it('clears resolved mappings, duplicate state, and acknowledgement when the destination changes', () => {
    const state = {
      ...initialImportState(),
      accountId: 'account-a',
      acknowledged: true,
      symbolResolutions: {
        US0378331005: {
          status: 'resolved' as const,
          mapping: {
            sourceTickerOrIsin: 'US0378331005',
            symbol: 'AAPL',
            fromSaved: true,
          },
        },
      },
      importedFingerprints: new Set(['previous-account-fingerprint']),
    };

    const next = importReducer(state, { type: 'SELECT_ACCOUNT', accountId: 'account-b' });

    expect(next.acknowledged).toBe(false);
    expect(next.symbolResolutions).toEqual({});
    expect(next.importedFingerprints).toEqual(new Set());
  });
});
