/**
 * Thin typed wrappers over the Wealthfolio 3.6.1 `HostAPI`.
 *
 * This module imports `@wealthfolio/addon-sdk` *types* for signatures. It
 * never calls destructive APIs (`deleteIds`, `clearFirst`) and never touches
 * browser storage or the nonexistent `ctx.api.storage`.
 */
import type {
  Account,
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
  ActivityCreate,
  ActivityDetails,
  ActivityImport,
  HostAPI,
  ImportActivitiesResult,
  ImportMappingData,
  SymbolSearchResult,
} from '@wealthfolio/addon-sdk';

/** Read all accounts (permission: `accounts.getAll`). */
export function getAllAccounts(api: HostAPI): Promise<Account[]> {
  return api.accounts.getAll();
}

/** Read all activities for an account, including metadata (permission:
 * `activities.getAll`). Used for duplicate detection. */
export function getActivities(api: HostAPI, accountId: string): Promise<ActivityDetails[]> {
  return api.activities.getAll(accountId);
}

/** Read-only validation gate (permission: `activities.checkImport`). Call
 * before any write. Fatal host errors propagate as rejections. */
export function checkImport(api: HostAPI, activities: ActivityImport[]): Promise<ActivityImport[]> {
  return api.activities.checkImport(activities);
}

/**
 * Commit a reviewed import through Wealthfolio's import workflow.
 *
 * In 3.6.1 this is deliberately distinct from `saveMany`: it preserves the
 * host's import-specific duplicate detection, import-run bookkeeping, and
 * reviewed asset representation. Add-ons must submit the rows returned by
 * `checkImport`, with `isDraft` cleared once the user confirms the import.
 */
export function importCheckedActivities(
  api: HostAPI,
  activities: ActivityImport[],
): Promise<ImportActivitiesResult> {
  return api.activities.import(activities);
}

/**
 * Save activities (permission: `activities.saveMany`).
 *
 * ALWAYS called with `{ creates }`. Never pass a bare array — the 3.6.1
 * bridge treats a bare array as updates. `deleteIds` is never produced.
 */
export function saveCreates(
  api: HostAPI,
  creates: ActivityCreate[],
): Promise<ActivityBulkMutationResult> {
  const request: ActivityBulkMutationRequest = { creates };
  return api.activities.saveMany(request);
}

/** Read the persisted import mapping for an account (permission:
 * `activities.getImportMapping`). */
export function getImportMapping(
  api: HostAPI,
  accountId: string,
  contextKind?: string,
): Promise<ImportMappingData> {
  return api.activities.getImportMapping(accountId, contextKind);
}

/** Persist an import mapping (permission: `activities.saveImportMapping`). */
export function saveImportMapping(
  api: HostAPI,
  mapping: ImportMappingData,
): Promise<ImportMappingData> {
  return api.activities.saveImportMapping(mapping);
}

/** Search the market-data ticker registry (permission:
 * `market-data.searchTicker`). */
export function searchTicker(api: HostAPI, query: string): Promise<SymbolSearchResult[]> {
  return api.market.searchTicker(query);
}

// Re-export the SDK type used by callers so they don't need a second import.
export type { ActivityCreate };
