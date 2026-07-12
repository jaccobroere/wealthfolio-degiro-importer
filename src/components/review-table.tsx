/**
 * Review table (T07, step 3 sub-component).
 *
 * Renders the categorized review rows. Shows source row number/type +
 * normalized values only. Does NOT render raw balances or order IDs by
 * default. Privacy-safe.
 */
import type { ReactElement } from 'react';
import { Badge } from '@wealthfolio/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@wealthfolio/ui';
import type { ReviewRow, ReviewFilters } from '../state/import-state';
import type { ReviewCategory } from '../state/import-state';

export interface ReviewTableProps {
  rows: ReviewRow[];
  filters: ReviewFilters;
}

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

export function ReviewTable({ rows, filters }: ReviewTableProps): ReactElement {
  const filtered = rows.filter((r) => matchesFilters(r, filters));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Showing {filtered.length} of {rows.length} rows
      </p>
      <div className="border border-border rounded-md overflow-auto max-h-[28rem]">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
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
                <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                  No rows match the active filters
                </TableCell>
              </TableRow>
            ) : null}
            {filtered.map((r, i) => (
              <TableRow
                key={`${r.sourceRowNumbers.join(',')}-${i}`}
                data-testid={`review-row-${i}`}
              >
                <TableCell className="font-mono text-xs">{r.sourceRowNumbers.join(',')}</TableCell>
                <TableCell>
                  <Badge
                    variant={CATEGORY_VARIANT[r.category]}
                    data-testid={`review-category-${i}`}
                  >
                    {CATEGORY_LABEL[r.category]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{r.activityType ?? '—'}</TableCell>
                <TableCell className="text-sm font-mono">
                  {r.symbol ?? '—'}
                  {r.unresolvedSymbol ? <span className="text-destructive ml-1">⚠</span> : null}
                  {r.hasAccruedInterest ? (
                    <span className="text-warning ml-1" title="Carries accrued interest (T09-gate)">
                      ⏳
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">{r.date ? r.date.slice(0, 10) : '—'}</TableCell>
                <TableCell className="text-sm text-right font-mono">{r.quantity ?? '—'}</TableCell>
                <TableCell className="text-sm text-right font-mono">{r.amount ?? '—'}</TableCell>
                <TableCell className="text-sm">{r.currency ?? '—'}</TableCell>
              </TableRow>
            ))}
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
