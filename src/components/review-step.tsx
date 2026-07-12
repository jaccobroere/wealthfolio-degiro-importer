/**
 * Review step (T07, step 3/4).
 *
 * Categorizes every row outcome and provides filters: errors, warnings,
 * duplicates, skips, cash movements, trades, dividends, fees/taxes/credits.
 * Shows source row number/type + normalized values; does NOT render raw
 * balances or order IDs by default.
 */
import type { ReactElement } from 'react';
import { Button, Badge } from '@wealthfolio/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ReviewTable } from './review-table';
import type { ReviewRow, ReviewFilters } from '../state/import-state';

export interface ReviewStepProps {
  rows: ReviewRow[];
  filters: ReviewFilters;
  onFiltersChange: (filters: Partial<ReviewFilters>) => void;
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
  onContinue,
  onBack,
}: ReviewStepProps): ReactElement {
  const counts = countByCategory(rows);
  const hasBlocking = counts['requires-review'] > 0 || counts['fatal-invalid'] > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 3 — Review</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every source row is categorized. Filters toggle visibility. Blocking rows (errors,
          unsupported) must be resolved before import.
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
            Unsupported or invalid rows must be resolved (e.g. corrected in the source file) before
            the import can proceed.
          </p>
        </div>
      ) : null}

      <ReviewTable rows={rows} filters={filters} />

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="review-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button onClick={onContinue} data-testid="review-continue">
          Continue to reconciliation
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
