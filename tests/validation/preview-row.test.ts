import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { previewRowOutcome } from '../../src/validation/preview-row';
import { parseAndMap } from '../../src/parser/parse-and-map';
import { parseDegiroCsv } from '../../src/parser/parse-csv';

const FIXTURES = join(__dirname, '..', 'fixtures');

function rowsOf(csv: string) {
  return parseDegiroCsv(csv).rows;
}

/** A lone fee row carrying an order id no trade shares. */
const ORPHAN_FEE_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"-2,00",ord-z
`;

/** An ungrouped trade whose quantity is zero. */
const ZERO_QTY_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,"Koop 0 @ 0,00 EUR",,EUR,"0,00",EUR,"0,00",
`;

/** Two fills + a fee under one order id. */
const GROUP_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,"Koop 10 @ 50,00 EUR",,EUR,"-500,00",EUR,"500,00",ord-1
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,"Koop 10 @ 50,00 EUR",,EUR,"-500,00",EUR,"0,00",ord-1
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"-2,00",ord-1
`;

const UNKNOWN_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,,,iDEAL storting,,EUR,"1000,00",EUR,"1000,00",
02-01-2026,11:00,02-01-2026,SYNTHETIC EQUITY,IE00UNK0001,Onbekende Actie Die Niemand Kent,,EUR,"-42,00",EUR,"958,00",
`;

describe('previewRowOutcome', () => {
  it('tells the truth about rows whose fate depends on their siblings', () => {
    // A fee row with an order id LOOKS grouped, but nothing shares its order,
    // so it is skipped. Predicting from the row alone says "merged into its
    // order group" and the reviewer imports nothing.
    expect(previewRowOutcome(rowsOf(ORPHAN_FEE_CSV), {}, 1, null).tone).toBe('skip');
    // A trade whose quantity is zero yields no activity at all.
    expect(previewRowOutcome(rowsOf(ZERO_QTY_CSV), {}, 1, null).tone).toBe('skip');
  });

  it('reports a real grouped leg as merged', () => {
    const preview = previewRowOutcome(rowsOf(GROUP_CSV), {}, 3, null);
    expect(preview.tone).toBe('ok');
    expect(preview.text).toMatch(/merged into/);
  });

  it('previews a candidate decision without applying it', () => {
    const rows = rowsOf(UNKNOWN_CSV);
    expect(previewRowOutcome(rows, {}, 2, null).tone).toBe('bad');

    const edited = previewRowOutcome(rows, {}, 2, {
      kind: 'edit',
      patch: { description: 'Dividend' },
    });
    expect(edited.tone).toBe('ok');
    expect(edited.text).toMatch(/DIVIDEND/);

    expect(previewRowOutcome(rows, {}, 2, { kind: 'ignore' }).text).toMatch(/Excluded by you/);
    // The rows themselves are untouched by previewing.
    expect(rows[1].description).toBe('Onbekende Actie Die Niemand Kent');
  });

  it('accounts for the reviewer’s other active decisions', () => {
    // With the second fill ignored, the fee row still merges — but into a trade
    // built from one fill. The preview must reflect the batch as it will be.
    const rows = rowsOf(GROUP_CSV);
    const preview = previewRowOutcome(rows, { 2: { kind: 'ignore' } }, 3, null);
    expect(preview.tone).toBe('ok');
    expect(preview.text).toMatch(/merged into/);
  });

  it('a candidate edit that cannot be mapped is reported as still blocking', () => {
    // DIVIDEND with no ISIN and no product cannot produce a symbol.
    const csv = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,,,Onbekend,,EUR,"10,00",EUR,"10,00",
`;
    const preview = previewRowOutcome(rowsOf(csv), {}, 1, {
      kind: 'edit',
      patch: { description: 'Dividend' },
    });
    expect(preview.tone).toBe('bad');
  });

  /**
   * The preview reads the pipeline's own outcome rather than re-deriving the
   * routing, so it cannot drift. This pins that property: for every row of
   * every fixture, the previewed outcome must equal the real one.
   */
  it('matches the real pipeline for every row of every fixture', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.csv'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(join(FIXTURES, file), 'utf-8');
      const { parsed, batch } = parseAndMap(content);
      const actual = new Map(batch.outcomes.map((o) => [o.rowIndex, o.kind]));

      for (const r of parsed.rows) {
        const preview = previewRowOutcome(parsed.rows, {}, r.rowIndex, null);
        const real = actual.get(r.rowIndex);
        const expectedTone =
          real === 'invalid' || real === 'unsupported'
            ? 'bad'
            : real === 'known-skip'
              ? 'skip'
              : 'ok';
        expect(preview.tone, `${file} row ${r.rowIndex} (${real}): "${preview.text}"`).toBe(
          expectedTone,
        );
      }
    }
  });
});
