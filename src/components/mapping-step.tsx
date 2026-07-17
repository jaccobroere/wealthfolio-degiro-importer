/**
 * Mapping step.
 *
 * Selects the destination account and confirms every unseen security via
 * `ctx.api['market-data'].searchTicker(query)`. It can accept an explicitly
 * requested batch of single-result searches, but NEVER selects the first of
 * multiple results. Reuses exact saved mappings via
 * `ctx.api.activities.getImportMapping(accountId, contextKind)` only after
 * verifying canonical identity (symbol+MIC+provider) matches. Unresolved or
 * ambiguous symbols block progression to review.
 *
 * This component is presentational: it receives the instrument symbols, their
 * current resolutions, and callbacks. The page performs the actual host API
 * calls (searchTicker, getImportMapping) in effects/handlers.
 */
import { useState, type ReactElement } from 'react';
import { Button, Badge } from '@wealthfolio/ui';
import { AlertCircle, CheckCircle2, HelpCircle, Search, Loader2 } from 'lucide-react';
import type { SymbolResolution, UploadSummary } from '../state/import-state';
import { AccountSelect, type AccountOption } from './account-select';

export interface MappingStepProps {
  /** Privacy-safe parse results retained after the upload step advances here. */
  uploadSummary: UploadSummary;
  accounts: AccountOption[];
  accountId: string | null;
  onSelectAccount: (accountId: string) => void;
  instrumentSymbols: string[];
  symbolResolutions: Record<string, SymbolResolution>;
  /** Called when the user clicks "Search" for a symbol. */
  onSearchSymbol: (sourceTickerOrIsin: string) => void;
  /** Called when the user manually confirms a search result by index. */
  onConfirmSymbol: (sourceTickerOrIsin: string, resultIndex: number) => void;
  /** Accept all unresolved symbols with exactly one fresh search result. */
  onAcceptAllSuggested: () => Promise<void>;
  /** Whether a search is in progress for a symbol. */
  searchingFor: string | null;
  /** Last search results for a symbol (for manual confirmation). */
  searchResults: {
    symbol: string;
    results: { symbol: string; exchange: string; exchangeMic?: string; providerId?: string }[];
  } | null;
  /** Whether saved mappings are being loaded. */
  loadingMappings: boolean;
  /** Whether the one-result bulk acceptance is in progress. */
  acceptingSuggestedMappings: boolean;
  /** Continue to review (only enabled when all symbols resolved). */
  onContinue: () => void;
  /** Go back to upload. */
  onBack: () => void;
}

