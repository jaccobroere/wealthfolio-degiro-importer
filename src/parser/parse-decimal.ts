/**
 * Dutch-locale decimal parser for DEGIRO statement values.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * DEGIRO locale: `.` = thousands separator, `,` = decimal mark.
 *   "1.234"     → 1234        (localized thousands separator)
 *   "2.506"     → 2506
 *   "6.408"     → 6408
 *   "1.750"     → 1750
 *   "119,285"   → 119.285
 *   "1.234,56"  → 1234.56
 *   "1,0920"    → 1.0920      (FX rate)
 *
 * All money arithmetic in this core uses the returned `Decimal`; we never hand
 * floating-point to financial code.
 */

import { Decimal } from 'decimal.js';

export class DegiroDecimalError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'DegiroDecimalError';
  }
}

/**
 * Parse a Dutch-locale decimal string into a `Decimal`. Throws
 * `DegiroDecimalError` on malformed or ambiguous input.
 */
export function parseDegiroDecimal(raw: string): Decimal {
  const s = raw.trim();
  if (s === '') throw new DegiroDecimalError('empty decimal', raw);

  if (!/^-?[\d.,]+$/.test(s)) {
    throw new DegiroDecimalError('unexpected characters', raw);
  }

  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  if (body === '') throw new DegiroDecimalError('sign only', raw);

  const hasDot = body.includes('.');
  const hasComma = body.includes(',');

  let intPart: string;
  let fracPart: string | undefined;

  if (hasDot && hasComma) {
    // Dutch: '.' thousands, ',' decimal → comma must be the last separator.
    const lastDot = body.lastIndexOf('.');
    const lastComma = body.lastIndexOf(',');
    if (lastComma < lastDot) {
      throw new DegiroDecimalError('ambiguous mixed separators', raw);
    }
    // Validate thousands grouping: every '.' must sit between digit groups of 3.
    validateThousands(body, '.', lastComma, raw);
    const cleaned = body.replace(/\./g, '').replace(',', '.');
    const dot = cleaned.indexOf('.');
    intPart = dot === -1 ? cleaned : cleaned.slice(0, dot);
    fracPart = dot === -1 ? undefined : cleaned.slice(dot + 1);
  } else if (hasComma) {
    // Single comma = decimal mark in Dutch locale.
    const parts = body.split(',');
    if (parts.length !== 2) {
      throw new DegiroDecimalError('multiple decimal commas', raw);
    }
    intPart = parts[0];
    fracPart = parts[1];
  } else if (hasDot) {
    // '.' is a thousands separator (Dutch). Strip every dot.
    validateThousands(body, '.', body.length, raw);
    intPart = body.replace(/\./g, '');
    fracPart = undefined;
  } else {
    intPart = body;
    fracPart = undefined;
  }

  if (intPart !== '' && !/^\d+$/.test(intPart)) {
    throw new DegiroDecimalError('non-digit integer part', raw);
  }
  if (fracPart !== undefined && !/^\d+$/.test(fracPart)) {
    throw new DegiroDecimalError('non-digit fraction part', raw);
  }

  const canonical =
    (neg ? '-' : '') +
    (intPart === '' ? '0' : intPart) +
    (fracPart !== undefined ? `.${fracPart}` : '');
  return new Decimal(canonical);
}

/**
 * Validate that every occurrence of `sep` (a thousands separator) sits between
 * digit groups of exactly three. `upTo` is the index before which separators
 * are thousands (the decimal mark position, or end of string).
 */
function validateThousands(body: string, sep: string, upTo: number, raw: string): void {
  // Walk integer portion left-to-right in groups of 3 separated by `sep`.
  const integer = body.slice(0, upTo);
  if (integer === '') return;
  // Allow a leading group of 1-3 digits, then groups of exactly 3.
  const ok = /^(?:\d{1,3})(?:\u0020?\d{3})*$/.test(integer.split(sep).join(''));
  // The join approach above is loose; re-check per-group strictly instead.
  const groups = integer.split(sep);
  if (
    !ok ||
    groups.some(
      (g, i) => (i === 0 ? g.length < 1 || g.length > 3 : g.length !== 3) || !/^\d+$/.test(g),
    )
  ) {
    throw new DegiroDecimalError('invalid thousands grouping', raw);
  }
}

/** Parse to a Decimal, returning `null` (not throwing) on empty/malformed. */
export function tryParseDegiroDecimal(raw: string): Decimal | null {
  if (raw.trim() === '') return null;
  try {
    return parseDegiroDecimal(raw);
  } catch {
    return null;
  }
}

/** Format a Decimal back to a plain decimal string (no trailing zeros stripped aggressively). */
export function decimalToString(d: Decimal): string {
  return d.toString();
}
