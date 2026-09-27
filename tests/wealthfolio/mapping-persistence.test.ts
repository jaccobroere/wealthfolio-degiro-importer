import { describe, expect, it } from 'vitest';
import type { HostAPI, ImportMappingData } from '@wealthfolio/addon-sdk';

import { MappingPersistence } from '../../src/wealthfolio/mapping-persistence';
import { withoutAllSavedMappings, withSavedMapping } from '../../src/wealthfolio/symbol-mappings';
import { IMPORTER_ID } from '../../src/wealthfolio/types';

function emptyMapping(): ImportMappingData {
  return {
    accountId: 'acct-1',
    fieldMappings: {},
    activityMappings: {},
    accountMappings: {},
    symbolMappings: {},
  };
}

function mappingApi(initial: ImportMappingData): { api: HostAPI; read: () => ImportMappingData } {
  let stored = initial;
  const api = {
    activities: {
      getImportMapping: async () => stored,
      saveImportMapping: async (mapping: ImportMappingData) => {
        stored = mapping;
        return mapping;
      },
    },
  } as unknown as HostAPI;
  return { api, read: () => stored };
}

describe('MappingPersistence', () => {
  it('does not let a queued stale save restore mappings after forget-all', async () => {
    const host = mappingApi(emptyMapping());
    const persistence = new MappingPersistence(host.api, IMPORTER_ID);

    const save = persistence.update('acct-1', (mapping) =>
      withSavedMapping(mapping, 'US0378331005', { symbol: 'AAPL' }),
    );
    const forget = persistence.updateAndRead('acct-1', withoutAllSavedMappings);

    await Promise.all([save, forget]);

    expect(host.read().symbolMappings).toEqual({});
    expect((await forget).symbolMappings).toEqual({});
  });
});
