/**
 * Wealthfolio adapter types for the DEGIRO importer.
 *
 * This module imports `@wealthfolio/addon-sdk` *types* only (no runtime
 * import) for signatures that cross the adapter boundary. The single runtime
 * conversion boundary is `convert-activity.ts`.
 */
import type { ActivityImport, AssetResolutionInput } from '@wealthfolio/addon-sdk';

/** Add-on id as declared in `manifest.json`. Used to isolate this add-on's
 * metadata entries from other importers' entries on the same account. */
export const IMPORTER_ID = 'degiro-importer';

/** Add-on version, recorded in metadata for forward-compatibility. */
export const IMPORTER_VERSION = '1.1.0';

/** Source schema version fingerprinted into every activity. */
export const SOURCE_SCHEMA_VERSION = '1';

/** Source type tag recorded in metadata. */
export const SOURCE_TYPE = 'degiro-account-statement-csv';

/**
 * Metadata schema v1 — non-sensitive provenance only.
 *
 * NEVER store full raw records, balances, filenames, paths, or account
 * statement paths here. Only the fields needed to (a) detect duplicates,
 * (b) reconstruct an instrument mapping, and (c) attribute the activity to
 * this importer.
 */
export interface ActivityMetadataV1 {
  /** Schema version of this metadata object. */
  metadataVersion: 1;
  /** This add-on's manifest id. Used to filter `getAll()` results. */
  importerId: string;
  /** This add-on's version at import time. */
  importerVersion: string;
  /** Pure-core source fingerprint schema version. */
  sourceSchemaVersion: string;
  /** Source statement type tag. */
  sourceType: string;
  /** Idempotency fingerprint (SHA-256 hex) from `fingerprintActivity`. */
  sourceFingerprint: string;
  /** Contributing source row numbers (1-based, sorted ascending). */
  sourceRowNumbers: number[];
  /** Order-id group marker for grouped trades, when applicable. */
  sourceGroupId?: string;
  /** Source ticker or ISIN used to reconstruct a mapping. */
  sourceTickerOrIsin?: string;
  /** Resolved canonical symbol, when known. */
  resolvedSymbol?: string;
  /** Resolved exchange MIC, when known. */
  resolvedMic?: string;
  /** Resolved market-data provider id, when known. */
  resolvedProviderId?: string;
}

/**
 * A draft plus its computed fingerprint and resolved asset, ready for the
 * adapter flow. The pure core produces drafts; the adapter enriches them
 * with fingerprints and resolution before conversion.
 */
export interface PreparedDraft {
  /** Original pure-core draft. */
  draft: import('../domain/activity-draft').ActivityDraft;
  /** Idempotency fingerprint hex. */
  fingerprint: string;
  /** Resolved asset resolution input, when a confirmed mapping exists. */
  asset?: AssetResolutionInput;
  /** Source ticker or ISIN used to reconstruct a mapping. */
  sourceTickerOrIsin?: string;
}

/** A safe, row-level validation or persistence failure. */
export interface ImportFailure {
  /** All source rows that contributed to the rejected activity draft. */
  sourceRowNumbers?: readonly number[];
  /** Sanitized user-facing message; never the raw host error. */
  message: string;
}

/** Result of converting a draft to an `ActivityImport` row. */
export interface ConvertedImport {
  /** The `ActivityImport` row to pass to `checkImport`. */
  activityImport: ActivityImport;
  /** The fingerprint this row maps to (for dedupe bookkeeping). */
  fingerprint: string;
  /** Whether this row was marked as a duplicate of an existing activity. */
  duplicate: boolean;
}

/** Result of the import flow. */
export interface ImportFlowResult {
  /** Number of rows sent to `saveMany` as creates. */
  attempted: number;
  /** Number of rows reported created by `saveMany` (authoritative). */
  created: number;
  /** Fingerprints that were marked imported (only those in `created`). */
  importedFingerprints: string[];
  /** Fingerprints whose write failed (in `errors` or thrown). */
  failedFingerprints: string[];
  /** Rows skipped as exact duplicates of already-imported activities. */
  skippedDuplicates: number;
  /** Rows blocked from import (host validation errors or unresolved symbols). */
  blocked: number;
  /** Sanitized validation/persistence errors correlated to source rows. */
  failures: ImportFailure[];
  /** Fatal host error, when `checkImport` or `saveMany` threw. */
  fatal?: string;
}
