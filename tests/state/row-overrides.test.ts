import { describe, expect, it } from 'vitest';
import {
  buildReviewRows,
  computeImportGate,
  computeUploadSummary,
  countOverrides,
  importReducer,
  initialImportState,
  type ImportState,
} from '../../src/state/import-state';
import { parseAndMapWithFingerprints, rebuildWithOverrides } from '../../src/parser/parse-and-map';

const UNSUPPORTED_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,,,iDEAL storting,,EUR,"1000,00",EUR,"1000,00",
02-01-2026,11:00,02-01-2026,SYNTHETIC EQUITY,IE00UNK0001,Onbekende Actie Die Niemand Kent,,EUR,"-42,00",EUR,"958,00",
`;

async function uploadedState(csv = UNSUPPORTED_CSV): Promise<ImportState> {
  const pipeline = await parseAndMapWithFingerprints(csv);
  let state = importReducer(initialImportState(), {
    type: 'UPLOAD_SUCCESS',
    pipeline,
    summary: computeUploadSummary(pipeline),
  });
  state = importReducer(state, { type: 'SELECT_ACCOUNT', accountId: 'acct-1' });
  return state;
}

/** Apply the page's rebuild effect: recompute from pristine rows + overrides. */
async function rebuild(state: ImportState): Promise<ImportState> {
  const pipeline = await rebuildWithOverrides(state.pipeline!.parsed, state.overrides);
  return importReducer(state, { type: 'PIPELINE_REBUILT', pipeline });
}

describe('import state — reviewer overrides', () => {
  it('starts pristine so the page does not rebuild on upload', async () => {
    const state = await uploadedState();
    expect(state.overrides).toEqual({});
    expect(state.overridesVersion).toBe(0);
  });

  it('records a decision, bumps the version, and revokes the acknowledgement', async () => {
    let state = await uploadedState();
    state = importReducer(state, { type: 'SET_ACKNOWLEDGED', acknowledged: true });
    expect(state.acknowledged).toBe(true);

    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });

    expect(state.overrides[2]).toEqual({ kind: 'ignore' });
    expect(state.overridesVersion).toBe(1);
    // Changing the data must invalidate what the user already acknowledged.
    expect(state.acknowledged).toBe(false);
  });

  it('clears one decision with a null override', async () => {
    let state = await uploadedState();
    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });
    state = importReducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: null });

    expect(state.overrides).toEqual({});
    expect(state.overridesVersion).toBe(2);
  });

  it('clears every decision at once, and is a no-op when there are none', async () => {
    let state = await uploadedState();
    const pristine = importReducer(state, { type: 'CLEAR_ROW_OVERRIDES' });
    expect(pristine).toBe(state);

    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'edit', patch: { description: 'Dividend' } },
    });
    state = importReducer(state, { type: 'CLEAR_ROW_OVERRIDES' });
    expect(state.overrides).toEqual({});
    expect(state.overridesVersion).toBe(2);
  });

  it('unblocks the import gate once the blocking row is ignored', async () => {
    let state = await uploadedState();
    expect(computeImportGate(state).blockers).toContain('1 unsupported row(s) require review');

    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });
    state = await rebuild(state);
    state = importReducer(state, { type: 'SET_ACKNOWLEDGED', acknowledged: true });

    expect(computeImportGate(state).blockers).toEqual([]);
    expect(computeImportGate(state).enabled).toBe(true);
  });

  it('refreshes the upload summary after a rebuild', async () => {
    let state = await uploadedState();
    expect(state.uploadSummary?.activityCount).toBe(1);

    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'edit', patch: { description: 'Dividend' } },
    });
    state = await rebuild(state);

    expect(state.uploadSummary?.activityCount).toBe(2);
    expect(state.uploadSummary?.byActivityType.DIVIDEND).toBe(1);
  });

  it('picks up a security introduced by an edit so it still needs resolution', async () => {
    let state = await uploadedState();
    expect(state.instrumentSymbols).toEqual([]);

    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'edit', patch: { description: 'Dividend' } },
    });
    state = await rebuild(state);

    expect(state.instrumentSymbols).toEqual(['IE00UNK0001']);
    expect(computeImportGate(state).blockers).toContain('1 unresolved security symbol(s)');
  });

  it('keeps the instrumentSymbols identity stable when the set does not change', async () => {
    let state = await uploadedState();
    const before = state.instrumentSymbols;

    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });
    state = await rebuild(state);

    // The page's mapping effect depends on this array; a new identity would
    // refetch the duplicate index and saved mappings on every edit.
    expect(state.instrumentSymbols).toBe(before);
  });

  it('labels review rows with the decision covering them', async () => {
    let state = await uploadedState();
    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });
    state = await rebuild(state);

    const rows = buildReviewRows(state);
    const ignored = rows.find((r) => r.sourceRowNumbers[0] === 2);
    expect(ignored?.overrideKind).toBe('ignore');
    expect(ignored?.category).toBe('known-skip');
    expect(ignored?.skipReason).toBe('user-ignored');

    const untouched = rows.find((r) => r.sourceRowNumbers[0] === 1);
    expect(untouched?.overrideKind).toBeUndefined();
  });

  it('marks an activity built from an edited row', async () => {
    let state = await uploadedState();
    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'edit', patch: { description: 'Dividend' } },
    });
    state = await rebuild(state);

    const row = buildReviewRows(state).find((r) => r.sourceRowNumbers[0] === 2);
    expect(row?.overrideKind).toBe('edit');
    expect(row?.activityType).toBe('DIVIDEND');
    expect(row?.hasWarnings).toBe(true);
  });

  it('counts decisions by kind for the reconcile-step audit', () => {
    expect(
      countOverrides({
        2: { kind: 'ignore' },
        5: { kind: 'edit', patch: { description: 'x' } },
        9: { kind: 'ignore' },
      }),
    ).toEqual({ ignored: 2, edited: 1 });
    expect(countOverrides({})).toEqual({ ignored: 0, edited: 0 });
  });

  it('blocks import while the recorded decisions and the pipeline have diverged', async () => {
    let state = await uploadedState();
    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });
    state = importReducer(state, { type: 'REBUILD_FAILED', message: 'crypto unavailable' });
    state = importReducer(state, { type: 'SET_ACKNOWLEDGED', acknowledged: true });

    // The UI would otherwise show "1 row changed by you" while the pipeline
    // still holds the pre-edit data, and the user would import the originals.
    expect(computeImportGate(state).blockers).toContain(
      'Re-check the rows you changed; recalculating them failed',
    );
    expect(computeImportGate(state).enabled).toBe(false);

    // A later successful rebuild clears it.
    state = await rebuild(state);
    expect(state.rebuildError).toBeNull();
  });

  it('drops decisions when a new file is uploaded', async () => {
    let state = await uploadedState();
    state = importReducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });

    const pipeline = await parseAndMapWithFingerprints(UNSUPPORTED_CSV);
    state = importReducer(state, {
      type: 'UPLOAD_SUCCESS',
      pipeline,
      summary: computeUploadSummary(pipeline),
    });

    expect(state.overrides).toEqual({});
    expect(state.overridesVersion).toBe(0);
  });
});
