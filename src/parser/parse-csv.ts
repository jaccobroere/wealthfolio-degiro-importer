/**
 * DEGIRO account-statement CSV parser.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`. Uses `papaparse` for
 * standards-compliant quoting/delimiter mechanics, then validates the strict
 * 12-column physical layout and the Dutch/English header aliases before mapping
 * fields positionally (the export has duplicate/unlabelled headers, so header
 * indexing is unreliable).
 */

import Papa from 'papaparse';
import {
  DegiroRow,
  FIELD_COUNT,
  HEADER_ALIASES,
} from '../domain/degiro-row';

export class DegiroCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DegiroCsvError';
  }
}

export interface ParsedCsv {
  rows: DegiroRow[];
  /** The detected header variant ('dutch' | 'english'). */
  headerVariant: 'dutch' | 'english';
  /** Structural per-line errors (1-based source line numbers). */
  structuralErrors: StructuralError[];
}

export interface StructuralError {
  lineNumber: number;
  fieldCount: number;
  reason: string;
}

/** Tolerant field accessor for a raw CSV record (may be short). */
function cell(fields: string[], i: number): string {
  return (fields[i] ?? '').trim();
}

/**
 * Parse DEGIRO account-statement CSV text into typed rows. Throws
 * `DegiroCsvError` if the header is missing or unrecognized. Short/malformed
 * data lines are returned as `structuralErrors` rather than thrown, so the batch
 * can account for them as `invalid` outcomes.
 */
export function parseDegiroCsv(content: string): ParsedCsv {
  const parsed = Papa.parse<string[]>(content.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
  });
  const data = parsed.data;

  if (data.length === 0) {
    throw new DegiroCsvError('empty CSV: no header row');
  }

  const header = data[0].map((h) => h.trim());
  const headerVariant = detectHeaderVariant(header);
  if (!headerVariant) {
    throw new DegiroCsvError(
      `unrecognized DEGIRO header (got ${header.length} columns). Expected the 12-column Dutch or English account-statement header.`,
    );
  }

  const rows: DegiroRow[] = [];
  const structuralErrors: StructuralError[] = [];

  // Data rows start at line 2 (header is line 1). `rowIndex` is 1-based among
  // data rows so it is stable and privacy-safe for provenance/fingerprints.
  for (let i = 1; i < data.length; i++) {
    const fields = data[i];
    const lineNumber = i + 1;
    if (!Array.isArray(fields)) {
      structuralErrors.push({ lineNumber, fieldCount: 0, reason: 'non-array record' });
      continue;
    }
    // Skip fully-blank lines (papaparse `greedy` should already, but be safe).
    if (fields.every((f) => (f ?? '').trim() === '')) continue;

    if (fields.length < FIELD_COUNT) {
      structuralErrors.push({
        lineNumber,
        fieldCount: fields.length,
        reason: `expected ${FIELD_COUNT} fields, got ${fields.length}`,
      });
      continue;
    }

    const rowIndex = rows.length + 1;
    rows.push({
      rowIndex,
      date: cell(fields, 0),
      time: cell(fields, 1),
      valueDate: cell(fields, 2),
      product: cell(fields, 3),
      isin: cell(fields, 4),
      description: cell(fields, 5),
      fxRaw: cell(fields, 6),
      changeCurrency: cell(fields, 7),
      changeAmountRaw: fields[8] ?? '',
      balanceCurrency: cell(fields, 9),
      balanceAmountRaw: fields[10] ?? '',
      orderId: cell(fields, 11),
    });
  }

  return { rows, headerVariant, structuralErrors };
}

/**
 * Detect whether the header row matches the Dutch or English 12-column layout.
 * Returns `null` if it matches neither (which would block the import). Mapping
 * is positional, so the variant only needs to be recognized, not distinguished
 * precisely — but we return it for diagnostics.
 */
export function detectHeaderVariant(header: string[]): 'dutch' | 'english' | null {
  if (header.length < FIELD_COUNT) return null;
  const norm = header.map((h) => h.trim().toLowerCase());

  // Every labelled position must match one of its aliases.
  for (let i = 0; i < FIELD_COUNT; i++) {
    const aliases = HEADER_ALIASES[i];
    if (aliases.length === 0) continue; // unlabelled amount column
    if (!aliases.includes(norm[i])) return null;
  }

  return norm[5] === 'omschrijving' ? 'dutch' : 'english';
}
