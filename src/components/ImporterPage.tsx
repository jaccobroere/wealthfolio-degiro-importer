import React, { useState, useCallback } from 'react';
import type { ActivityImport, ActivityCreate, Account, HostAPI, ImportActivitiesSummary } from '../types';
import { parseCsv } from '../parser/csv';
import { mapToActivities } from '../parser/mapper';
import { extractUniqueSymbols, applyMappings } from '../parser/symbols';
import FileUpload from './FileUpload';
import ActivityTable from './ActivityTable';
import SymbolMappingStep from './SymbolMappingStep';

type Stage = 'idle' | 'mapping' | 'review' | 'importing' | 'done';

interface Props {
  api: HostAPI;
}

export default function ImporterPage({ api }: Props) {
  const [stage, setStage]               = useState<Stage>('idle');
  const [rawActivities, setRawActivities] = useState<ActivityImport[]>([]); // pre-mapping
  const [activities, setActivities]     = useState<ActivityImport[]>([]);   // post-mapping
  const [accounts, setAccounts]         = useState<Account[]>([]);
  const [accountId, setAccountId]       = useState('');
  const [clearFirst, setClearFirst]     = useState(false);
  const [result, setResult]             = useState<ImportActivitiesSummary | null>(null);
  const [error, setError]               = useState<string | null>(null);

  // ── Step 1: file uploaded → go to symbol mapping ───────────────────────────

  const handleFile = useCallback(async (content: string) => {
    setError(null);
    try {
      const rows = parseCsv(content);
      const acts = mapToActivities(rows);
      const accs = await api.accounts.getAll();

      if (acts.length === 0) {
        setError('No importable activities found in this file. Make sure you export the Account statement (not Transactions) from DeGiro.');
        return;
      }

      setRawActivities(acts);
      setAccounts(accs);
      setAccountId(accs[0]?.id ?? '');
      setStage('mapping');
    } catch (e) {
      setError(`Could not parse the file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [api]);

  // ── Step 2: symbol mappings confirmed → apply and go to review ─────────────

  const handleMappingConfirm = useCallback((mappings: Record<string, string>) => {
    setActivities(applyMappings(rawActivities, mappings));
    setStage('review');
  }, [rawActivities]);

  // ── Step 3: user clicks Import ─────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!accountId) return;
    setStage('importing');
    setError(null);
    try {
      if (clearFirst) {
        const existing = await api.activities.getAll(accountId);
        if (existing.length > 0) {
          await api.activities.saveMany({ deleteIds: existing.map(a => a.id) });
        }
      }

      // Convert to ActivityCreate — bypasses the broken import flow, gives
      // per-activity errors so we can see exactly what the server rejects
      const creates: ActivityCreate[] = activities.map(a => {
        const isCash = !a.symbol || a.symbol.startsWith('$CASH-');
        return {
          accountId,
          activityType: a.activityType,
          activityDate: String(a.date ?? ''),
          currency: a.currency,
          quantity: a.quantity ?? null,
          unitPrice: a.unitPrice ?? null,
          amount: a.amount ?? null,
          fee: a.fee ?? null,
          comment: a.comment ?? null,
          // quoteCcy is required for all activities — even cash ones (no symbol)
          asset: isCash
            ? { quoteCcy: a.currency }
            : { symbol: a.symbol as string, quoteCcy: a.currency },
        };
      });

      let imported = 0;
      let duplicates = 0;

      try {
        const saveResult = await api.activities.saveMany({ creates });
        imported = saveResult.created.length;
        const byError = saveResult.errors.reduce<Record<string, number>>((acc, e) => {
          const key = e.message ?? 'unknown';
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        api.logger.info(
          `saveMany: created=${saveResult.created.length}  errors=${saveResult.errors.length}\n` +
          Object.entries(byError).map(([msg, n]) => `  ${n}× ${msg}`).join('\n'),
        );
      } catch (bulkErr) {
        const msg = bulkErr instanceof Error ? bulkErr.message : String(bulkErr);
        if (!msg.toLowerCase().includes('duplicate')) throw bulkErr;

        // Batch rejected due to duplicates — fall back to one-at-a-time so new
        // activities still get imported and duplicates are counted, not fatal.
        api.logger.info('Bulk import hit duplicate; retrying individually…');
        for (const create of creates) {
          try {
            const r = await api.activities.saveMany({ creates: [create] });
            imported += r.created.length;
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (m.toLowerCase().includes('duplicate')) {
              duplicates++;
            } else {
              throw e;
            }
          }
        }
        api.logger.info(`individual retry: created=${imported}  duplicates=${duplicates}`);
      }

      const res = {
        summary: {
          total: activities.length,
          imported,
          skipped: activities.length - imported - duplicates,
          duplicates,
          assetsCreated: 0,
          success: imported > 0 || duplicates === activities.length,
        },
      };
      setResult(res.summary);
      setStage('done');
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setStage('review');
    }
  }, [activities, accountId, clearFirst, api]);

  // ── Step 4: reset ──────────────────────────────────────────────────────────

  function reset() {
    setStage('idle');
    setRawActivities([]);
    setActivities([]);
    setAccounts([]);
    setAccountId('');
    setClearFirst(false);
    setResult(null);
    setError(null);
  }

  // ─── Renders ───────────────────────────────────────────────────────────────

  if (stage === 'idle') {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">DeGiro Importer</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          Upload your DeGiro <strong>Account statement</strong> CSV to import activities into Wealthfolio.
          Export it from DeGiro → Inbox → Account statement → select date range → Download.
        </p>
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 mb-6 flex gap-2">
          <span className="mt-0.5 shrink-0">ℹ️</span>
          <span>
            Activity times are recorded in <strong>Europe/Amsterdam</strong> time (CET / CEST).
            DeGiro CSV timestamps have no timezone indicator — this addon always interprets them as Amsterdam local time.
          </span>
        </div>
        {error && <ErrorBanner message={error} />}
        <FileUpload onFile={handleFile} />
      </div>
    );
  }

  if (stage === 'mapping') {
    return (
      <SymbolMappingStep
        symbols={extractUniqueSymbols(rawActivities)}
        accounts={accounts}
        accountId={accountId}
        onAccountChange={setAccountId}
        api={api}
        onConfirm={handleMappingConfirm}
        onBack={reset}
      />
    );
  }

  if (stage === 'done' && result) {
    return (
      <div className="p-8 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-6">Import complete</h1>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <StatCard label="Total"      value={result.total}      />
          <StatCard label="Imported"   value={result.imported}   accent="green" />
          <StatCard label="Skipped"    value={result.skipped}    />
          <StatCard label="Duplicates" value={result.duplicates} />
        </div>
        <button
          onClick={reset}
          className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Import another file
        </button>
      </div>
    );
  }

  // review | importing
  const invalidCount = activities.filter(a => !a.isValid).length;

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      {/* ── Header bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold leading-tight">Review activities</h1>
          <p className="text-xs text-muted-foreground">
            {activities.length} activities parsed
            {invalidCount > 0 && ` · ${invalidCount} need a symbol`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {/* Account selector */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground whitespace-nowrap">Import into</span>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              disabled={stage === 'importing'}
              className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {accounts.length === 0 && (
                <option value="">No accounts found</option>
              )}
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={clearFirst}
              onChange={e => setClearFirst(e.target.checked)}
              disabled={stage === 'importing'}
              className="h-4 w-4 rounded border accent-destructive"
            />
            <span className={clearFirst ? 'text-destructive font-medium' : 'text-muted-foreground'}>
              Clear account first
            </span>
          </label>

          <button
            onClick={() => setStage('mapping')}
            disabled={stage === 'importing'}
            className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50"
          >
            Back
          </button>

          <button
            onClick={handleImport}
            disabled={stage === 'importing' || !accountId || accounts.length === 0}
            className="rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {stage === 'importing'
              ? 'Importing…'
              : `Import ${activities.length} activities`}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <ActivityTable activities={activities} onChange={setActivities} />
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive mb-4">
      {message}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: 'green' }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-3xl font-bold ${accent === 'green' ? 'text-green-600 dark:text-green-400' : ''}`}>
        {value}
      </p>
    </div>
  );
}
