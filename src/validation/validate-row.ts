/**
 * Per-row structural validation for parsed DEGIRO rows.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. Returns a list of human-
 * readable error strings; an empty list means the row is structurally valid.
 * Privacy: errors never echo raw monetary values or products.
 */

import type { DegiroRow } from '../domain/degiro-row';
import { tryParseDegiroDecimal } from '../parser/parse-decimal';

const DATE_RE = /^\d{1,2}-\d{1,2}-\d{4}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

/** Validate a single parsed row. Returns error strings (empty = valid). */
export function validateRow(row: DegiroRow): string[] {
  const errors: string[] = [];

  if (!DATE_RE.test(row.date)) {
    errors.push('date is not DD-MM-YYYY');
  }
  if (!TIME_RE.test(row.time)) {
    errors.push('time is not HH:MM');
  }
  // Change amount: must be empty or a parseable Dutch decimal.
  if (row.changeAmountRaw.trim() !== '') {
    if (tryParseDegiroDecimal(row.changeAmountRaw) === null) {
      errors.push('change amount is not a valid Dutch decimal');
    }
  }
  // Balance amount: must be empty or a parseable Dutch decimal.
  if (row.balanceAmountRaw.trim() !== '') {
    if (tryParseDegiroDecimal(row.balanceAmountRaw) === null) {
      errors.push('balance amount is not a valid Dutch decimal');
    }
  }
  // FX: must be empty or a parseable Dutch decimal.
  if (row.fxRaw.trim() !== '') {
    if (tryParseDegiroDecimal(row.fxRaw) === null) {
      errors.push('FX rate is not a valid Dutch decimal');
    }
  }

  return errors;
}
