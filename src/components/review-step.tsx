/**
 * Review step.
 *
 * Categorizes every row outcome and provides filters: errors, warnings,
 * duplicates, skips, cash movements, trades, dividends, fees/taxes/credits.
 * Shows source row number/type + normalized values; does NOT render raw
 * balances or order IDs by default.
 */
import type { ReactElement } from 'react';
import { Button, Badge } from '@wealthfolio/ui';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { ReviewTable } from './review-table';
import type { ReviewRow, ReviewFilters } from '../state/import-state';
import type { DegiroRow } from '../domain/degiro-row';
import type { RowOverride, RowOverrides } from '../domain/row-override';
import type { RowPreview } from '../validation/preview-row';

export interface ReviewStepProps {
  rows: ReviewRow[];
  filters: ReviewFilters;
  onFiltersChange: (filters: Partial<ReviewFilters>) => void;
  /** Pristine parsed source rows, keyed by source row number. */
  sourceRows: ReadonlyMap<number, DegiroRow>;
  /** Active reviewer decisions. */
  overrides: RowOverrides;
  /** Set (or clear, with `null`) the decision for one source row. */
  onOverrideChange: (rowIndex: number, override: RowOverride | null) => void;
  /** Drop every reviewer decision and rebuild from the original file. */
  onClearOverrides: () => void;
  /** Whether the pipeline is currently being recomputed after a decision. */
  rebuilding: boolean;
  /** Message set when recomputing after a decision failed, or null. */
  rebuildError: string | null;
  /** Predict a row's terminal outcome under a candidate decision. */
  predict: (rowIndex: number, candidate: RowOverride | null) => RowPreview;
  onContinue: () => void;
  onBack: () => void;
}

const FILTER_DEFS: { key: keyof ReviewFilters; label: string }[] = [
  { key: 'errors', label: 'Errors' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'skips', label: 'Skips' },
  { key: 'cash', label: 'Cash' },
  { key: 'trades', label: 'Trades' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'feesTaxesCredits', label: 'Fees/Taxes/Credits' },
];

export function ReviewStep({
  rows,
  filters,
  onFiltersChange,
  sourceRows,
  overrides,
  onOverrideChange,
  onClearOverrides,
  rebuilding,
  rebuildError,
  predict,
  onContinue,
  onBack,
}: ReviewStepProps): ReactElement {
  const counts = countByCategory(rows);
  const hasBlocking = counts['requires-review'] > 0 || counts['fatal-invalid'] > 0;
  const overrideCount = Object.keys(overrides).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 3 — Review</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every source row is categorized. Filters toggle visibility. Expand any row to correct its
          values or exclude it — no need to edit the CSV yourself.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_DEFS.map((f) => (
          <FilterToggle
            key={f.key}
            label={f.label}
            active={filters[f.key]}
            onClick={() => onFiltersChange({ [f.key]: !filters[f.key] } as Partial<ReviewFilters>)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="success">New/valid: {counts['new-valid']}</Badge>
        <Badge variant="secondary">Duplicates: {counts.duplicate}</Badge>
        <Badge variant="info">Skips: {counts['known-skip']}</Badge>
        <Badge variant="warning">Warnings: {counts.warning}</Badge>
        <Badge variant="warning">Requires review: {counts['requires-review']}</Badge>
        <Badge variant="destructive">Fatal/invalid: {counts['fatal-invalid']}</Badge>
      </div>

      {hasBlocking ? (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <p className="font-medium">
            {counts['requires-review'] + counts['fatal-invalid']} blocking row(s) present.
          </p>
          <p className="text-muted-foreground mt-0.5">
            Expand a blocking row to fix its values or exclude it from this import. Ignored rows
            stay counted as skips, so every source row remains accounted for.
          </p>
        </div>
      ) : null}

      {rebuildError ? (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          role="alert"
          data-testid="rebuild-error"
        >
          <p className="font-medium text-destructive">Could not apply your changes</p>
          <p className="text-muted-foreground mt-0.5">
            {rebuildError} — the rows below still show the values from the original file. Undo or
            re-apply your change before continuing; import stays blocked until it succeeds.
          </p>
        </div>
      ) : null}

      {overrideCount > 0 ? (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm"
          data-testid="override-summary"
        >
          <p>
            <span className="font-medium">
              {overrideCount} row{overrideCount === 1 ? '' : 's'} changed by you
            </span>
            <span className="text-muted-foreground ml-1">
              {rebuilding
                ? '· recalculating…'
                : '· applied to this import only, never to your file'}
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={onClearOverrides}
            data-testid="clear-overrides"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset all
          </Button>
        </div>
      ) : null}

      <ReviewTable
        rows={rows}
        filters={filters}
        sourceRows={sourceRows}
        overrides={overrides}
        onOverrideChange={onOverrideChange}
        predict={predict}
      />

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="review-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button disabled={rebuilding} onClick={onContinue} data-testid="review-continue">
          {rebuilding ? 'Recalculating…' : 'Continue to reconciliation'}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent'
      }`}
      data-testid={`filter-${label.toLowerCase().replace(/[/\\]/g, '-')}`}
    >
      {label}
    </button>
  );
}

function countByCategory(rows: ReviewRow[]): Record<string, number> {
  const counts: Record<string, number> = {
    'new-valid': 0,
    duplicate: 0,
    'known-skip': 0,
    warning: 0,
    'requires-review': 0,
    'fatal-invalid': 0,
  };
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
  return counts;
}
