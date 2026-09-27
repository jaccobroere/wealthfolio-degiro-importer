/**
 * Fake/in-memory `HostAPI` for adapter unit tests.
 *
 * Implements only the surfaces the DEGIRO adapter calls:
 * `accounts.getAll`, `activities.{getAll,checkImport,import,saveMany,
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
  ImportActivitiesResult,
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
  /** When set, the supported import endpoint rejects before returning a result. */
  importError?: Error;
  /** Simulate import-time validation failures for the first N reviewed rows. */
  importValidationErrorCount?: number;
  /** When set, the host's import endpoint throws
   * `new Error('payload too large: batch exceeds host limit')` if called with
   * more than this many activities in a single call. Simulates a host-side
   * payload-size cap on `activities.import`. */
  importBatchSizeLimit?: number;
  /** When set, `checkImport` throws this error instead of resolving. */
  checkImportError?: Error;
  /** Optional host-like normalization applied by the read-only import check. */
  checkImportTransform?: (activities: ActivityImport[]) => ActivityImport[];
  /** When set, `saveMany` returns this many `errors` entries (simulating a
   * partial failure for the first N creates). */
  saveManyErrorCount?: number;
  /** Securities that already exist in Wealthfolio, keyed `SYMBOL@MIC`. */
  assets?: FakeAsset[];
}

/** A security known to the fake host. */
export interface FakeAsset {
  id: string;
  symbol: string;
  exchangeMic?: string;
  name?: string;
}

/** Types the 3.6.1 host always stores without a security. */
const HOST_CASH_TYPES = new Set(['DEPOSIT', 'WITHDRAWAL', 'FEE', 'TAX', 'CREDIT']);

/** Host asset lookup key (`SYMBOL@MIC`, or `SYMBOL` without a MIC). */
function assetKey(symbol: string, exchangeMic?: string | null): string {
  const s = symbol.trim().toUpperCase();
  return exchangeMic ? `${s}@${exchangeMic}` : s;
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
  /** Reviewed imports sent through `activities.import`. */
  importCalls: ActivityImport[][];
  /** Read-only checkImport payloads, in call order. */
  checkImportCalls: ActivityImport[][];
  /** Activities currently stored (after `saveMany` applies creates). */
  storedActivities: ActivityDetails[];
  /** The last mapping passed to `saveImportMapping`. */
  savedMapping: ImportMappingData | undefined;
  /** Securities currently known to the host. */
  assets: FakeAsset[];
}

