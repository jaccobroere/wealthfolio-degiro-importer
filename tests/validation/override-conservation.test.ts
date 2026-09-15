/**
 * Regressions for the two ways reviewer overrides could previously corrupt or
 * break a batch, both found in review of the in-place row-fix feature.
 */
import { describe, expect, it } from 'vitest';
import { parseAndMap } from '../../src/parser/parse-and-map';
import {
  GROUP_ROW_CHANGED_WARNING,
  SOURCE_EDITED_WARNING,
} from '../../src/validation/validate-batch';
import type { RowOverrides } from '../../src/domain/row-override';

/** Two partial fills + a fee, all under one order id. */
const PARTIAL_FILLS_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,"Koop 10 @ 50,00 EUR",,EUR,"-500,00",EUR,"500,00",ord-1
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,"Koop 10 @ 50,00 EUR",,EUR,"-500,00",EUR,"0,00",ord-1
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"-2,00",ord-1
`;

/** A bond buy with accrued interest under one order id. */
const ACCRUED_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC BOND,IE00BND0001,"Koop 10 @ 100,00 EUR",,EUR,"-1.000,00",EUR,"1.000,00",ord-b
02-01-2026,10:00,02-01-2026,SYNTHETIC BOND,IE00BND0001,Meegekochte Rente,,EUR,"-1,23",EUR,"998,77",ord-b
`;

