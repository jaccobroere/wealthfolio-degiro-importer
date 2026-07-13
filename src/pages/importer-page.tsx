/**
 * Importer page — four-step review/reconciliation wizard.
 *
 * State machine: upload → mapping → review → reconcile → importing → done
 *
 * Runs inside the sandbox iframe using the single add-on-owned React root
 * Uses React state/effects + direct `ctx.api` calls. No host query
 * client wrapper and no router-hook dependency (React Router is unavailable in
 * the sandbox).
 *
 * Privacy: the UI never displays raw rows, balances, or order IDs by default.
 * Review shows normalized values + source row number/type only. Money is
 * displayed via decimal strings (no floating point).
 *
 * Import is disabled until ALL of: account selected; zero fatal/unknown rows;
 * all traded securities resolved; reconciliation residual rules pass; user
 * acknowledgement checkbox checked. A final confirmation precedes the single
 * import call. Upload, mapping, review, and reconciliation never write.
 */
import { useEffect, useMemo, useReducer, useState, type ReactElement } from 'react';
import type { AddonContext, AddonRouteLocation } from '@wealthfolio/addon-sdk';

import { UploadStep } from '../components/upload-step';
import { MappingStep } from '../components/mapping-step';
import { ReviewStep } from '../components/review-step';
import { ReconciliationPanel } from '../components/reconciliation-panel';
import { ImportResult } from '../components/import-result';
import {
  initialImportState,
  importReducer,
  buildReviewRows,
  computeConservation,
  computeReconciliationResiduals,
  computeImportGate,
  type ImportState,
  type UploadSummary,
  type SymbolResolution,
  type ResolvedMapping,
} from '../state/import-state';
import type { PipelineResultWithFingerprints } from '../parser/parse-and-map';
import { getAllAccounts, getActivities, getImportMapping, searchTicker } from '../wealthfolio/api';
import { buildDuplicateIndex } from '../wealthfolio/duplicate-index';
import {
  readSavedMappings,
  resolveSymbol,
  identityToAsset,
  withSavedMapping,
  type CanonicalIdentity,
} from '../wealthfolio/symbol-mappings';
import { runImport } from '../wealthfolio/import';
import type { ImportFlowResult } from '../wealthfolio/types';
import { isInstrumentSymbol } from '../domain/activity-draft';
import { IMPORTER_ID } from '../wealthfolio/types';

export interface ImporterPageProps {
  /** The 3.6.1 addon context. */
  ctx: AddonContext | null;
  /** Route location supplied by the host on each render. */
  location: AddonRouteLocation;
}

