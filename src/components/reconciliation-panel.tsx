/**
 * Reconciliation panel.
 *
 * Shows net position movement per resolved asset + cash movement per currency.
 * DEGIRO additionally shows fees, taxes, accrued interest (the 4 Meegekochte
 * Rente rows), internal skips, and residuals. The Import button is disabled
 * until ALL blocking conditions are cleared and the user acknowledges.
 *
 * Conservation summary semantics so grouped rows aren't double-counted:
 *   total input rows = standalone outcomes + group-member rows
 *   every row has one terminal source-row outcome
 *   every activity draft references ≥1 source rows
 */
import type { ReactElement } from 'react';
import { Button, Badge, Checkbox } from '@wealthfolio/ui';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import {
  countOverrides,
  type ImportState,
  type ConservationSummary,
  type ReconciliationResiduals,
  type ImportGate,
} from '../state/import-state';
import type { Reconciliation } from '../reconciliation/reconcile';
import type { ExistingActivityLike, ExistingMatchReport } from '../duplicates/existing-match';
import { SecurityLabel } from './security-label';

export interface ReconciliationPanelProps {
  state: ImportState;
  reconciliation: Reconciliation;
  conservation: ConservationSummary;
  residuals: ReconciliationResiduals;
  gate: ImportGate;
  /** Match against the account's activities; null while they load. */
  accountMatch: ExistingMatchReport | null;
  onAcknowledge: (checked: boolean) => void;
  onImport: () => void;
  onBack: () => void;
}