export function MappingStep(props: MappingStepProps): ReactElement {
  const {
    uploadSummary,
    accounts,
    accountId,
    onSelectAccount,
    instrumentSymbols,
    symbolResolutions,
    onSearchSymbol,
    onConfirmSymbol,
    onAcceptAllSuggested,
    searchingFor,
    searchResults,
    loadingMappings,
    acceptingSuggestedMappings,
    onContinue,
    onBack,
  } = props;

  const allResolved = instrumentSymbols.every((s) => symbolResolutions[s]?.status === 'resolved');
  const unresolvedCount = instrumentSymbols.filter(
    (s) => symbolResolutions[s]?.status !== 'resolved',
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 2 — Account & symbol mapping</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select the destination account and confirm every security symbol. Ambiguous or unresolved
          symbols block the import.
        </p>
      </div>

      <ParsedStatementSummary summary={uploadSummary} />

      <AccountSelect accounts={accounts} accountId={accountId} onChange={onSelectAccount} />

      {loadingMappings ? (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading saved mappings…
        </p>
      ) : null}

      {accountId && instrumentSymbols.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">
            Securities to confirm ({instrumentSymbols.length})
          </h3>
          {unresolvedCount > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMappings || acceptingSuggestedMappings}
                onClick={() => void onAcceptAllSuggested()}
                data-testid="accept-all-suggested"
              >
                {acceptingSuggestedMappings ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Accept all unambiguous matches
              </Button>
              <p className="text-xs text-muted-foreground">
                Accepts only searches with exactly one result. Multiple or missing results still
                need your review.
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            {instrumentSymbols.map((sym) => (
              <SymbolRow
                key={sym}
                symbol={sym}
                resolution={symbolResolutions[sym] ?? { status: 'pending' }}
                onSearch={() => onSearchSymbol(sym)}
                onConfirm={(idx) => onConfirmSymbol(sym, idx)}
                searching={searchingFor === sym || acceptingSuggestedMappings}
                searchResults={searchResults?.symbol === sym ? searchResults.results : null}
              />
            ))}
          </div>
        </div>
      ) : null}

      {accountId && instrumentSymbols.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No instrument securities in this statement (cash movements only). Continue to review.
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="mapping-back">
          Back
        </Button>
        <div className="flex items-center gap-3">
          {unresolvedCount > 0 ? (
            <Badge variant="warning" data-testid="unresolved-count">
              {unresolvedCount} unresolved
            </Badge>
          ) : null}
          <Button
            disabled={!accountId || !allResolved || loadingMappings}
            onClick={onContinue}
            data-testid="mapping-continue"
          >
            Continue to review
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Keep parse-only evidence visible after the automatic upload → mapping
 * transition. This intentionally contains aggregates only, never statement
 * values or identifiers.
 */
function ParsedStatementSummary({ summary }: { summary: UploadSummary }): ReactElement {
  return (
    <div
      className="rounded-md border border-success/50 bg-success/10 p-3 space-y-1"
      data-testid="parsed-statement-summary"
    >
      <p className="text-sm font-medium">File parsed successfully</p>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span data-testid="parsed-row-count">{summary.rowCount} rows</span>
        <span data-testid="parsed-activity-count">{summary.activityCount} activities</span>
        <span>Header: {summary.headerVariant}</span>
        {summary.minDate && summary.maxDate ? (
          <span>
            Date range: {summary.minDate.slice(0, 10)} → {summary.maxDate.slice(0, 10)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {Object.entries(summary.byActivityType)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([type, count]) => (
            <span key={type} data-testid={`parsed-activity-type-${type}`}>
              {type}: {count}
            </span>
          ))}
      </div>
    </div>
  );
}

interface SymbolRowProps {
  symbol: string;
  resolution: SymbolResolution;
  onSearch: () => void;
  onConfirm: (resultIndex: number) => void;
  searching: boolean;
  searchResults:
    { symbol: string; exchange: string; exchangeMic?: string; providerId?: string }[] | null;
}

function SymbolRow({
  symbol,
  resolution,
  onSearch,
  onConfirm,
  searching,
  searchResults,
}: SymbolRowProps): ReactElement {
  const [showResults, setShowResults] = useState(false);

  return (
    <div
      className="border border-border rounded-md p-3 space-y-2"
      data-testid={`symbol-row-${symbol}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium font-mono truncate">{symbol}</p>
          <ResolutionBadge resolution={resolution} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onSearch();
            setShowResults(true);
          }}
          disabled={searching}
          data-testid={`search-btn-${symbol}`}
        >
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Search
        </Button>
      </div>

      {showResults && searchResults && searchResults.length > 0 ? (
        <div className="space-y-1" data-testid={`search-results-${symbol}`}>
          <p className="text-xs text-muted-foreground">
            {searchResults.length} result(s) — select the correct instrument:
          </p>
          {searchResults.map((r, i) => (
            <button
              key={`${r.symbol}-${r.exchange}-${i}`}
              type="button"
              onClick={() => {
                onConfirm(i);
                setShowResults(false);
              }}
              className="w-full text-left text-sm border border-border rounded px-2 py-1 hover:bg-accent"
              data-testid={`search-result-${symbol}-${i}`}
            >
              <span className="font-mono">{r.symbol}</span>
              <span className="text-muted-foreground"> — {r.exchange}</span>
              {r.exchangeMic ? (
                <span className="text-muted-foreground"> ({r.exchangeMic})</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {showResults && searchResults && searchResults.length === 0 ? (
        <p className="text-xs text-destructive" data-testid={`no-results-${symbol}`}>
          No results found. This symbol blocks the import.
        </p>
      ) : null}
    </div>
  );
}

function ResolutionBadge({ resolution }: { resolution: SymbolResolution }): ReactElement {
  switch (resolution.status) {
    case 'resolved':
      return (
        <Badge variant="success" className="mt-1">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {resolution.mapping.symbol}
          {resolution.mapping.exchangeMic ? ` · ${resolution.mapping.exchangeMic}` : ''}
          {resolution.mapping.fromSaved ? ' (saved)' : ''}
        </Badge>
      );
    case 'ambiguous':
      return (
        <Badge variant="warning" className="mt-1">
          <HelpCircle className="h-3 w-3 mr-1" />
          Ambiguous ({resolution.candidateCount} candidates)
        </Badge>
      );
    case 'no-results':
      return (
        <Badge variant="destructive" className="mt-1">
          <AlertCircle className="h-3 w-3 mr-1" />
          No results
        </Badge>
      );
    case 'blocked':
      return (
        <Badge variant="destructive" className="mt-1">
          <AlertCircle className="h-3 w-3 mr-1" />
          Blocked: {resolution.reason}
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="mt-1">
          Pending
        </Badge>
      );
  }
}
