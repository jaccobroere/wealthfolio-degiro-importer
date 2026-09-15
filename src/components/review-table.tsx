/**
 * Review table.
 *
 * Renders the categorized review rows. Shows source row number/type +
 * normalized values only. Does NOT render raw balances or order IDs by
 * default. Privacy-safe.
 *
 * Each row expands into per-source-row reviewer controls (`RowEditor`), which
 * is the one place raw source values are shown — only for a row the reviewer
 * chose to open.
 */
import { useState, type ReactElement } from 'react';
import { Badge, Button } from '@wealthfolio/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@wealthfolio/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReviewRow, ReviewFilters } from '../state/import-state';
import type { ReviewCategory } from '../state/import-state';
import type { DegiroRow } from '../domain/degiro-row';
import type { RowOverride, RowOverrides } from '../domain/row-override';
import { RowEditor } from './row-editor';
import type { RowPreview } from '../validation/preview-row';

export interface ReviewTableProps {
  rows: ReviewRow[];
  filters: ReviewFilters;
  /** Pristine parsed source rows, keyed by source row number. */
  sourceRows: ReadonlyMap<number, DegiroRow>;
  /** Active reviewer decisions. */
  overrides: RowOverrides;
  /** Set (or clear, with `null`) the decision for one source row. */
  onOverrideChange: (rowIndex: number, override: RowOverride | null) => void;
  /** Predict a row's terminal outcome under a candidate decision. */
  predict: (rowIndex: number, candidate: RowOverride | null) => RowPreview;
}

const COLUMN_COUNT = 9;

const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  'new-valid': 'New / valid',
  duplicate: 'Duplicate',
  'known-skip': 'Known skip',
  warning: 'Warning',
  'requires-review': 'Requires review',
  'fatal-invalid': 'Fatal / invalid',
};

const CATEGORY_VARIANT: Record<
  ReviewCategory,
  'default' | 'destructive' | 'success' | 'warning' | 'secondary' | 'info'
> = {
  'new-valid': 'success',
  duplicate: 'secondary',
  'known-skip': 'info',
  warning: 'warning',
  'requires-review': 'warning',
  'fatal-invalid': 'destructive',
};

/** Cash activity types for the cash filter. */
const CASH_TYPES = new Set(['DEPOSIT', 'WITHDRAWAL', 'INTEREST']);
/** Dividend activity types. */
const DIVIDEND_TYPES = new Set(['DIVIDEND']);
/** Fees/taxes/credits activity types. */
const FEE_TAX_TYPES = new Set(['FEE', 'TAX']);
/** Trade activity types. */
const TRADE_TYPES = new Set(['BUY', 'SELL']);

export function ReviewTable({
  rows,
  filters,
  sourceRows,
  overrides,
  onOverrideChange,
  predict,
}: ReviewTableProps): ReactElement {
  const filtered = rows.filter((r) => matchesFilters(r, filters));
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Showing {filtered.length} of {rows.length} rows
      </p>
      <div className="border border-border rounded-md overflow-auto max-h-[28rem]">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="w-20">Row</TableHead>
              <TableHead className="w-28">Category</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="w-24 text-right">Quantity</TableHead>
              <TableHead className="w-28 text-right">Amount</TableHead>
              <TableHead className="w-20">Ccy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="text-center text-muted-foreground py-6"
                >
                  No rows match the active filters
                </TableCell>
              </TableRow>
            ) : null}
            {filtered.map((r, i) => {
              const key = r.sourceRowNumbers.join(',');
              const isOpen = expanded === key;
              const blocking = r.category === 'requires-review' || r.category === 'fatal-invalid';
              return [
                <TableRow
                  key={`${key}-${i}`}
                  data-testid={`review-row-${i}`}
                  className={r.overrideKind === 'ignore' ? 'opacity-60' : undefined}
                >
                  <TableCell className="p-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setExpanded(isOpen ? null : key)}
                      aria-expanded={isOpen}
                      aria-label={`Reviewer actions for source row ${key}`}
                      data-testid={`review-expand-${i}`}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell>
                    <Badge
                      variant={CATEGORY_VARIANT[r.category]}
                      data-testid={`review-category-${i}`}
                    >
                      {CATEGORY_LABEL[r.category]}
                    </Badge>
                    {r.overrideKind ? (
                      <Badge
                        variant="secondary"
                        className="ml-1"
                        data-testid={`review-override-${i}`}
                      >
                        {r.overrideKind === 'ignore' ? 'Ignored' : 'Edited'}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">{r.activityType ?? '—'}</TableCell>
                  <TableCell className="text-sm font-mono">
                    {r.symbol ?? '—'}
                    {r.unresolvedSymbol ? <span className="text-destructive ml-1">⚠</span> : null}
                    {r.hasAccruedInterest ? (
                      <span className="text-warning ml-1" title="Carries accrued interest">
                        ⏳
                      </span>
                    ) : null}
                    {blocking ? (
                      <span className="text-muted-foreground ml-1 text-xs">{r.reason ?? ''}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">{r.date ? r.date.slice(0, 10) : '—'}</TableCell>
                  <TableCell className="text-sm text-right font-mono">
                    {r.quantity ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono">{r.amount ?? '—'}</TableCell>
                  <TableCell className="text-sm">{r.currency ?? '—'}</TableCell>
                </TableRow>,
                isOpen ? (
                  <TableRow key={`${key}-${i}-detail`} data-testid={`review-detail-${i}`}>
                    <TableCell colSpan={COLUMN_COUNT} className="bg-muted/20">
                      <div className="space-y-2">
                        {r.sourceRowNumbers.map((n) => {
                          const source = sourceRows.get(n);
                          return source ? (
                            <RowEditor
                              // Remount when the decision changes from outside
                              // (e.g. "Reset all"), so a half-typed edit cannot
                              // be applied on top of the reset.
                              key={`${n}-${overrides[n]?.kind ?? 'none'}`}
                              row={source}
                              override={overrides[n]}
                              onChange={onOverrideChange}
                              predict={predict}
                            />
                          ) : null;
                        })}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null,
              ];
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Whether a review row matches the active filters. */
function matchesFilters(r: ReviewRow, f: ReviewFilters): boolean {
  // Category-based filters.
  if (r.category === 'fatal-invalid' || r.category === 'requires-review') {
    if (!f.errors) return false;
    return true;
  }
  if (r.category === 'warning') {
    if (!f.warnings) return false;
    return true;
  }
  if (r.category === 'duplicate') {
    if (!f.duplicates) return false;
    return true;
  }
  if (r.category === 'known-skip') {
    if (!f.skips) return false;
    return true;
  }

  // new-valid: apply activity-type filters.
  const type = r.activityType;
  if (type && CASH_TYPES.has(type)) return f.cash;
  if (type && DIVIDEND_TYPES.has(type)) return f.dividends;
  if (type && FEE_TAX_TYPES.has(type)) return f.feesTaxesCredits;
  if (type && TRADE_TYPES.has(type)) return f.trades;
  return true;
}
