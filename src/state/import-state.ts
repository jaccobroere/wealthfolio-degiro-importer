/**
 * Import wizard state machine (T07).
 *
 * Pure state + reducer module: no React, no `@wealthfolio/addon-sdk` runtime
 * imports. The UI layer (`src/pages/importer-page.tsx`) wires this into a
 * `useReducer` and drives the four-step wizard:
 *
 *   upload → mapping → review → reconcile → importing → done
 *
 * The reducer never calls host APIs (those are side-effects performed in the
 * page's effects/handlers). It only transitions state and records the
 * pipeline/account/mapping/reconciliation/review data that the steps render.
 *
 * Privacy: this module holds normalized drafts and outcomes only — never raw
 * rows, balances, or order ids beyond what the pure core already exposes as
 * provenance (source row numbers, reason codes, normalized decimal strings).
 */

import type { BatchOutcome } from '../domain/import-outcome';
import type { PipelineResultWithFingerprints } from '../parser/parse-and-map';

/** The six wizard phases. `importing` and `done` are terminal-ish (done resets). */
export type WizardStep = 'upload' | 'mapping' | 'review' | 'reconcile' | 'importing' | 'done';

/** Ordered step list for the stepper UI (excludes the transient `importing`). */
export const STEP_ORDER: readonly WizardStep[] = [
  'upload',
  'mapping',
  'review',
  'reconcile',
  'done',
] as const;

/** A resolved (confirmed) instrument mapping for one source ticker/ISIN. */
export interface ResolvedMapping {
  /** Source ticker or ISIN from the draft. */
  sourceTickerOrIsin: string;
  /** Confirmed canonical symbol. */
  symbol: string;
  /** Confirmed exchange MIC (optional). */
  exchangeMic?: string;
  /** Confirmed market-data provider id (optional). */
  providerId?: string;
  /** Whether this mapping was reused from saved mappings (vs. newly confirmed). */
  fromSaved: boolean;
}

/** Per-source-symbol resolution status surfaced to the mapping step. */
export type SymbolResolution =
  | { status: 'pending' }
  | { status: 'resolved'; mapping: ResolvedMapping }
  | { status: 'no-results' }
  | { status: 'ambiguous'; candidateCount: number }
  | { status: 'blocked'; reason: string };

/** Upload-step summary (privacy-safe: counts + date range only). */
export interface UploadSummary {
  /** Number of parsed data rows. */
  rowCount: number;
  /** Earliest activity date (ISO) across the batch, or null if empty. */
  minDate: string | null;
  /** Latest activity date (ISO) across the batch, or null if empty. */
  maxDate: string | null;
  /** Detected header variant. */
  headerVariant: 'dutch' | 'english';
}

/** Review filter toggles. */
export interface ReviewFilters {
  errors: boolean;
  warnings: boolean;
  duplicates: boolean;
  skips: boolean;
  cash: boolean;
  trades: boolean;
  dividends: boolean;
  feesTaxesCredits: boolean;
}

/** Default filters: everything visible. */
export const DEFAULT_FILTERS: ReviewFilters = {
  errors: true,
  warnings: true,
  duplicates: true,
  skips: true,
  cash: true,
  trades: true,
  dividends: true,
  feesTaxesCredits: true,
};

/** Result of the import flow (mirrors the adapter `ImportFlowResult`). */
export interface ImportResultSummary {
  attempted: number;
  created: number;
  skippedDuplicates: number;
  blocked: number;
  failed: number;
  fatal?: string;
}

/** The full wizard state. */
export interface ImportState {
  step: WizardStep;
  /** Upload error message (schema validation failure), or null. */
  uploadError: string | null;
  /** Upload summary once parsed, or null before upload. */
  uploadSummary: UploadSummary | null;
  /** The full pipeline result (batch + reconciliation + fingerprints). */
  pipeline: PipelineResultWithFingerprints | null;
  /** Available accounts from `ctx.api.accounts.getAll()`. */
  accounts: { id: string; name: string; currency: string }[];
  /** Selected destination account id, or null. */
  accountId: string | null;
  /** Per-source-symbol resolution status. */
  symbolResolutions: Record<string, SymbolResolution>;
  /** Set of source symbols that are instruments (need resolution). */
  instrumentSymbols: string[];
  /** Fingerprints already imported on the selected account (duplicate index). */
  importedFingerprints: Set<string>;
  /** Review filter toggles. */
  filters: ReviewFilters;
  /** User acknowledgement checkbox on the reconcile step. */
  acknowledged: boolean;
  /** Whether the import is currently running (transient `importing` step). */
  importing: boolean;
  /** Import result summary once `done`, or null. */
  importResult: ImportResultSummary | null;
  /** Fatal error during import, or null. */
  importError: string | null;
}