export function ReconciliationPanel(props: ReconciliationPanelProps): ReactElement {
  const {
    state,
    reconciliation,
    conservation,
    residuals,
    gate,
    accountMatch,
    onAcknowledge,
    onImport,
    onBack,
  } = props;
  const overrideCounts = countOverrides(state.overrides);
  const totalActivities = state.pipeline?.batch.activities.length ?? 0;
  const alreadyInAccount = accountMatch
    ? accountMatch.counts.existing + accountMatch.counts.existingUnlinked
    : 0;
  const unlinkedOnly = accountMatch
    ? unlinkedOnlyMatches(accountMatch, state.existingActivities)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 4 — Reconcile & import</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Verify the reconciliation summary, acknowledge the conservation invariants, and confirm
          the import. No activities are written until you click Import.
        </p>
      </div>

      {/* Conservation summary */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Conservation summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <Stat label="Input rows" value={conservation.totalInputRows} />
          <Stat label="Standalone outcomes" value={conservation.standaloneOutcomes} />
          <Stat label="Group-member rows" value={conservation.groupMemberRows} />
          <Stat label="Known skips" value={conservation.skipRows} />
          <Stat label="Unsupported" value={conservation.unsupportedRows} />
          <Stat label="Invalid" value={conservation.invalidRows} />
          <Stat label="Residual" value={conservation.residual} ok={conservation.residual === 0} />
          <Stat
            label="Activities w/o source rows"
            value={conservation.activitiesWithoutSourceRows}
            ok={conservation.activitiesWithoutSourceRows === 0}
          />
        </div>
      </section>

      {/* Reviewer decisions: must be visible before the acknowledgement. */}
      {overrideCounts.ignored + overrideCounts.edited > 0 ? (
        <section className="space-y-2" data-testid="override-audit">
          <h3 className="text-sm font-medium">Your changes to this statement</h3>
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm space-y-1">
            {overrideCounts.ignored > 0 ? (
              <p>
                <span className="font-medium">{overrideCounts.ignored} row(s) ignored</span>
                <span className="text-muted-foreground ml-1">
                  — excluded from the import and counted as skips.
                </span>
              </p>
            ) : null}
            {overrideCounts.edited > 0 ? (
              <p>
                <span className="font-medium">{overrideCounts.edited} row(s) edited</span>
                <span className="text-muted-foreground ml-1">
                  — activities built from them are flagged with a warning.
                </span>
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              These changes affect this import only; your CSV file is untouched. The totals below
              already reflect them.
            </p>
          </div>
        </section>
      ) : null}

      {/* Net positions */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Net position movement</h3>
        {reconciliation.positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No instrument trades in this statement.</p>
        ) : (
          <div className="border border-border rounded-md overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Security</th>
                  <th className="text-right px-3 py-1.5 font-medium">Net quantity</th>
                  <th className="text-right px-3 py-1.5 font-medium">Trades</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.positions.map((p) => (
                  <tr key={p.key} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <SecurityLabel
                        source={p.symbol}
                        {...(p.isin ? { isin: p.isin } : {})}
                        {...(p.symbolName ? { name: p.symbolName } : {})}
                        {...resolvedFor(state, p.key)}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{p.netQuantity}</td>
                    <td className="px-3 py-1.5 text-right">{p.tradeActivityCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Already on the destination account */}
      <section className="space-y-2" data-testid="account-match">
        <h3 className="text-sm font-medium">Already in Wealthfolio</h3>
        {accountMatch === null ? (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 mr-1 inline animate-spin" />
            Checking the activities already on this account…
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <Stat label="New activities" value={accountMatch.counts.new} />
              <Stat label="Already in account (skipped)" value={alreadyInAccount} />
              <Stat
                label="Stored without security"
                value={accountMatch.counts.existingUnlinked}
                ok={accountMatch.counts.existingUnlinked === 0}
              />
              <Stat
                label="Extra copies in account"
                value={accountMatch.counts.extraCopies}
                ok={accountMatch.counts.extraCopies === 0}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Matched on type, day, currency and amount (quantity and value for trades), so a newer
              full export only adds what is new.
            </p>
            {accountMatch.extraCopies.length > 0 ? (
              <AccountActivityList
                testId="extra-copies"
                title={`${accountMatch.extraCopies.length} extra cop${accountMatch.extraCopies.length === 1 ? 'y' : 'ies'} of activities in this statement`}
                explanation="These duplicate an activity that is already in Wealthfolio, usually left behind by an earlier import. They inflate your cash and holdings. Delete them in Wealthfolio's Activities page; this import will not touch them."
                activities={accountMatch.extraCopies}
              />
            ) : null}
            {unlinkedOnly.length > 0 ? (
              <AccountActivityList
                testId="unlinked-matches"
                title={`${unlinkedOnly.length} activit${unlinkedOnly.length === 1 ? 'y is' : 'ies are'} in Wealthfolio without a security`}
                explanation="An earlier add-on version stored these before their security existed, so they move cash but not holdings. This import will not add them again. To repair them, delete them in Wealthfolio and run this import again: they will be re-created linked to their security."
                activities={unlinkedOnly}
              />
            ) : null}
          </>
        )}
      </section>

      {/* Cash by currency */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Cash movement by currency</h3>
        {reconciliation.cashByCurrency.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cash movements.</p>
        ) : (
          <div className="border border-border rounded-md overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Ccy</th>
                  <th className="text-right px-3 py-1.5 font-medium">Net</th>
                  <th className="text-right px-3 py-1.5 font-medium">Fees</th>
                  <th className="text-right px-3 py-1.5 font-medium">Taxes</th>
                  <th className="text-right px-3 py-1.5 font-medium">Accrued int.</th>
                  <th className="text-right px-3 py-1.5 font-medium">Activities</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.cashByCurrency.map((c) => (
                  <tr key={c.currency} className="border-t border-border">
                    <td className="px-3 py-1.5">{c.currency}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{c.netAmount}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{c.fees}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{c.taxes}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{c.accruedInterest}</td>
                    <td className="px-3 py-1.5 text-right">{c.activityCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* DEGIRO-specific extras */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">DEGIRO specifics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <Stat
            label="Accrued interest rows"
            value={reconciliation.accruedInterestSourceRowCount}
          />
          <Stat
            label="Accrued interest activities"
            value={reconciliation.accruedInterestActivityCount}
          />
          <Stat label="Internal cash skips" value={reconciliation.knownInternalMovementCount} />
          <Stat label="Accrued settlements" value={reconciliation.accruedInterestSettlementCount} />
        </div>
      </section>

      {/* Residuals */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Residual rules</h3>
        {residuals.pass ? (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            All residual rules pass
          </div>
        ) : (
          <div className="space-y-1">
            {residuals.failures.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {f}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Blockers */}
      {gate.blockers.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Import blockers</h3>
          <ul className="space-y-1">
            {gate.blockers.map((b, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                {b}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Acknowledgement */}
      <section className="space-y-2">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={state.acknowledged}
            onCheckedChange={(v) => onAcknowledge(v === true)}
            data-testid="acknowledge-checkbox"
          />
          <span>
            I have reviewed the reconciliation summary and confirm the conservation invariants hold.{' '}
            {writeSummary(
              accountMatch ? accountMatch.counts.new : totalActivities,
              alreadyInAccount,
            )}
          </span>
        </label>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={state.importing}
          data-testid="reconcile-back"
        >
          Back
        </Button>
        <div className="flex items-center gap-3">
          {state.importing ? (
            <Badge variant="info" data-testid="importing-badge">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Importing…
            </Badge>
          ) : null}
          <Button
            disabled={!gate.enabled || state.importing}
            onClick={onImport}
            data-testid="import-button"
          >
            <ShieldCheck className="h-4 w-4 mr-1" />
            Import
          </Button>
        </div>
      </div>

      {state.importError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">Import failed</p>
          <p className="text-muted-foreground mt-0.5">{state.importError}</p>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: number; ok?: boolean }): ReactElement {
  const isOk = ok ?? true;
  return (
    <div className="border border-border rounded px-2 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono ${isOk ? '' : 'text-destructive'}`}>{value}</p>
    </div>
  );
}

/** "I understand this will write …" completion for the acknowledgement. */
function writeSummary(toWrite: number, skipped: number): string {
  const noun = toWrite === 1 ? 'activity' : 'activities';
  const skip =
    skipped > 0 ? ` and skip ${skipped} that ${skipped === 1 ? 'is' : 'are'} already there` : '';
  return `I understand this will write ${toWrite} new ${noun} to the selected account${skip}.`;
}

/** Resolved-security props for a source identifier, when its mapping is confirmed. */
function resolvedFor(
  state: ImportState,
  sourceKey: string,
): { resolved?: { symbol: string; exchangeMic?: string } } {
  const res = state.symbolResolutions[sourceKey];
  if (res?.status !== 'resolved') return {};
  return {
    resolved: {
      symbol: res.mapping.symbol,
      ...(res.mapping.exchangeMic ? { exchangeMic: res.mapping.exchangeMic } : {}),
    },
  };
}

/** Unlinked account copies that are the only copy of a statement activity. */
function unlinkedOnlyMatches(
  report: ExistingMatchReport,
  existing: ExistingActivityLike[] | null,
): ExistingActivityLike[] {
  const byId = new Map((existing ?? []).map((e) => [e.id, e]));
  const out: ExistingActivityLike[] = [];
  for (const m of report.matches) {
    if (m.kind !== 'existing-unlinked') continue;
    const e = byId.get(m.existingId);
    if (e) out.push(e);
  }
  return out;
}

function formatDay(date: string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

function AccountActivityList({
  testId,
  title,
  explanation,
  activities,
}: {
  testId: string;
  title: string;
  explanation: string;
  activities: ExistingActivityLike[];
}): ReactElement {
  return (
    <div
      className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm space-y-2"
      data-testid={testId}
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground text-xs">{explanation}</p>
      <div className="border border-border rounded-md overflow-auto max-h-64 bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2 py-1 font-medium">Date</th>
              <th className="text-left px-2 py-1 font-medium">Type</th>
              <th className="text-left px-2 py-1 font-medium">Security in Wealthfolio</th>
              <th className="text-right px-2 py-1 font-medium">Quantity</th>
              <th className="text-right px-2 py-1 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-2 py-1 font-mono">{formatDay(e.date)}</td>
                <td className="px-2 py-1">{e.activityType}</td>
                <td className="px-2 py-1">
                  {e.assetSymbol ? (
                    <span className="font-mono">
                      {e.assetSymbol}
                      {e.assetName ? (
                        <span className="text-muted-foreground font-sans"> · {e.assetName}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-destructive">none</span>
                  )}
                </td>
                <td className="px-2 py-1 text-right font-mono">{e.quantity ?? '—'}</td>
                <td className="px-2 py-1 text-right font-mono">
                  {e.amount ?? '—'} {e.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
