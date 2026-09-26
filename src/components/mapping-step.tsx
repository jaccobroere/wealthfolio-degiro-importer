/**
 * Mapping step.
 *
 * Selects the destination account and confirms every unseen security. Search
 * results are ranked by `listing-choice.ts` (same instrument → traded
 * currency → preferred exchanges); the reviewer can run a free-text search
 * per security and pick any listing. The explicit "accept suggested" action
 * takes only a listing that is the same instrument, in the traded currency,
 * and strictly first on exchange preference — never merely the first result. Reuses exact saved mappings via
 * `ctx.api.activities.getImportMapping(accountId, contextKind)` only after
 * verifying canonical identity (symbol+MIC+provider) matches. Unresolved or
 * ambiguous symbols block progression to review.
 *
 * This component is presentational: it receives the instrument symbols, their
 * current resolutions, and callbacks. The page performs the actual host API
 * calls (searchTicker, getImportMapping) in effects/handlers.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button, Badge } from '@wealthfolio/ui';
import { AlertCircle, CheckCircle2, HelpCircle, Search, Loader2 } from 'lucide-react';
import type { SecurityContext, SymbolResolution, UploadSummary } from '../state/import-state';
import { parseExchangeList } from '../mapping/listing-choice';

/** One ranked search result, as shown for manual confirmation. */
export interface RankedResultView {
  /** Canonical symbol persisted for the asset (e.g. `IWDA`). */
  symbol: string;
  /** Provider symbol as searched/displayed (e.g. `IWDA.AS`). */
  providerSymbolLabel: string;
  exchange: string;
  exchangeMic?: string;
  providerId?: string;
  quoteCcy?: string;
  instrumentType?: string;
  providerSymbol?: string;
  kind?: string;
  name?: string;
  sameInstrument: boolean;
  currencyMatch: boolean;
  preferredExchange: boolean;
  suggested: boolean;
}
import { AccountSelect, type AccountOption } from './account-select';