export function ImporterPage({ ctx }: ImporterPageProps): ReactElement {
  const [state, dispatch] = useReducer(importReducer, undefined, initialImportState);
  const [searchingFor, setSearchingFor] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{
    symbol: string;
    results: CompactSearchResult[];
  } | null>(null);
  const [loadingMappings, setLoadingMappings] = useState(false);

  // Load accounts on mount.
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    getAllAccounts(ctx.api)
      .then((accounts) => {
        if (cancelled) return;
        dispatch({
          type: 'ACCOUNTS_LOADED',
          accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
        });
      })
      .catch(() => {
        // Non-fatal: user sees "no accounts".
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  // When an account is selected, load the duplicate index + saved mappings.
  useEffect(() => {
    if (!ctx || !state.accountId) return;
    const accountId = state.accountId;
    let cancelled = false;

    // Load duplicate index.
    getActivities(ctx.api, accountId)
      .then((activities) => {
        if (cancelled) return;
        const index = buildDuplicateIndex(activities);
        dispatch({ type: 'DUPLICATE_INDEX_LOADED', fingerprints: index.importedFingerprints });
      })
      .catch(() => {
        // Non-fatal: empty duplicate index.
      });

    // Load saved mappings and auto-apply verified ones.
    setLoadingMappings(true);
    getImportMapping(ctx.api, accountId, IMPORTER_ID)
      .then(async (mapping) => {
        if (cancelled) return;
        const saved = readSavedMappings(mapping);
        const resolutions: Record<string, SymbolResolution> = {};
        for (const sym of state.instrumentSymbols) {
          const savedIdentity = saved.get(sym);
          if (savedIdentity) {
            // Re-verify against a fresh search.
            try {
              const results = await searchTicker(ctx.api, sym);
              const outcome = resolveSymbol(sym, saved, results);
              if (outcome.status === 'resolved') {
                resolutions[sym] = {
                  status: 'resolved',
                  mapping: {
                    sourceTickerOrIsin: sym,
                    symbol: outcome.identity.symbol,
                    ...(outcome.identity.exchangeMic
                      ? { exchangeMic: outcome.identity.exchangeMic }
                      : {}),
                    ...(outcome.identity.providerId
                      ? { providerId: outcome.identity.providerId }
                      : {}),
                    fromSaved: outcome.fromSaved,
                  },
                };
              } else {
                resolutions[sym] = outcomeToResolution(outcome);
              }
            } catch {
              resolutions[sym] = { status: 'pending' };
            }
          } else {
            resolutions[sym] = { status: 'pending' };
          }
        }
        if (!cancelled) dispatch({ type: 'SYMBOL_RESOLUTIONS', resolutions });
      })
      .catch(() => {
        // Non-fatal: all symbols stay pending.
      })
      .finally(() => {
        if (!cancelled) setLoadingMappings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, state.accountId, state.instrumentSymbols]);

  // Derived data.
  const reviewRows = useMemo(() => buildReviewRows(state), [state]);
  const conservation = useMemo(() => computeConservation(state), [state]);
  const residuals = useMemo(() => computeReconciliationResiduals(state), [state]);
  const gate = useMemo(() => computeImportGate(state), [state]);
  const reconciliation = state.pipeline?.reconciliation;

  // Handlers.
  function handleParsed(pipeline: PipelineResultWithFingerprints, summary: UploadSummary): void {
    dispatch({ type: 'UPLOAD_SUCCESS', pipeline, summary });
  }

  function handleSearchSymbol(sourceTickerOrIsin: string): void {
    if (!ctx) return;
    setSearchingFor(sourceTickerOrIsin);
    searchTicker(ctx.api, sourceTickerOrIsin)
      .then((results) => {
        setSearchResults({
          symbol: sourceTickerOrIsin,
          results: results.map((r) => ({
            symbol: r.canonicalSymbol ?? r.symbol,
            exchange: r.exchange,
            ...((r.canonicalExchangeMic ?? r.exchangeMic)
              ? { exchangeMic: r.canonicalExchangeMic ?? r.exchangeMic }
              : {}),
            ...(r.providerId ? { providerId: r.providerId } : {}),
            ...(r.currency ? { quoteCcy: r.currency } : {}),
            ...(r.quoteType ? { instrumentType: r.quoteType } : {}),
            ...(r.providerSymbol ? { providerSymbol: r.providerSymbol } : {}),
            ...(r.assetKind ? { kind: r.assetKind } : {}),
          })),
        });

        if (results.length === 0) {
          dispatch({
            type: 'RESOLVE_SYMBOL',
            sourceTickerOrIsin,
            resolution: { status: 'no-results' },
          });
          return;
        }

        // New mappings always require an explicit user confirmation, even when
        // the search returns a single candidate. Exact saved mappings may be
        // auto-applied earlier in the account/mapping effect after
        // re-verification.
        dispatch({
          type: 'RESOLVE_SYMBOL',
          sourceTickerOrIsin,
          resolution: { status: 'pending' },
        });
      })
      .catch(() => {
        dispatch({
          type: 'RESOLVE_SYMBOL',
          sourceTickerOrIsin,
          resolution: { status: 'blocked', reason: 'Search failed' },
        });
      })
      .finally(() => setSearchingFor(null));
  }

  function handleConfirmSymbol(sourceTickerOrIsin: string, resultIndex: number): void {
    if (!ctx || !searchResults || searchResults.symbol !== sourceTickerOrIsin) return;
    const result = searchResults.results[resultIndex];
    if (!result) return;
    const identity: CanonicalIdentity = {
      symbol: result.symbol,
      ...(result.exchangeMic ? { exchangeMic: result.exchangeMic } : {}),
      ...(result.providerId ? { providerId: result.providerId } : {}),
      ...(result.quoteCcy ? { quoteCcy: result.quoteCcy } : {}),
      ...(result.instrumentType ? { instrumentType: result.instrumentType } : {}),
      ...(result.providerSymbol ? { providerSymbol: result.providerSymbol } : {}),
      ...(result.kind ? { kind: result.kind } : {}),
    };
    const mapping: ResolvedMapping = {
      sourceTickerOrIsin,
      symbol: identity.symbol,
      ...(identity.exchangeMic ? { exchangeMic: identity.exchangeMic } : {}),
      ...(identity.providerId ? { providerId: identity.providerId } : {}),
      ...(identity.quoteCcy ? { quoteCcy: identity.quoteCcy } : {}),
      ...(identity.instrumentType ? { instrumentType: identity.instrumentType } : {}),
      ...(identity.providerSymbol ? { providerSymbol: identity.providerSymbol } : {}),
      ...(identity.kind ? { kind: identity.kind } : {}),
      fromSaved: false,
    };
    dispatch({
      type: 'RESOLVE_SYMBOL',
      sourceTickerOrIsin,
      resolution: { status: 'resolved', mapping },
    });

    // Persist the confirmed mapping.
    if (state.accountId) {
      getImportMapping(ctx.api, state.accountId, IMPORTER_ID)
        .then((existing) => {
          const updated = withSavedMapping(existing, sourceTickerOrIsin, identity);
          return ctx.api.activities.saveImportMapping(updated);
        })
        .catch(() => {
          // Non-fatal: mapping not persisted; will need re-confirmation next time.
        });
    }
  }

  async function handleImport(): Promise<void> {
    if (!ctx || !state.accountId || !state.pipeline || !gate.enabled) return;
    dispatch({ type: 'IMPORT_START' });
    try {
      const accountId = state.accountId;
      const drafts = state.pipeline.batch.activities;

      // Build the asset resolver from confirmed mappings.
      const resolveAsset = async (draft: import('../domain/activity-draft').ActivityDraft) => {
        const key = draft.isin ?? (isInstrumentSymbol(draft.symbol) ? draft.symbol : undefined);
        if (!key) return undefined;
        const res = state.symbolResolutions[key];
        if (res?.status === 'resolved') {
          return identityToAsset({
            symbol: res.mapping.symbol,
            ...(res.mapping.exchangeMic ? { exchangeMic: res.mapping.exchangeMic } : {}),
            ...(res.mapping.providerId ? { providerId: res.mapping.providerId } : {}),
            ...(res.mapping.quoteCcy ? { quoteCcy: res.mapping.quoteCcy } : {}),
            ...(res.mapping.instrumentType ? { instrumentType: res.mapping.instrumentType } : {}),
            ...(res.mapping.providerSymbol ? { providerSymbol: res.mapping.providerSymbol } : {}),
            ...(res.mapping.kind ? { kind: res.mapping.kind } : {}),
          });
        }
        return undefined;
      };

      const flowResult: ImportFlowResult = await runImport(
        ctx.api,
        accountId,
        drafts,
        resolveAsset,
      );
      dispatch({
        type: 'IMPORT_SUCCESS',
        result: {
          attempted: flowResult.attempted,
          created: flowResult.created,
          skippedDuplicates: flowResult.skippedDuplicates,
          blocked: flowResult.blocked,
          failed: flowResult.failedFingerprints.length,
          ...(flowResult.fatal ? { fatal: flowResult.fatal } : {}),
        },
      });
    } catch (err) {
      dispatch({
        type: 'IMPORT_ERROR',
        message: err instanceof Error ? err.message : 'Import failed',
      });
    }
  }

  // Render the stepper + current step.
  return (
    <div className="degiro-importer max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">DEGIRO Importer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import DEGIRO account-statement CSV exports with symbol review and duplicate-safe writes.
        </p>
      </div>

      <Stepper step={state.step} />

      {!ctx ? (
        <p className="text-sm text-muted-foreground">
          Addon context unavailable. The importer cannot run outside the Wealthfolio sandbox.
        </p>
      ) : null}

      {state.step === 'upload' ? (
        <UploadStep
          onParsed={handleParsed}
          uploadError={state.uploadError}
          uploadSummary={state.uploadSummary}
        />
      ) : null}

      {state.step === 'mapping' ? (
        <MappingStep
          uploadSummary={state.uploadSummary!}
          accounts={state.accounts}
          accountId={state.accountId}
          onSelectAccount={(id) => dispatch({ type: 'SELECT_ACCOUNT', accountId: id })}
          instrumentSymbols={state.instrumentSymbols}
          symbolResolutions={state.symbolResolutions}
          onSearchSymbol={handleSearchSymbol}
          onConfirmSymbol={handleConfirmSymbol}
          searchingFor={searchingFor}
          searchResults={searchResults}
          loadingMappings={loadingMappings}
          onContinue={() => dispatch({ type: 'GOTO_STEP', step: 'review' })}
          onBack={() => dispatch({ type: 'RESET_UPLOAD' })}
        />
      ) : null}

      {state.step === 'review' ? (
        <ReviewStep
          rows={reviewRows}
          filters={state.filters}
          onFiltersChange={(f) => dispatch({ type: 'SET_FILTERS', filters: f })}
          onContinue={() => dispatch({ type: 'GOTO_STEP', step: 'reconcile' })}
          onBack={() => dispatch({ type: 'GOTO_STEP', step: 'mapping' })}
        />
      ) : null}

      {state.step === 'reconcile' && reconciliation ? (
        <ReconciliationPanel
          state={state}
          reconciliation={reconciliation}
          conservation={conservation}
          residuals={residuals}
          gate={gate}
          onAcknowledge={(checked) => dispatch({ type: 'SET_ACKNOWLEDGED', acknowledged: checked })}
          onImport={handleImport}
          onBack={() => dispatch({ type: 'GOTO_STEP', step: 'review' })}
        />
      ) : null}

      {state.step === 'importing' ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Importing…</h2>
          <p className="text-sm text-muted-foreground">
            Validating and writing activities. Do not close this page.
          </p>
        </div>
      ) : null}

      {state.step === 'done' && state.importResult ? (
        <ImportResult result={state.importResult} onReset={() => dispatch({ type: 'RESET' })} />
      ) : null}
    </div>
  );
}

/** Compact search result for the mapping UI. */
interface CompactSearchResult {
  symbol: string;
  exchange: string;
  exchangeMic?: string;
  providerId?: string;
  quoteCcy?: string;
  instrumentType?: string;
  providerSymbol?: string;
  kind?: string;
}

/** Convert a `ResolutionOutcome` to a UI `SymbolResolution`. */
function outcomeToResolution(outcome: ReturnType<typeof resolveSymbol>): SymbolResolution {
  switch (outcome.status) {
    case 'resolved':
      return {
        status: 'resolved',
        mapping: {
          sourceTickerOrIsin: '',
          symbol: outcome.identity.symbol,
          ...(outcome.identity.exchangeMic ? { exchangeMic: outcome.identity.exchangeMic } : {}),
          ...(outcome.identity.providerId ? { providerId: outcome.identity.providerId } : {}),
          ...(outcome.identity.quoteCcy ? { quoteCcy: outcome.identity.quoteCcy } : {}),
          ...(outcome.identity.instrumentType
            ? { instrumentType: outcome.identity.instrumentType }
            : {}),
          ...(outcome.identity.providerSymbol
            ? { providerSymbol: outcome.identity.providerSymbol }
            : {}),
          ...(outcome.identity.kind ? { kind: outcome.identity.kind } : {}),
          fromSaved: outcome.fromSaved,
        },
      };
    case 'ambiguous':
      return { status: 'ambiguous', candidateCount: outcome.results.length };
    case 'no-results':
      return { status: 'no-results' };
    case 'blocked':
      return { status: 'blocked', reason: outcome.reason };
  }
}

/** Stepper indicator. */
function Stepper({ step }: { step: ImportState['step'] }): ReactElement {
  const steps: { key: ImportState['step']; label: string }[] = [
    { key: 'upload', label: 'Upload' },
    { key: 'mapping', label: 'Mapping' },
    { key: 'review', label: 'Review' },
    { key: 'reconcile', label: 'Reconcile' },
    { key: 'done', label: 'Done' },
  ];
  const activeIdx = steps.findIndex(
    (s) => s.key === step || (step === 'importing' && s.key === 'reconcile'),
  );

  return (
    <div className="flex items-center gap-1" data-testid="stepper">
      {steps.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={s.key} className="flex items-center gap-1">
            {i > 0 ? <span className="text-muted-foreground">→</span> : null}
            <span
              className={`text-sm px-2 py-0.5 rounded ${
                active
                  ? 'bg-primary text-primary-foreground font-medium'
                  : done
                    ? 'text-success'
                    : 'text-muted-foreground'
              }`}
              data-testid={`step-${s.key}`}
            >
              {done ? '✓ ' : ''}
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