/** Initial state. */
export function initialImportState(): ImportState {
  return {
    step: 'upload',
    uploadError: null,
    uploadSummary: null,
    pipeline: null,
    accounts: [],
    accountId: null,
    symbolResolutions: {},
    instrumentSymbols: [],
    importedFingerprints: new Set(),
    filters: { ...DEFAULT_FILTERS },
    acknowledged: false,
    importing: false,
    importResult: null,
    importError: null,
  };
}

/** Actions dispatched to the reducer. */
export type ImportAction =
  | { type: 'UPLOAD_SUCCESS'; pipeline: PipelineResultWithFingerprints; summary: UploadSummary }
  | { type: 'UPLOAD_ERROR'; message: string }
  | { type: 'RESET_UPLOAD' }
  | { type: 'ACCOUNTS_LOADED'; accounts: { id: string; name: string; currency: string }[] }
  | { type: 'SELECT_ACCOUNT'; accountId: string }
  | { type: 'DUPLICATE_INDEX_LOADED'; fingerprints: Set<string> }
  | { type: 'SYMBOL_RESOLUTIONS'; resolutions: Record<string, SymbolResolution> }
  | { type: 'RESOLVE_SYMBOL'; sourceTickerOrIsin: string; resolution: SymbolResolution }
  | { type: 'GOTO_STEP'; step: WizardStep }
  | { type: 'SET_FILTERS'; filters: Partial<ReviewFilters> }
  | { type: 'SET_ACKNOWLEDGED'; acknowledged: boolean }
  | { type: 'IMPORT_START' }
  | { type: 'IMPORT_SUCCESS'; result: ImportResultSummary }
  | { type: 'IMPORT_ERROR'; message: string }
  | { type: 'RESET' };

/**
 * Compute the upload summary from a pipeline result (privacy-safe).
 *
 * Returns row count + date range + header variant only. Never includes raw
 * rows, balances, products, or order ids.
 */
export function computeUploadSummary(pipeline: PipelineResultWithFingerprints): UploadSummary {
  const { batch, parsed } = pipeline;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const a of batch.activities) {
    if (minDate === null || a.date < minDate) minDate = a.date;
    if (maxDate === null || a.date > maxDate) maxDate = a.date;
  }
  return {
    rowCount: batch.summary.sourceRowCount,
    minDate,
    maxDate,
    headerVariant: parsed.headerVariant,
  };
}

/**
 * Extract the set of instrument source symbols (ISIN or ticker) that require
 * resolution from the batch activities. Cash pseudo-symbols are excluded.
 */
export function extractInstrumentSymbols(batch: BatchOutcome): string[] {
  const set = new Set<string>();
  for (const a of batch.activities) {
    const key = a.isin ?? (a.symbol.startsWith('$CASH-') ? undefined : a.symbol);
    if (key) set.add(key);
  }
  return Array.from(set).sort();
}

/**
 * Categorize a single activity draft into a review category.
 *
 * Categories (per PLAN T07):
 * - `new-valid`       — valid activity, not a duplicate.
 * - `duplicate`        — fingerprint matches an already-imported activity.
 * - `known-skip`       — (outcomes only) allow-listed broker bookkeeping.
 * - `warning`          — valid activity but carries warnings.
 * - `requires-review`  — unsupported / needs manual review (blocks import).
 * - `fatal-invalid`    — structurally invalid (blocks import).
 */
export type ReviewCategory =
  'new-valid' | 'duplicate' | 'known-skip' | 'warning' | 'requires-review' | 'fatal-invalid';

/**
 * A review row: one per source-row outcome (standalone) or per activity (group
 * members are folded into their parent activity's row). Every source row has
 * exactly one terminal outcome.
 */