/** Build a minimal `ActivityDetails` from a created `Activity`. */
function toDetails(activity: Activity, asset?: FakeAsset): ActivityDetails {
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
    // Like the host, an activity without a linked asset has an empty symbol.
    assetSymbol: asset?.symbol ?? '',
    ...(asset?.name ? { assetName: asset.name } : {}),
    ...(asset?.exchangeMic ? { exchangeMic: asset.exchangeMic } : {}),
    createdAt: new Date(activity.createdAt),
    updatedAt: new Date(activity.updatedAt),
    assetId: asset?.id ?? '',
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
  const importCalls: ActivityImport[][] = [];
  const checkImportCalls: ActivityImport[][] = [];
  const importedKeys = new Set<string>();
  const assets: FakeAsset[] = [...(options.assets ?? [])];
  const findAsset = (symbol: string, exchangeMic?: string | null) =>
    assets.find((a) => assetKey(a.symbol, a.exchangeMic) === assetKey(symbol, exchangeMic));
  const findAssetById = (id: string | undefined) =>
    id ? assets.find((a) => a.id === id) : undefined;
  let assetCounter = 1;
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
          errors.push({ id: c.id, action: 'create', message: 'simulated failure' });
          continue;
        }
        // Like `prepare_activities_for_save`, the bulk path creates a missing
        // security from the asset resolution input.
        let asset = findAssetById(c.asset?.id);
        if (!asset && c.asset?.symbol) {
          asset = findAsset(c.asset.symbol, c.asset.exchangeMic);
          if (!asset) {
            asset = {
              id: `asset-uuid-${assetCounter++}`,
              symbol: c.asset.symbol,
              ...(c.asset.exchangeMic ? { exchangeMic: c.asset.exchangeMic } : {}),
              ...(c.asset.name ? { name: c.asset.name } : {}),
            };
            assets.push(asset);
          }
        }
        importedKeys.add(
          hostKey({
            accountId: c.accountId,
            activityType: c.activityType,
            date: c.activityDate,
            assetRef: asset?.id,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            amount: c.amount,
            currency: c.currency,
            comment: c.comment,
          }),
        );
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
        storedActivities.push(toDetails(activity, asset));
      }
      return { created, updated: [], deleted: [], createdMappings: [], errors };
    },
    import: async (imports: ActivityImport[]): Promise<ImportActivitiesResult> => {
      importCalls.push(imports);
      if (options.importError) throw options.importError;
      if (
        options.importBatchSizeLimit !== undefined &&
        imports.length > options.importBatchSizeLimit
      ) {
        throw new Error('payload too large: batch exceeds host limit');
      }
      if ((options.importValidationErrorCount ?? 0) > 0) {
        const activities = imports.map((activity, index) =>
          index < (options.importValidationErrorCount ?? 0)
            ? {
                ...activity,
                isValid: false,
                errors: { general: ['simulated import validation failure'] },
              }
            : activity,
        );
        return {
          activities,
          importRunId: '',
          summary: {
            total: imports.length,
            imported: 0,
            skipped: 0,
            duplicates: 0,
            assetsCreated: 0,
            success: false,
          },
        };
      }
      const activities = imports.map((activity) => {
        // Mirrors `build_import_idempotency_key`: the asset reference is the
        // existing asset id when checkImport found one, else `SYMBOL@MIC`.
        const symbol = activity.symbol?.trim() ?? '';
        const assetRef =
          activity.assetId ??
          (symbol ? (activity.exchangeMic ? `${symbol}@${activity.exchangeMic}` : symbol) : '');
        const key = hostKey({
          accountId: activity.accountId,
          activityType: activity.activityType,
          date: activity.date,
          assetRef,
          quantity: activity.quantity,
          unitPrice: activity.unitPrice,
          amount: activity.amount,
          currency: activity.currency,
          comment: activity.comment,
        });
        if (importedKeys.has(key)) {
          return {
            ...activity,
            warnings: { ...(activity.warnings ?? {}), _duplicate: ['simulated duplicate'] },
            duplicateOfId: 'existing-activity',
          };
        }
        importedKeys.add(key);
        const id = `act-${idCounter++}`;
        const now = new Date().toISOString();
        const created: Activity = {
          id,
          accountId: activity.accountId,
          activityType: activity.activityType,
          status: activity.isDraft ? 'DRAFT' : 'POSTED',
          activityDate:
            typeof activity.date === 'string'
              ? activity.date
              : (activity.date?.toISOString() ?? now),
          quantity: activity.quantity?.toString() ?? null,
          unitPrice: activity.unitPrice?.toString() ?? null,
          amount: activity.amount?.toString() ?? null,
          fee: activity.fee?.toString() ?? null,
          currency: activity.currency ?? 'EUR',
          isUserModified: false,
          needsReview: activity.isDraft,
          createdAt: now,
          updatedAt: now,
        };
        // The 3.6.1 import endpoint never creates assets: a row without an
        // `assetId` is stored with no security linked.
        storedActivities.push(toDetails(created, findAssetById(activity.assetId)));
        return activity;
      });
      const duplicates = activities.filter((activity) => activity.duplicateOfId).length;
      return {
        activities,
        importRunId: 'run-1',
        summary: {
          total: imports.length,
          imported: imports.length - duplicates,
          skipped: duplicates,
          duplicates,
          assetsCreated: 0,
          success: true,
        },
      };
    },
    checkImport: async (activities: ActivityImport[]): Promise<ActivityImport[]> => {
      checkImportCalls.push(activities);
      if (options.checkImportError) throw options.checkImportError;
      // Mark all as valid (the adapter re-checks isValid) and, like the host,
      // attach the id of a security that already exists.
      const checked = activities.map((a) => {
        // Like the host, never-asset types are cash movements: symbol cleared.
        if (HOST_CASH_TYPES.has(a.activityType)) {
          return { ...a, symbol: '', isValid: a.isValid ?? true };
        }
        const existing = a.symbol ? findAsset(a.symbol, a.exchangeMic) : undefined;
        return {
          ...a,
          isValid: a.isValid ?? true,
          ...(existing ? { assetId: existing.id, symbolName: existing.name } : {}),
        };
      });
      return options.checkImportTransform?.(checked) ?? checked;
    },
    getImportMapping: async (
      _accountId: string,
      _contextKind?: string,
    ): Promise<ImportMappingData> => {
      return (
        savedMapping ??
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

  return {
    api,
    saveManyCalls,
    importCalls,
    checkImportCalls,
    storedActivities,
    assets,
    get savedMapping() {
      return savedMapping;
    },
  };
}

/** Host-like duplicate key: day-level date, asset reference, economics, comment. */
function hostKey(k: {
  accountId?: string;
  activityType?: string;
  date?: string | Date;
  assetRef?: string;
  quantity?: unknown;
  unitPrice?: unknown;
  amount?: unknown;
  currency?: string;
  comment?: string | null;
}): string {
  const d = k.date instanceof Date ? k.date : new Date(k.date ?? '');
  const day = Number.isNaN(d.getTime()) ? String(k.date) : d.toISOString().slice(0, 10);
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? '' : String(Number(v)));
  return [
    k.accountId,
    k.activityType,
    day,
    k.assetRef ?? '',
    num(k.quantity),
    num(k.unitPrice),
    num(k.amount),
    k.currency,
    (k.comment ?? '').trim(),
  ].join('|');
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
