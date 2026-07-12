/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import {
  ACCRUED_INTEREST_CSV,
  EXAMPLE_CSV,
  UNSUPPORTED_CSV,
  buildState,
  cleanupUi,
  renderReconciliation,
} from './helpers';

describe('DEGIRO reconciliation gate', () => {
  afterEach(() => {
    cleanupUi();
  });

  it('keeps Import disabled with no account selected', async () => {
    const state = await buildState({ accountId: null, acknowledged: true });
    renderReconciliation(state);

    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No destination account selected')).toBeTruthy();
  });

  it('keeps Import disabled when fatal or unknown rows are present', async () => {
    const state = await buildState({ csv: UNSUPPORTED_CSV, acknowledged: true });
    renderReconciliation(state);

    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/unsupported row\(s\) require review/i)).toBeTruthy();
  });

  it('keeps Import disabled when traded securities remain unresolved', async () => {
    const state = await buildState({
      csv: EXAMPLE_CSV,
      acknowledged: true,
      resolvedSymbols: false,
    });
    renderReconciliation(state);

    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('2 unresolved security symbol(s)')).toBeTruthy();
  });

  it('keeps Import disabled when reconciliation residual rules fail', async () => {
    const state = await buildState({ csv: ACCRUED_INTEREST_CSV, acknowledged: true });
    renderReconciliation(state);

    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/BUY draft\(s\) with accrued interest/i).length).toBeGreaterThan(0);
  });

  it('keeps Import disabled when acknowledgement is unchecked', async () => {
    const state = await buildState({ csv: EXAMPLE_CSV, acknowledged: false });
    renderReconciliation(state);

    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Reconciliation not acknowledged')).toBeTruthy();
  });

  it('enables Import when every blocker is cleared', async () => {
    const state = await buildState({ csv: EXAMPLE_CSV, acknowledged: true });
    renderReconciliation(state);

    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(false);
  });
});