export interface ReviewRow {
  /** Source row number(s) this review row represents. */
  sourceRowNumbers: number[];
  /** Outcome kind from the pure core. */
  outcomeKind: 'activity' | 'group-member' | 'known-skip' | 'unsupported' | 'invalid';
  /** Review category. */
  category: ReviewCategory;
  /** Normalized activity type (BUY/SELL/...), or null for skips/invalid. */
  activityType: string | null;
  /** Normalized symbol (instrument or `$CASH-<CCY>`), or null. */
  symbol: string | null;
  /** Normalized ISIN, if present. */
  isin?: string;
  /** Normalized currency. */
  currency: string | null;
  /** Normalized quantity (decimal string), or null. */
  quantity: string | null;
  /** Normalized amount (decimal string), or null. */
  amount: string | null;
  /** Normalized fee (decimal string), or null. */
  fee: string | null;
  /** Activity date (ISO), or null. */
  date: string | null;
  /** Skip reason code, when category is known-skip. */
  skipReason?: string;
  /** Invalid/unsupported reason, when applicable. */
  reason?: string;
  /** Whether this row's instrument symbol is unresolved (blocks import). */
  unresolvedSymbol?: boolean;
  /** Whether this activity carries accrued interest (T09-gate flag). */
  hasAccruedInterest?: boolean;
  /** Whether this activity has warnings. */
  hasWarnings?: boolean;
}

/**
 * Build review rows from the pipeline + duplicate index + symbol resolutions.
 *
 * Every source row has exactly one terminal outcome. Group-member rows are
 * represented by their parent activity's review row (the `sourceRowNumbers`
 * array lists all contributing rows). Standalone activities get their own row.
 * Known-skip, unsupported, and invalid outcomes each get their own row.
 */
export function buildReviewRows(state: ImportState): ReviewRow[] {
  const { pipeline, importedFingerprints, symbolResolutions } = state;
  if (!pipeline) return [];
  const { batch, fingerprints } = pipeline;

  const rows: ReviewRow[] = [];
  // Map activityIndex → review row index (for group-member folding).
  const activityRowIdx = new Map<number, number>();

  // First pass: activities (standalone + grouped).
  for (let i = 0; i < batch.activities.length; i++) {
    const a = batch.activities[i];
    const fp = fingerprints.get(i);
    const isDuplicate = fp ? importedFingerprints.has(fp) : false;
    const sourceKey = a.isin ?? (a.symbol.startsWith('$CASH-') ? undefined : a.symbol);
    const resolution = sourceKey ? symbolResolutions[sourceKey] : undefined;
    const unresolved = !!sourceKey && resolution?.status !== 'resolved';
    const hasWarnings = Object.keys(a.warnings).length > 0;
    const hasAccrued = !!a.accruedInterest;

    let category: ReviewCategory;
    if (!a.isValid) {
      category = 'fatal-invalid';
    } else if (isDuplicate) {
      category = 'duplicate';
    } else if (hasWarnings) {
      category = 'warning';
    } else {
      category = 'new-valid';
    }

    const row: ReviewRow = {
      sourceRowNumbers: [...a.sourceRowNumbers].sort((x, y) => x - y),
      outcomeKind: a.group ? 'group-member' : 'activity',
      category,
      activityType: a.activityType,
      symbol: a.symbol,
      ...(a.isin ? { isin: a.isin } : {}),
      currency: a.currency,
      quantity: a.quantity || null,
      amount: a.amount || null,
      fee: a.fee || null,
      date: a.date,
      unresolvedSymbol: unresolved || undefined,
      hasAccruedInterest: hasAccrued || undefined,
      hasWarnings: hasWarnings || undefined,
    };
    activityRowIdx.set(i, rows.length);
    rows.push(row);
  }

  // Second pass: outcomes that are NOT activity/group-member (skips, unsupported, invalid).
  for (const o of batch.outcomes) {
    if (o.kind === 'activity' || o.kind === 'group-member') continue;
    if (o.kind === 'known-skip') {
      rows.push({
        sourceRowNumbers: [o.rowIndex],
        outcomeKind: 'known-skip',
        category: 'known-skip',
        activityType: null,
        symbol: null,
        currency: null,
        quantity: null,
        amount: null,
        fee: null,
        date: null,
        skipReason: o.reason,
      });
    } else if (o.kind === 'unsupported') {
      rows.push({
        sourceRowNumbers: [o.rowIndex],
        outcomeKind: 'unsupported',
        category: 'requires-review',
        activityType: null,
        symbol: null,
        currency: null,
        quantity: null,
        amount: null,
        fee: null,
        date: null,
        reason: o.reason,
      });
    } else {
      // invalid
      rows.push({
        sourceRowNumbers: [o.rowIndex],
        outcomeKind: 'invalid',
        category: 'fatal-invalid',
        activityType: null,
        symbol: null,
        currency: null,
        quantity: null,
        amount: null,
        fee: null,
        date: null,
        reason: o.reason,
      });
    }
  }

  // Sort by first source row number for stable display.
  rows.sort((a, b) => a.sourceRowNumbers[0] - b.sourceRowNumbers[0]);
  return rows;
}

