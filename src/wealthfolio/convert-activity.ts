/**
 * Conversion boundary: pure-core `ActivityDraft` → Wealthfolio 3.6.1
 * `ActivityImport` and `ActivityCreate`.
 *
 * This is the ONLY module in the adapter layer that imports the
 * `@wealthfolio/addon-sdk` activity *types* at runtime. Decimal strings are
 * preserved through this boundary (3.6.1 accepts strings for quantity,
 * unitPrice, amount, fee, tax, and fxRate).
 */
import type {
  ActivityCreate,
  ActivityImport,
  ActivityType,
  AssetResolutionInput,
} from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import { isInstrumentSymbol } from '../domain/activity-draft';
import type { ActivityMetadataV1, PreparedDraft } from './types';
import {
  IMPORTER_ID,
  IMPORTER_VERSION,
  SOURCE_SCHEMA_VERSION,
  SOURCE_TYPE,
} from './types';

// Re-export the constants so callers don't need a second import.
export { IMPORTER_ID, IMPORTER_VERSION, SOURCE_SCHEMA_VERSION, SOURCE_TYPE };

/**
 * Map a pure-core `ActivityType` (DEGIRO subset) to the SDK `ActivityType`.
 *
 * The DEGIRO pure core emits BUY, SELL, DIVIDEND, TAX, DEPOSIT, WITHDRAWAL,
 * INTEREST, FEE — all valid SDK activity types — so this is a 1:1 cast.
 */
export function toSdkActivityType(type: ActivityDraft['activityType']): ActivityType {
  return type as ActivityType;
}

/**
 * Build the non-sensitive metadata object for one activity.
 *
 * Only provenance fields are included; never raw rows, balances, filenames,
 * or paths.
 */
export function buildMetadata(
  draft: ActivityDraft,
  fingerprint: string,
  resolved?: AssetResolutionInput,
): ActivityMetadataV1 {
  const sourceTickerOrIsin = draft.isin ?? (isInstrumentSymbol(draft.symbol) ? draft.symbol : undefined);
  return {
    metadataVersion: 1,
    importerId: IMPORTER_ID,
    importerVersion: IMPORTER_VERSION,
    sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
    sourceType: SOURCE_TYPE,
    sourceFingerprint: fingerprint,
    sourceRowNumbers: [...draft.sourceRowNumbers].sort((a, b) => a - b),
    sourceGroupId: draft.group?.orderId,
    sourceTickerOrIsin,
    resolvedSymbol: resolved?.symbol,
    resolvedMic: resolved?.exchangeMic,
    resolvedProviderId: resolved?.providerId,
  };
}

/**
 * Convert a prepared draft to an `ActivityImport` row for the read-only
 * `checkImport` gate.
 *
 * `isValid` and `isDraft` are required on every `ActivityImport`. We set
 * `isDraft: true` so the host keeps the row in review until the user confirms
 * the import. Decimal strings are passed through unchanged.
 */
export function toActivityImport(
  prepared: PreparedDraft,
  accountId: string,
): ActivityImport {
  const { draft, asset } = prepared;
  return {
    accountId,
    activityType: toSdkActivityType(draft.activityType),
    date: draft.date,
    symbol: isInstrumentSymbol(draft.symbol) ? draft.symbol : undefined,
    quantity: draft.quantity || undefined,
    unitPrice: draft.unitPrice || undefined,
    amount: draft.amount || undefined,
    fee: draft.fee || undefined,
    currency: draft.currency,
    comment: draft.comment,
    // Asset resolution hints, when a confirmed mapping exists.
    exchangeMic: asset?.exchangeMic,
    quoteCcy: asset?.quoteCcy,
    instrumentType: asset?.instrumentType,
    quoteMode: asset?.quoteMode,
    providerId: asset?.providerId,
    providerSymbol: asset?.providerSymbol,
    isValid: draft.isValid,
    isDraft: true,
    // Metadata is attached on the ActivityCreate after the gate passes;
    // ActivityImport has no metadata field.
  } satisfies ActivityImport;
}

/**
 * Convert an accepted (checkImport-passed) `ActivityImport` row to an
 * `ActivityCreate` for `saveMany({ creates })`.
 *
 * Decimal strings are preserved. `asset` is set explicitly when a confirmed
 * mapping exists; cash activities omit `asset`. Metadata carries the
 * non-sensitive provenance fingerprint used for duplicate detection.
 */
export function toActivityCreate(
  prepared: PreparedDraft,
  accountId: string,
): ActivityCreate {
  const { draft, fingerprint, asset } = prepared;
  const isInstrument = isInstrumentSymbol(draft.symbol);
  const meta = buildMetadata(draft, fingerprint, asset);
  return {
    accountId,
    activityType: toSdkActivityType(draft.activityType),
    activityDate: draft.date,
    sourceGroupId: draft.group?.orderId,
    asset: isInstrument
      ? asset ?? { symbol: draft.symbol }
      : undefined,
    quantity: draft.quantity || undefined,
    unitPrice: draft.unitPrice || undefined,
    amount: draft.amount || undefined,
    currency: draft.currency,
    fee: draft.fee || undefined,
    comment: draft.comment,
    fxRate: draft.group?.fxRate || undefined,
    metadata: meta as unknown as Record<string, unknown>,
  } satisfies ActivityCreate;
}