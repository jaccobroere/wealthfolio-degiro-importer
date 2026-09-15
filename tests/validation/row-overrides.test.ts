import { describe, expect, it } from 'vitest';
import { parseAndMap } from '../../src/parser/parse-and-map';
import { SOURCE_EDITED_WARNING } from '../../src/validation/validate-batch';
import type { RowOverrides } from '../../src/domain/row-override';

/** Row 1 = a clean deposit, row 2 = a description nothing recognizes. */
const UNSUPPORTED_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,,,iDEAL storting,,EUR,"1000,00",EUR,"1000,00",
02-01-2026,11:00,02-01-2026,SYNTHETIC EQUITY,IE00UNK0001,Onbekende Actie Die Niemand Kent,,EUR,"-42,00",EUR,"958,00",
`;

/** A row whose amount is not a parseable Dutch decimal → structurally invalid. */
const INVALID_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,,,iDEAL storting,,EUR,"not-a-number",EUR,"1000,00",
`;

/** A grouped trade: the fee row shares the parent order id. */
const GROUP_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,"Koop 10 @ 50,00 EUR",,EUR,"-500,00",EUR,"500,00",ord-1
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"498,00",ord-1
`;

describe('buildBatch — reviewer overrides', () => {
  it('leaves the batch untouched when there are no overrides', () => {
    const { batch } = parseAndMap(UNSUPPORTED_CSV);
    expect(batch.summary.unsupportedCount).toBe(1);
    expect(batch.summary.skipReasons['user-ignored']).toBeUndefined();
  });

  it('turns an ignored row into an accounted user-ignored skip', () => {
    const overrides: RowOverrides = { 2: { kind: 'ignore' } };
    const { batch } = parseAndMap(UNSUPPORTED_CSV, overrides);

    expect(batch.summary.unsupportedCount).toBe(0);
    expect(batch.summary.skipReasons['user-ignored']).toBe(1);
    // Conservation still holds: the row is skipped, never dropped.
    expect(batch.summary.sourceRowCount).toBe(2);
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(batch.outcomes).toContainEqual({
      kind: 'known-skip',
      rowIndex: 2,
      reason: 'user-ignored',
    });
    // The untouched row still becomes its activity.
    expect(batch.summary.byActivityType.DEPOSIT).toBe(1);
  });

  it('re-classifies an edited row through the normal pipeline', () => {
    const overrides: RowOverrides = {
      2: { kind: 'edit', patch: { description: 'Dividend' } },
    };
    const { batch } = parseAndMap(UNSUPPORTED_CSV, overrides);

    expect(batch.summary.unsupportedCount).toBe(0);
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(batch.summary.byActivityType.DIVIDEND).toBe(1);

    const dividend = batch.activities.find((a) => a.activityType === 'DIVIDEND');
    expect(dividend?.isin).toBe('IE00UNK0001');
    // The edit stays auditable on the derived activity.
    expect(dividend?.warnings[SOURCE_EDITED_WARNING]).toBeDefined();
    expect(dividend?.isValid).toBe(true);
  });

  it('lets an edit rescue a structurally invalid row', () => {
    const before = parseAndMap(INVALID_CSV);
    expect(before.batch.summary.invalidCount).toBe(1);

    const overrides: RowOverrides = {
      1: { kind: 'edit', patch: { changeAmountRaw: '1000,00' } },
    };
    const { batch } = parseAndMap(INVALID_CSV, overrides);
    expect(batch.summary.invalidCount).toBe(0);
    expect(batch.summary.byActivityType.DEPOSIT).toBe(1);
    expect(batch.activities[0].amount).toBe('1000');
  });

  it('treats a patch that changes nothing as no edit at all', () => {
    const overrides: RowOverrides = {
      2: { kind: 'edit', patch: { description: 'Onbekende Actie Die Niemand Kent' } },
    };
    const { batch } = parseAndMap(UNSUPPORTED_CSV, overrides);
    // Still unsupported, and no activity is falsely flagged as edited.
    expect(batch.summary.unsupportedCount).toBe(1);
    for (const a of batch.activities) {
      expect(a.warnings[SOURCE_EDITED_WARNING]).toBeUndefined();
    }
  });

  it('flags the whole grouped activity when one member row is edited', () => {
    const overrides: RowOverrides = {
      2: { kind: 'edit', patch: { changeAmountRaw: '-3,00' } },
    };
    const { batch } = parseAndMap(GROUP_CSV, overrides);
    const buy = batch.activities.find((a) => a.activityType === 'BUY');
    expect(buy?.fee).toBe('3');
    expect(buy?.warnings[SOURCE_EDITED_WARNING]).toBeDefined();
  });

  it('re-routes the remaining group members when a trade row is ignored', () => {
    const overrides: RowOverrides = { 1: { kind: 'ignore' } };
    const { batch } = parseAndMap(GROUP_CSV, overrides);

    expect(batch.summary.byActivityType.BUY).toBeUndefined();
    expect(batch.summary.skipReasons['user-ignored']).toBe(1);
    // The orphaned fee is still accounted for, as a skip rather than a fee.
    expect(batch.summary.skipReasons['orphan-trade-fee']).toBe(1);
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(batch.summary.unsupportedCount).toBe(0);
  });

  it('keeps overrides idempotent: rebuilding from pristine rows never stacks edits', () => {
    const first = parseAndMap(UNSUPPORTED_CSV, {
      2: { kind: 'edit', patch: { description: 'Dividend' } },
    });
    // The parsed rows handed back are pristine, so re-running with a different
    // patch produces the same result as patching the original file.
    const second = parseAndMap(UNSUPPORTED_CSV, {
      2: { kind: 'edit', patch: { description: 'Flatex Interest' } },
    });

    expect(first.parsed.rows[1].description).toBe('Onbekende Actie Die Niemand Kent');
    expect(first.batch.summary.byActivityType.DIVIDEND).toBe(1);
    expect(second.batch.summary.byActivityType.INTEREST).toBe(1);
    expect(second.batch.summary.byActivityType.DIVIDEND).toBeUndefined();
  });
});