/**
 * Conservation summary: verifies every source row has exactly one terminal
 * outcome and every activity draft references ≥1 source rows.
 *
 *   total input rows = standalone outcomes + group-member rows
 *   every row has one terminal source-row outcome
 *   every activity draft references ≥1 source rows
 */
export interface ConservationSummary {
  totalInputRows: number;
  standaloneOutcomes: number;
  groupMemberRows: number;
  skipRows: number;
  unsupportedRows: number;
  invalidRows: number;
  /** totalInputRows - (standalone + group + skip + unsupported + invalid); must be 0. */
  residual: number;
  /** Number of activities with empty sourceRowNumbers; must be 0. */
  activitiesWithoutSourceRows: number;
}

export function computeConservation(state: ImportState): ConservationSummary {
  const { pipeline } = state;
  if (!pipeline) {
    return {
      totalInputRows: 0,
      standaloneOutcomes: 0,
      groupMemberRows: 0,
      skipRows: 0,
      unsupportedRows: 0,
      invalidRows: 0,
      residual: 0,
      activitiesWithoutSourceRows: 0,
    };
  }
  const { batch } = pipeline;
  const s = batch.summary;
  const standalone = s.byOutcome.activity;
  const group = s.byOutcome['group-member'];
  const skip = s.byOutcome['known-skip'];
  const unsupported = s.byOutcome.unsupported;
  const invalid = s.byOutcome.invalid;
  const accounted = standalone + group + skip + unsupported + invalid;
  let activitiesWithoutSourceRows = 0;
  for (const a of batch.activities) {
    if (a.sourceRowNumbers.length === 0) activitiesWithoutSourceRows++;
  }
  return {
    totalInputRows: s.sourceRowCount,
    standaloneOutcomes: standalone,
    groupMemberRows: group,
    skipRows: skip,
    unsupportedRows: unsupported,
    invalidRows: invalid,
    residual: s.sourceRowCount - accounted,
    activitiesWithoutSourceRows,
  };
}

/**
 * Reconciliation residual rules: the import is blocked if the reconciliation
 * reports any unaccounted rows, any unsupported/invalid outcomes, or any BUY
 * drafts carrying accrued interest (T09-gate).
 */
export interface ReconciliationResiduals {
  unaccountedCount: number;
  unsupportedCount: number;
  invalidCount: number;
  buyDraftsWithAccruedInterest: number;
  /** True when all residual rules pass (no blockers from reconciliation). */
  pass: boolean;
  /** Human-readable list of failing rules. */
  failures: string[];
}

export function computeReconciliationResiduals(state: ImportState): ReconciliationResiduals {
  const { pipeline } = state;
  if (!pipeline) {
    return {
      unaccountedCount: 0,
      unsupportedCount: 0,
      invalidCount: 0,
      buyDraftsWithAccruedInterest: 0,
      pass: true,
      failures: [],
    };
  }
  const { batch, reconciliation } = pipeline;
  const failures: string[] = [];
  if (reconciliation.unaccountedCount > 0) {
    failures.push(`${reconciliation.unaccountedCount} unaccounted source row(s)`);
  }
  if (batch.summary.unsupportedCount > 0) {
    failures.push(`${batch.summary.unsupportedCount} unsupported row(s)`);
  }
  if (batch.summary.invalidCount > 0) {
    failures.push(`${batch.summary.invalidCount} invalid row(s)`);
  }
  if (reconciliation.buyDraftsWithAccruedInterestCount > 0) {
    failures.push(
      `${reconciliation.buyDraftsWithAccruedInterestCount} BUY draft(s) with accrued interest (T09-gate: blocked until host representation is proven)`,
    );
  }
  return {
    unaccountedCount: reconciliation.unaccountedCount,
    unsupportedCount: batch.summary.unsupportedCount,
    invalidCount: batch.summary.invalidCount,
    buyDraftsWithAccruedInterest: reconciliation.buyDraftsWithAccruedInterestCount,
    pass: failures.length === 0,
    failures,
  };
}

