import type { ActivityImport as _ActivityImport } from '@wealthfolio/addon-sdk';

// `isin` exists in the Rust struct and is accepted on the wire, but the TS SDK
// types don't declare it yet — extend locally until the SDK catches up.
export type ActivityImport = _ActivityImport & { isin?: string };

export type {
  ActivityCreate,
  ActivityType,
  Account,
  ImportActivitiesResult,
  ImportActivitiesSummary,
  SymbolSearchResult,
} from '@wealthfolio/addon-sdk';
export type { HostAPI } from '@wealthfolio/addon-sdk';
export type { AddonContext } from '@wealthfolio/addon-sdk';
