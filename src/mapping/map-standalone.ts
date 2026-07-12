/**
 * Standalone row mapping: rows without an order id (or not belonging to a trade
 * group) mapped 1:1 to a single activity, or to a known-skip when allowed.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. Decimal strings everywhere.
 */

import { Decimal } from 'decimal.js';
import type { DegiroRow } from '../domain/degiro-row';
import {
  type ActivityDraft,
  cashSymbol,
} from '../domain/activity-draft';
import { changeAmount, classifyRow } from './classify-row';
import { toIsoDate } from '../parser/parse-date';
import type { SkipReason } from '../domain/skip-reason';

export type StandaloneResult =
  | { kind: 'activity'; activity: ActivityDraft }
  | { kind: 'known-skip'; reason: SkipReason }
  | { kind: 'unsupported' };

function rowComment(description: string, product: string): string {
  return [description, product].filter(Boolean).join(' ');
}

/**
 * Map a standalone row. Returns `unsupported` for classification kinds that
 * should never reach standalone (BUY/SELL/TRADE_FEE/ACCRUED_INTEREST/FX), so the
 * orchestrator can surface a structural problem.
 */
export function mapStandalone(row: DegiroRow): StandaloneResult {
  const kind = classifyRow(row).kind;
  const raw = changeAmount(row) ?? new Decimal(0);
  const absAmt = raw.abs();
  const currency = row.changeCurrency || 'EUR';
  const date = toIsoDate(row.date, row.time);

  // Zero-amount rows: declared activity kinds with no economic effect.
  if (
    (kind === 'INTEREST' ||
      kind === 'DIVIDEND' ||
      kind === 'TAX' ||
      kind === 'DEPOSIT' ||
      kind === 'WITHDRAWAL' ||
      kind === 'FEE') &&
    absAmt.isZero()
  ) {
    return { kind: 'known-skip', reason: 'zero-amount' };
  }

  switch (kind) {
    case 'DEPOSIT':
      return {
        kind: 'activity',
        activity: {
          date,
          symbol: cashSymbol(currency),
          quantity: '1',
          activityType: 'DEPOSIT',
          unitPrice: absAmt.toString(),
          currency,
          fee: '0',
          amount: absAmt.toString(),
          comment: rowComment(row.description, row.product),
          sourceRowNumbers: [row.rowIndex],
          isValid: true,
          errors: {},
          warnings: {},
        },
      };

    case 'WITHDRAWAL':
      return {
        kind: 'activity',
        activity: {
          date,
          symbol: cashSymbol(currency),
          quantity: '1',
          activityType: 'WITHDRAWAL',
          unitPrice: absAmt.toString(),
          currency,
          fee: '0',
          amount: absAmt.toString(),
          comment: rowComment(row.description, row.product),
          sourceRowNumbers: [row.rowIndex],
          isValid: true,
          errors: {},
          warnings: {},
        },
      };

    case 'DIVIDEND': {
      const symbol = row.isin || row.product;
      if (!symbol) return { kind: 'unsupported' };
      return {
        kind: 'activity',
        activity: {
          date,
          ...(row.isin ? { isin: row.isin } : {}),
          symbol,
          ...(row.product ? { symbolName: row.product } : {}),
          quantity: '1',
          activityType: 'DIVIDEND',
          unitPrice: absAmt.toString(),
          currency,
          fee: '0',
          amount: absAmt.toString(),
          comment: rowComment(row.description, row.product),
          sourceRowNumbers: [row.rowIndex],
          isValid: !!row.isin,
          errors: row.isin ? {} : { symbol: ['No ISIN — set symbol manually'] },
          warnings: {},
        },
      };
    }

    case 'INTEREST':
      return {
        kind: 'activity',
        activity: {
          date,
          symbol: cashSymbol(currency),
          quantity: '1',
          activityType: 'INTEREST',
          unitPrice: absAmt.toString(),
          currency,
          fee: '0',
          amount: absAmt.toString(),
          comment: rowComment(row.description, row.product),
          sourceRowNumbers: [row.rowIndex],
          isValid: true,
          errors: {},
          warnings: raw.isNegative()
            ? { amount: ['Negative interest — DEGIRO charged you'] }
            : {},
        },
      };

    case 'FEE':
      return {
        kind: 'activity',
        activity: {
          date,
          symbol: cashSymbol(currency),
          quantity: '1',
          activityType: 'FEE',
          unitPrice: absAmt.toString(),
          currency,
          fee: '0',
          amount: absAmt.toString(),
          comment: rowComment(row.description, row.product),
          sourceRowNumbers: [row.rowIndex],
          isValid: true,
          errors: {},
          warnings: {},
        },
      };

    case 'TAX':
      // Only import paid (negative) tax; positive = reversal, already classified.
      if (!raw.isNegative()) return { kind: 'known-skip', reason: 'positive-reversal' };
      return {
        kind: 'activity',
        activity: {
          date,
          ...(row.isin ? { isin: row.isin } : {}),
          symbol: row.isin || row.product || cashSymbol(currency),
          ...(row.product ? { symbolName: row.product } : {}),
          quantity: '1',
          activityType: 'TAX',
          unitPrice: absAmt.toString(),
          currency,
          fee: '0',
          amount: absAmt.toString(),
          comment: row.description,
          sourceRowNumbers: [row.rowIndex],
          isValid: true,
          errors: {},
          warnings: {},
        },
      };

    default:
      // BUY/SELL/TRADE_FEE/ACCRUED_INTEREST/FX without an order id, or UNKNOWN.
      return { kind: 'unsupported' };
  }
}