/**
 * The master gate: returns the set of blocking conditions and whether the
 * Import button should be enabled. Import is disabled until ALL of:
 * - account selected
 * - zero fatal/unknown rows (unsupported + invalid)
 * - all traded securities resolved
 * - reconciliation residual rules pass
 * - acknowledgement checked
 */
export interface ImportGate {
  enabled: boolean;
  blockers: string[];
}

export function computeImportGate(state: ImportState): ImportGate {
  const blockers: string[] = [];

  if (!state.accountId) {
    blockers.push('No destination account selected');
  }

  if (state.pipeline) {
    const { batch } = state.pipeline;
    if (batch.summary.unsupportedCount > 0) {
      blockers.push(`${batch.summary.unsupportedCount} unsupported row(s) require review`);
    }
    if (batch.summary.invalidCount > 0) {
      blockers.push(`${batch.summary.invalidCount} invalid row(s)`);
    }

    // Unresolved securities block.
    const instrumentSymbols = extractInstrumentSymbols(batch);
    const unresolved = instrumentSymbols.filter(
      (s) => state.symbolResolutions[s]?.status !== 'resolved',
    );
    if (unresolved.length > 0) {
      blockers.push(`${unresolved.length} unresolved security symbol(s)`);
    }

    // Reconciliation residuals.
    const residuals = computeReconciliationResiduals(state);
    if (!residuals.pass) {
      blockers.push(...residuals.failures);
    }
  } else {
    blockers.push('No file uploaded');
  }

  if (!state.acknowledged) {
    blockers.push('Reconciliation not acknowledged');
  }

  return { enabled: blockers.length === 0, blockers };
}

/** Reducer. */
export function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'UPLOAD_SUCCESS':
      return {
        ...state,
        step: 'mapping',
        uploadError: null,
        pipeline: action.pipeline,
        uploadSummary: action.summary,
        instrumentSymbols: extractInstrumentSymbols(action.pipeline.batch),
        symbolResolutions: {},
        acknowledged: false,
        importResult: null,
        importError: null,
      };
    case 'UPLOAD_ERROR':
      return {
        ...state,
        uploadError: action.message,
        pipeline: null,
        uploadSummary: null,
        step: 'upload',
      };
    case 'RESET_UPLOAD':
      return { ...initialImportState(), accounts: state.accounts };
    case 'ACCOUNTS_LOADED':
      return { ...state, accounts: action.accounts };
    case 'SELECT_ACCOUNT':
      return { ...state, accountId: action.accountId, acknowledged: false };
    case 'DUPLICATE_INDEX_LOADED':
      return { ...state, importedFingerprints: action.fingerprints };
    case 'SYMBOL_RESOLUTIONS':
      return { ...state, symbolResolutions: { ...action.resolutions } };
    case 'RESOLVE_SYMBOL':
      return {
        ...state,
        symbolResolutions: {
          ...state.symbolResolutions,
          [action.sourceTickerOrIsin]: action.resolution,
        },
        acknowledged: false,
      };
    case 'GOTO_STEP':
      return { ...state, step: action.step };
    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.filters } };
    case 'SET_ACKNOWLEDGED':
      return { ...state, acknowledged: action.acknowledged };
    case 'IMPORT_START':
      return { ...state, step: 'importing', importing: true, importError: null };
    case 'IMPORT_SUCCESS':
      return {
        ...state,
        step: 'done',
        importing: false,
        importResult: action.result,
        importError: null,
      };
    case 'IMPORT_ERROR':
      return { ...state, step: 'reconcile', importing: false, importError: action.message };
    case 'RESET':
      return { ...initialImportState(), accounts: state.accounts };
    default:
      return state;
  }
}
