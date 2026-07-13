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
import type {
  ImportState,
  ConservationSummary,
  ReconciliationResiduals,
  ImportGate,
} from '../state/import-state';
import type { Reconciliation } from '../reconciliation/reconcile';

export interface ReconciliationPanelProps {
  state: ImportState;
  reconciliation: Reconciliation;
  conservation: ConservationSummary;
  residuals: ReconciliationResiduals;
  gate: ImportGate;
  onAcknowledge: (checked: boolean) => void;
  onImport: () => void;
  onBack: () => void;
}

export function ReconciliationPanel(props: ReconciliationPanelProps): ReactElement {
  const { state, reconciliation, conservation, residuals, gate, onAcknowledge, onImport, onBack } =
    props;

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
                  <th className="text-left px-3 py-1.5 font-medium">Symbol / ISIN</th>
                  <th className="text-right px-3 py-1.5 font-medium">Net quantity</th>
                  <th className="text-right px-3 py-1.5 font-medium">Trades</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.positions.map((p) => (
                  <tr key={p.key} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {p.symbol}
                      {p.isin ? <span className="text-muted-foreground ml-2">{p.isin}</span> : null}
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
          <Stat
            label="BUY w/ accrued"
            value={reconciliation.buyDraftsWithAccruedInterestCount}
            ok={reconciliation.buyDraftsWithAccruedInterestCount === 0}
          />
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
            I have reviewed the reconciliation summary and confirm the conservation invariants hold.
            I understand this will write {state.pipeline?.batch.activities.length ?? 0} activity
            draft(s) to the selected account.
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
