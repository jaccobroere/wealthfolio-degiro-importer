/**
 * Fake/in-memory `HostAPI` for adapter unit tests.
 *
 * Implements only the surfaces the DEGIRO adapter calls:
 * `accounts.getAll`, `activities.{getAll,checkImport,saveMany,
 * getImportMapping,saveImportMapping}`, and `market.searchTicker`.
 *
 * `saveMany` is recorded so tests can assert it was always called with
 * `{ creates }` and never with `deleteIds` or a bare array.
 */
import type {
  Account,
  Activity,
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
  ActivityDetails,
  ActivityImport,
  HostAPI,
  ImportMappingData,
  SymbolSearchResult,
} from '@wealthfolio/addon-sdk';

import { IMPORTER_ID } from '../../src/wealthfolio/types';

export interface FakeHostOptions {
  /** Accounts returned by `accounts.getAll`. */
  accounts?: Account[];
  /** Activities already present on an account (seeded duplicate state). */
  activities?: ActivityDetails[];
  /** Search results returned by `market.searchTicker` for a given query. */
  searchResults?: Record<string, SymbolSearchResult[]>;
  /** Saved import mapping returned by `getImportMapping`. */
  importMapping?: ImportMappingData;
  /** When set, `saveMany` throws this error instead of resolving. */
  saveManyError?: Error;
  /** When set, `checkImport` throws this error instead of resolving. */
  checkImportError?: Error;
  /** When set, `saveMany` returns this many `errors` entries (simulating a
   * partial failure for the first N creates). */
  saveManyErrorCount?: number;
}

export interface RecordedSaveMany {
  /** The exact request object passed to `saveMany`. */
  request: ActivityBulkMutationRequest;
  /** Number of times `saveMany` was called. */
  callCount: number;
}

export interface FakeHost {
  api: HostAPI;
  /** Recorded `saveMany` calls. */
  saveManyCalls: RecordedSaveMany[];
  /** Activities currently stored (after `saveMany` applies creates). */
  storedActivities: ActivityDetails[];
  /** The last mapping passed to `saveImportMapping`. */
  savedMapping: ImportMappingData | undefined;
}

/** Build a minimal `ActivityDetails` from a created `Activity`. */
function toDetails(activity: Activity): ActivityDetails {
  return {
    id: activity.id,
    activityType: activity.activityType as ActivityDetails['activityType'],
    date: new Date(activity.activityDate),
    quantity: activity.quantity ?? null,
    unitPrice: activity.unitPrice ?? null,
    amount: activity.amount ?? null,
    fee: activity.fee ?? null,
    currency: activity.currency,
    needsReview: activity.needsReview,
    accountId: activity.accountId,
    accountName: 'fake',
    accountCurrency: 'EUR',
    assetSymbol: 'FAKE',
    createdAt: new Date(activity.createdAt),
    updatedAt: new Date(activity.updatedAt),
    assetId: activity.assetId ?? 'asset-1',
    metadata: activity.metadata as Record<string, unknown> | undefined,
  };
}

/** The host bulk wire DTO accepts serialized metadata and returns an object. */
function deserializeMetadata(metadata: string | Record<string, unknown> | undefined) {
  if (typeof metadata !== 'string') return metadata;
  return JSON.parse(metadata) as Record<string, unknown>;
}