export interface MappingStepProps {
  /** Privacy-safe parse results retained after the upload step advances here. */
  uploadSummary: UploadSummary;
  accounts: AccountOption[];
  accountId: string | null;
  onSelectAccount: (accountId: string) => void;
  instrumentSymbols: string[];
  symbolResolutions: Record<string, SymbolResolution>;
  /** Search a security: broad search without a query, else the given query. */
  onSearchSymbol: (sourceTickerOrIsin: string, query?: string) => void;
  /** Called when the user manually confirms a search result by index. */
  onConfirmSymbol: (sourceTickerOrIsin: string, resultIndex: number) => void;
  /** Remove an obsolete remembered mapping and start a fresh search. */
  onForgetSavedMapping: (sourceTickerOrIsin: string) => void;
  /** Accept the suggested listing for every unresolved security. */
  onAcceptAllSuggested: () => Promise<void>;
  /** Whether a search is in progress for a symbol. */
  searchingFor: string | null;
  /** Ranked search results per security. */
  rankedResults: Record<string, RankedResultView[]>;
  /** Statement name and traded currency per security. */
  securityContexts: Record<string, SecurityContext>;
  /** Exchange MICs in order of preference. */
  preferredExchanges: string[];
  onSavePreferredExchanges: (exchanges: string[]) => Promise<void>;
  /** Number of mappings this add-on remembers for the account. */
  rememberedCount: number;
  /** Forget every remembered mapping of this add-on for the account. */
  onForgetAllMappings: () => Promise<void>;
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
    onForgetSavedMapping,
    onAcceptAllSuggested,
    searchingFor,
    rankedResults,
    securityContexts,
    preferredExchanges,
    onSavePreferredExchanges,
    rememberedCount,
    onForgetAllMappings,
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
        <MappingSettings
          preferredExchanges={preferredExchanges}
          onSave={onSavePreferredExchanges}
          rememberedCount={rememberedCount}
          onForgetAll={onForgetAllMappings}
        />
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
                Accept suggested listings
              </Button>
              <p className="text-xs text-muted-foreground">
                Accepts a listing only when it is the same instrument, in the currency you traded it
                in, and first on your exchange preference. Everything else stays for your review.
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            {instrumentSymbols.map((sym) => (
              <SymbolRow
                key={sym}
                symbol={sym}
                resolution={symbolResolutions[sym] ?? { status: 'pending' }}
                context={securityContexts[sym]}
                onSearch={(query) => onSearchSymbol(sym, query)}
                onConfirm={(idx) => onConfirmSymbol(sym, idx)}
                onForgetSavedMapping={() => onForgetSavedMapping(sym)}
                searching={searchingFor === sym || acceptingSuggestedMappings}
                searchResults={rankedResults[sym] ?? null}
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
  context: SecurityContext | undefined;
  onSearch: (query?: string) => void;
  onConfirm: (resultIndex: number) => void;
  onForgetSavedMapping: () => void;
  searching: boolean;
  searchResults: RankedResultView[] | null;
}

function SymbolRow({
  symbol,
  resolution,
  context,
  onSearch,
  onConfirm,
  onForgetSavedMapping,
  searching,
  searchResults,
}: SymbolRowProps): ReactElement {
  const [showResults, setShowResults] = useState(false);
  const [query, setQuery] = useState('');
  const hasResults = !!searchResults && searchResults.length > 0;
  // Unresolved rows show their ranked results as soon as they exist.
  const open = showResults || (resolution.status !== 'resolved' && hasResults);

  return (
    <div
      className="border border-border rounded-md p-3 space-y-2"
      data-testid={`symbol-row-${symbol}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {context?.name ?? symbol}
            {context?.name ? (
              <span className="font-mono text-xs text-muted-foreground ml-2">{symbol}</span>
            ) : null}
          </p>
          {context?.tradedCurrency ? (
            <p className="text-xs text-muted-foreground">
              Traded in {context.tradedCurrency} on DEGIRO
            </p>
          ) : null}
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
          {resolution.status === 'resolved' ? 'Change' : 'Search'}
        </Button>
      </div>

      {open ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) onSearch(query.trim());
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search another ticker or name, e.g. IWDA.AS"
            className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
            aria-label={`Custom search for ${symbol}`}
            data-testid={`custom-query-${symbol}`}
          />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={searching || !query.trim()}
            data-testid={`custom-search-${symbol}`}
          >
            Search
          </Button>
        </form>
      ) : null}

      {open && hasResults ? (
        <div className="space-y-1" data-testid={`search-results-${symbol}`}>
          <p className="text-xs text-muted-foreground">
            {searchResults.length} listing(s), best match first — select the one you hold:
          </p>
          {searchResults.map((r, i) => (
            <button
              key={`${r.providerSymbolLabel}-${r.exchangeMic ?? r.exchange}-${i}`}
              type="button"
              onClick={() => {
                onConfirm(i);
                setShowResults(false);
              }}
              className={`w-full text-left text-sm border rounded px-2 py-1 hover:bg-accent ${
                r.suggested ? 'border-success' : 'border-border'
              } ${r.sameInstrument ? '' : 'opacity-70'}`}
              data-testid={`search-result-${symbol}-${i}`}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono font-medium">{r.providerSymbolLabel}</span>
                <span className="text-muted-foreground">
                  {r.exchange}
                  {r.exchangeMic ? ` (${r.exchangeMic})` : ''}
                </span>
                {r.quoteCcy ? (
                  <span className={r.currencyMatch ? 'font-medium' : 'text-muted-foreground'}>
                    {r.quoteCcy}
                  </span>
                ) : null}
                {r.suggested ? <Badge variant="success">Suggested</Badge> : null}
                {r.currencyMatch ? <Badge variant="secondary">Traded currency</Badge> : null}
                {!r.sameInstrument ? <Badge variant="warning">Other instrument?</Badge> : null}
              </span>
              {r.name ? (
                <span className="block text-xs text-muted-foreground truncate">{r.name}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {open && searchResults && searchResults.length === 0 ? (
        <p className="text-xs text-destructive" data-testid={`no-results-${symbol}`}>
          No results found. Try another ticker or the name above.
        </p>
      ) : null}

      {resolution.status === 'blocked' &&
      resolution.reason ===
        'Saved mapping does not match any current search result; review required' ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <p className="text-xs text-muted-foreground">
            This remembered mapping belongs to this account but is no longer current. Search and
            choose a replacement, or remove it before trying again.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onForgetSavedMapping();
              setShowResults(true);
            }}
            disabled={searching}
            data-testid={`forget-saved-mapping-${symbol}`}
          >
            Remove remembered mapping
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Exchange preference and "forget remembered mappings" for the account. */
function MappingSettings({
  preferredExchanges,
  onSave,
  rememberedCount,
  onForgetAll,
}: {
  preferredExchanges: string[];
  onSave: (exchanges: string[]) => Promise<void>;
  rememberedCount: number;
  onForgetAll: () => Promise<void>;
}): ReactElement {
  const [text, setText] = useState(preferredExchanges.join(', '));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(preferredExchanges.join(', ')), [preferredExchanges]);
  const dirty = parseExchangeList(text).join(',') !== preferredExchanges.join(',');

  return (
    <div className="rounded-md border border-border p-3 space-y-3" data-testid="mapping-settings">
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(parseExchangeList(text));
        }}
      >
        <label className="text-sm font-medium" htmlFor="preferred-exchanges">
          Preferred exchanges
        </label>
        <div className="flex items-center gap-2">
          <input
            id="preferred-exchanges"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm font-mono"
            data-testid="preferred-exchanges"
          />
          <Button type="submit" variant="outline" size="sm" disabled={!dirty}>
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Exchange codes (MIC) in order of preference, e.g. XAMS (Amsterdam), XETR (Xetra), XPAR
          (Paris), XMIL (Milan), XLON (London). Listings in the currency you traded in always come
          first. Saved for this account.
        </p>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground flex-1">
          {rememberedCount > 0
            ? `${rememberedCount} remembered mapping(s) for this account are applied automatically.`
            : 'No remembered mappings for this account.'}
        </p>
        {confirming ? (
          <>
            <span className="text-xs">Forget all {rememberedCount} for this account?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onForgetAll()
                  .catch(() => {
                    // Nothing changed; the button can be used again.
                  })
                  .finally(() => {
                    setBusy(false);
                    setConfirming(false);
                  });
              }}
              data-testid="confirm-forget-all-mappings"
            >
              Forget all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={rememberedCount === 0}
            onClick={() => setConfirming(true)}
            data-testid="forget-all-mappings"
          >
            Forget remembered mappings
          </Button>
        )}
      </div>
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
