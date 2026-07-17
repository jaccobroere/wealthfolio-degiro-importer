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
import { IMPORTER_ID, IMPORTER_VERSION, SOURCE_SCHEMA_VERSION, SOURCE_TYPE } from './types';

// Re-export the constants so callers don't need a second import.
export { IMPORTER_ID, IMPORTER_VERSION, SOURCE_SCHEMA_VERSION, SOURCE_TYPE };

/**
 * Map a pure-core `ActivityType` (DEGIRO subset) to the SDK `ActivityType`.
 *
 * The DEGIRO pure core emits BUY, SELL, DIVIDEND, TAX, DEPOSIT, WITHDRAWAL,
 * INTEREST, FEE, CREDIT — all valid SDK activity types — so this is a 1:1 cast.
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
  const sourceTickerOrIsin =
    draft.isin ?? (isInstrumentSymbol(draft.symbol) ? draft.symbol : undefined);
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
export function toActivityImport(prepared: PreparedDraft, accountId: string): ActivityImport {
  const { draft, asset } = prepared;
  return {
    accountId,
    activityType: toSdkActivityType(draft.activityType),
    date: draft.date,
    // The v3.6.1 server's ActivityImport wire model requires a string even
    // for cash-only activities. An empty symbol is its documented cash form;
    // omitting it produces a 422 before the read-only checkImport gate runs.
    // Supply the reviewed canonical symbol to checkImport. The source symbol
    // may be a broker label or ISIN and is retained only in provenance.
    symbol: isInstrumentSymbol(draft.symbol) ? (asset?.symbol ?? draft.symbol) : '',
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
 * Convert an accepted `checkImport` row to an `ActivityCreate` for
 * `saveMany({ creates })`.
 *
 * `checkImport` resolves the quote currency, instrument type, quote mode,
 * and existing asset id needed by Wealthfolio 3.6.1's persistence-only
 * `saveMany` path. The checked row must therefore be retained instead of
 * rebuilding activity data from the original CSV draft.
 */
export function toActivityCreate(
  prepared: PreparedDraft,
  checked: ActivityImport,
  accountId: string,
  temporaryId: string,
): ActivityCreate {
  const { draft, fingerprint, asset } = prepared;
  const symbol = checked.symbol?.trim() ?? '';
  const resolvedAsset: AssetResolutionInput | undefined = symbol
    ? {
        id: checked.assetId,
        symbol,
        exchangeMic: checked.exchangeMic,
        name: checked.symbolName,
        quoteMode:
          checked.quoteMode === 'MANUAL' || checked.quoteMode === 'MARKET'
            ? checked.quoteMode
            : undefined,
        quoteCcy: checked.quoteCcy,
        instrumentType: checked.instrumentType,
        providerId: checked.providerId,
        providerSymbol: checked.providerSymbol,
      }
    : undefined;
  const meta = buildMetadata(draft, fingerprint, resolvedAsset ?? asset);
  return {
    // Correlates a host row-level error with this draft; never persists as the
    // activity id because Wealthfolio maps it to a server-generated id.
    id: temporaryId,
    accountId,
    activityType: checked.activityType,
    activityDate: checked.date ?? draft.date,
    sourceGroupId: draft.group?.orderId,
    asset: resolvedAsset,
    quantity: checked.quantity ?? undefined,
    unitPrice: checked.unitPrice ?? undefined,
    amount: checked.amount ?? undefined,
    currency: checked.currency ?? draft.currency,
    fee: checked.fee ?? undefined,
    tax: checked.tax ?? undefined,
    comment: checked.comment ?? undefined,
    fxRate: checked.fxRate ?? draft.group?.fxRate ?? undefined,
    // The SDK permits an object for convenience, but the 3.6.1 host bulk
    // endpoint's wire DTO requires metadata to be a JSON string.
    metadata: JSON.stringify(meta),
  } satisfies ActivityCreate;
}