describe('ignoring a row inside an order group', () => {
  it('still builds the trade, but flags that the order is now incomplete', () => {
    const before = parseAndMap(PARTIAL_FILLS_CSV);
    const beforeBuy = before.batch.activities.find((a) => a.activityType === 'BUY');
    expect(beforeBuy?.quantity).toBe('20');
    expect(beforeBuy?.amount).toBe('1000');

    // Ignore the second fill.
    const overrides: RowOverrides = { 2: { kind: 'ignore' } };
    const { batch } = parseAndMap(PARTIAL_FILLS_CSV, overrides);
    const buy = batch.activities.find((a) => a.activityType === 'BUY');

    // The economics legitimately change…
    expect(buy?.quantity).toBe('10');
    expect(buy?.amount).toBe('500');
    // …but the reviewer must be told, or a half-filled trade looks clean. The
    // ignored row is not in this activity's sourceRowNumbers, so nothing else
    // in the pipeline can surface the change.
    expect(buy?.warnings[GROUP_ROW_CHANGED_WARNING]).toBeDefined();
    expect(buy?.sourceRowNumbers).not.toContain(2);
  });

  it('flags the trade when its fee row is the one ignored', () => {
    const { batch } = parseAndMap(PARTIAL_FILLS_CSV, { 3: { kind: 'ignore' } });
    const buy = batch.activities.find((a) => a.activityType === 'BUY');
    expect(buy?.fee).toBe('0');
    expect(buy?.warnings[GROUP_ROW_CHANGED_WARNING]).toBeDefined();
  });

  it('leaves unrelated activities unflagged', () => {
    const { batch } = parseAndMap(PARTIAL_FILLS_CSV, { 2: { kind: 'ignore' } });
    for (const a of batch.activities) {
      if (a.group?.orderId === 'ord-1') continue;
      expect(a.warnings[GROUP_ROW_CHANGED_WARNING]).toBeUndefined();
    }
  });

  it('flags the trade when an edit moves a fill out of the group entirely', () => {
    // Reclassifying a fill leaves the group, exactly like ignoring it would:
    // the BUY silently loses half its quantity. The edited row is no longer in
    // the activity's sourceRowNumbers, so the edit warning alone cannot see it.
    const { batch } = parseAndMap(PARTIAL_FILLS_CSV, {
      2: { kind: 'edit', patch: { description: 'Dividend' } },
    });
    const buy = batch.activities.find((a) => a.activityType === 'BUY');
    expect(buy?.quantity).toBe('10');
    expect(buy?.sourceRowNumbers).not.toContain(2);
    expect(buy?.warnings[GROUP_ROW_CHANGED_WARNING]).toBeDefined();
  });

  it('flags the trade when an edited FX row shifts its converted fee', () => {
    // An FX row is never listed in the trade's sourceRowNumbers, so editing one
    // changes the fee without the edit warning ever reaching the activity.
    const usdCsv = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,US0000000001,"Koop 10 @ 50,00 USD",,USD,"-500,00",USD,"0,00",ord-fx
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,US0000000001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"0,00",ord-fx
02-01-2026,10:00,02-01-2026,,,Valuta Debitering,"1,1000",USD,"-500,00",USD,"0,00",ord-fx
`;
    const before = parseAndMap(usdCsv).batch.activities.find((a) => a.activityType === 'BUY');
    const { batch } = parseAndMap(usdCsv, {
      3: { kind: 'edit', patch: { fxRaw: '1,5000' } },
    });
    const buy = batch.activities.find((a) => a.activityType === 'BUY');
    expect(buy?.fee).not.toBe(before?.fee);
    expect(buy?.sourceRowNumbers).not.toContain(3);
    expect(buy?.warnings[GROUP_ROW_CHANGED_WARNING]).toBeDefined();
  });

  it('still records an ordinary in-group edit as an edit', () => {
    const { batch } = parseAndMap(PARTIAL_FILLS_CSV, {
      2: { kind: 'edit', patch: { changeAmountRaw: '-400,00' } },
    });
    const buy = batch.activities.find((a) => a.activityType === 'BUY');
    expect(buy?.warnings[SOURCE_EDITED_WARNING]).toBeDefined();
    // The row stayed in the group, but the group's economics still moved.
    expect(buy?.warnings[GROUP_ROW_CHANGED_WARNING]).toBeDefined();
  });
});

describe('row conservation survives every override', () => {
  it('accounts for an accrued-interest row orphaned by ignoring its trade', () => {
    const { batch } = parseAndMap(ACCRUED_CSV, { 1: { kind: 'ignore' } });
    // The accrued row has no parent trade left. It must still get an outcome,
    // or it disappears from the review table with no way for the user to act.
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(batch.outcomes).toHaveLength(2);
    expect(batch.outcomes.find((o) => o.rowIndex === 2)?.kind).toBe('known-skip');
  });

  it('accounts for every row of a group whose fills are edited down to zero', () => {
    const { batch } = parseAndMap(PARTIAL_FILLS_CSV, {
      1: { kind: 'edit', patch: { description: 'Koop 0 @ 0,00 EUR' } },
      2: { kind: 'edit', patch: { description: 'Koop 0 @ 0,00 EUR' } },
    });
    expect(batch.summary.unaccountedCount).toBe(0);
    // The fee row must not vanish along with the trade rows.
    expect(batch.outcomes).toHaveLength(3);
    for (const rowIndex of [1, 2, 3]) {
      expect(batch.outcomes.some((o) => o.rowIndex === rowIndex)).toBe(true);
    }
  });

  it('accounts for a positive in-group tax row that yields no activity', () => {
    const csv = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,"Koop 10 @ 50,00 EUR",,EUR,"-500,00",EUR,"500,00",ord-1
02-01-2026,10:00,02-01-2026,SYNTHETIC EQUITY,IE00GRP0001,Transactiebelasting,,EUR,"0,30",EUR,"500,30",ord-1
`;
    const { batch } = parseAndMap(csv);
    // Pre-existing hole: a reversal FTT row built no activity and got no skip.
    expect(batch.summary.unaccountedCount).toBe(0);
    expect(batch.outcomes.find((o) => o.rowIndex === 2)?.kind).toBe('known-skip');
  });

  it('keeps every source row accounted for across a sweep of single-row ignores', () => {
    const rowCount = parseAndMap(PARTIAL_FILLS_CSV).batch.summary.sourceRowCount;
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex++) {
      const { batch } = parseAndMap(PARTIAL_FILLS_CSV, { [rowIndex]: { kind: 'ignore' } });
      expect(batch.summary.unaccountedCount, `ignoring row ${rowIndex}`).toBe(0);
      expect(batch.summary.sourceRowCount).toBe(rowCount);
    }
  });
});