/** Build a fake `HostAPI` with in-memory state and call recording. */
export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  const accounts = options.accounts ?? [
    {
      id: 'acct-1',
      name: 'DEGIRO',
      accountType: 'SECURITIES' as never,
      balance: 0,
      currency: 'EUR',
      isDefault: true,
      isActive: true,
      isArchived: false,
      trackingMode: 'TRANSACTIONS',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const storedActivities: ActivityDetails[] = [...(options.activities ?? [])];
  const saveManyCalls: RecordedSaveMany[] = [];
  let savedMapping: ImportMappingData | undefined;
  let idCounter = 1000;

  const activities = {
    getAll: async (accountId?: string): Promise<ActivityDetails[]> => {
      if (accountId === undefined) return [...storedActivities];
      return storedActivities.filter((a) => a.accountId === accountId);
    },
    search: async () => ({ data: [], meta: { totalRowCount: 0 } }),
    create: async () => {
      throw new Error('not used');
    },
    update: async () => {
      throw new Error('not used');
    },
    saveMany: async (request: ActivityBulkMutationRequest): Promise<ActivityBulkMutationResult> => {
      saveManyCalls.push({ request, callCount: saveManyCalls.length + 1 });
      if (options.saveManyError) throw options.saveManyError;
      const creates = request.creates ?? [];
      const errorCount = options.saveManyErrorCount ?? 0;
      const created: Activity[] = [];
      const errors: ActivityBulkMutationResult['errors'] = [];
      for (let i = 0; i < creates.length; i++) {
        const c = creates[i];
        if (i < errorCount) {
          errors.push({ id: `temp-${i}`, action: 'create', message: 'simulated failure' });
          continue;
        }
        const id = `act-${idCounter++}`;
        const now = new Date().toISOString();
        const activity: Activity = {
          id,
          accountId: c.accountId,
          activityType: c.activityType,
          status: 'POSTED',
          activityDate:
            typeof c.activityDate === 'string' ? c.activityDate : c.activityDate.toISOString(),
          quantity: c.quantity?.toString() ?? null,
          unitPrice: c.unitPrice?.toString() ?? null,
          amount: c.amount?.toString() ?? null,
          fee: c.fee?.toString() ?? null,
          currency: c.currency ?? 'EUR',
          metadata: deserializeMetadata(c.metadata),
          isUserModified: false,
          needsReview: true,
          createdAt: now,
          updatedAt: now,
        };
        created.push(activity);
        storedActivities.push(toDetails(activity));
      }
      return { created, updated: [], deleted: [], createdMappings: [], errors };
    },
    import: async () => {
      throw new Error('not used');
    },
    checkImport: async (activities: ActivityImport[]): Promise<ActivityImport[]> => {
      if (options.checkImportError) throw options.checkImportError;
      // Pass-through: mark all as valid (the adapter re-checks isValid).
      return activities.map((a) => ({ ...a, isValid: a.isValid ?? true }));
    },
    getImportMapping: async (
      _accountId: string,
      _contextKind?: string,
    ): Promise<ImportMappingData> => {
      return (
        options.importMapping ?? {
          accountId: _accountId,
          fieldMappings: {},
          activityMappings: {},
          symbolMappings: {},
          accountMappings: {},
        }
      );
    },
    saveImportMapping: async (mapping: ImportMappingData): Promise<ImportMappingData> => {
      savedMapping = mapping;
      return mapping;
    },
  };

  const market = {
    searchTicker: async (query: string): Promise<SymbolSearchResult[]> => {
      return options.searchResults?.[query] ?? [];
    },
    syncHistory: async () => {},
    sync: async () => {},
    getProviders: async () => [],
    fetchDividends: async () => [],
  };

  const api = {
    accounts: {
      getAll: async () => accounts,
      create: async () => {
        throw new Error('not used');
      },
    },
    activities,
    market,
    // Unused surfaces — present so the object satisfies HostAPI structurally.
    portfolio: {} as never,
    assets: {} as never,
    quotes: {} as never,
    performance: {} as never,
    exchangeRates: {} as never,
    contributionLimits: {} as never,
    goals: {} as never,
    settings: {} as never,
    files: {} as never,
    snapshots: {} as never,
    secrets: {} as never,
    logger: {} as never,
    events: {} as never,
    navigation: {} as never,
    query: {} as never,
    network: {} as never,
    toast: {} as never,
  } as unknown as HostAPI;

  return { api, saveManyCalls, storedActivities, savedMapping };
}

/** Build a seeded `ActivityDetails` with this importer's metadata. */
export function seededActivity(
  accountId: string,
  fingerprint: string,
  extra?: Partial<ActivityDetails>,
): ActivityDetails {
  return {
    id: `seed-${fingerprint.slice(0, 8)}`,
    activityType: 'BUY',
    date: new Date('2024-01-01T00:00:00Z'),
    quantity: '1',
    unitPrice: '100',
    amount: '100',
    fee: '0',
    currency: 'EUR',
    needsReview: false,
    accountId,
    accountName: 'DEGIRO',
    accountCurrency: 'EUR',
    assetSymbol: 'FAKE',
    createdAt: new Date(),
    updatedAt: new Date(),
    assetId: 'asset-1',
    metadata: {
      metadataVersion: 1,
      importerId: IMPORTER_ID,
      importerVersion: '1.1.0',
      sourceSchemaVersion: '1',
      sourceType: 'degiro-account-statement-csv',
      sourceFingerprint: fingerprint,
      sourceRowNumbers: [1],
    },
    ...extra,
  };
}

/** Build a seeded `ActivityDetails` with a foreign importer's metadata. */
export function foreignSeededActivity(
  accountId: string,
  fingerprint: string,
  importerId: string,
): ActivityDetails {
  return seededActivity(accountId, fingerprint, {
    metadata: {
      metadataVersion: 1,
      importerId,
      importerVersion: '0.1.0',
      sourceSchemaVersion: '1',
      sourceType: 'revolut-investment-csv',
      sourceFingerprint: fingerprint,
      sourceRowNumbers: [1],
    },
  });
}
