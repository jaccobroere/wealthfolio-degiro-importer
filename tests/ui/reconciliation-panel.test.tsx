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

  it('allows Import when accrued interest is represented by cash settlements', async () => {
    const state = await buildState({ csv: ACCRUED_INTEREST_CSV, acknowledged: true });
    renderReconciliation(state);

    expect((screen.getByTestId('import-button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('All residual rules pass')).toBeTruthy();
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

  it('shows the mapped ticker and exchange for each position, with the ISIN', async () => {
    const state = await buildState({ csv: EXAMPLE_CSV });
    renderReconciliation(state);

    const labels = screen.getAllByTestId('security-label').map((el) => el.textContent ?? '');
    expect(labels.some((t) => t.includes('VWCE') && t.includes('XETR'))).toBe(true);
    expect(labels.some((t) => t.includes('IWDA') && t.includes('IE00B4L5Y983'))).toBe(true);
  });

  it('previews what is already in Wealthfolio and what needs repair', async () => {
    const buy = {
      activityType: 'BUY',
      date: '2025-03-15T09:32:00.000Z',
      quantity: '15',
      unitPrice: '76.5',
      amount: '1147.5',
      currency: 'EUR',
    };
    const state = await buildState({
      csv: EXAMPLE_CSV,
      existing: [
        { id: 'linked-buy', ...buy, assetSymbol: 'IWDA', assetId: 'asset-iwda' },
        { id: 'orphan-buy', ...buy, assetSymbol: '', assetId: '' },
        {
          id: 'orphan-dividend',
          activityType: 'DIVIDEND',
          date: '2025-09-30T13:00:00.000Z',
          amount: '20.33',
          currency: 'USD',
          assetSymbol: '',
          assetId: '',
        },
      ],
    });
    renderReconciliation(state);

    const total = state.pipeline!.batch.activities.length;
    const section = screen.getByTestId('account-match');
    expect(section.textContent).toContain('Already in account (skipped)2');
    expect(section.textContent).toContain('Stored without security1');
    expect(section.textContent).toContain('Extra copies in account1');
    expect(screen.getByTestId('extra-copies').textContent).toContain('BUY');
    expect(screen.getByTestId('unlinked-matches').textContent).toContain('DIVIDEND');
    expect(
      screen.getByText(
        new RegExp(`write ${total - 2} new activities to the selected account and skip 2`),
      ),
    ).toBeTruthy();
  });

  it('says it is still checking while the account activities load', async () => {
    const state = await buildState({ csv: EXAMPLE_CSV });
    renderReconciliation(state);

    expect(screen.getByTestId('account-match').textContent).toContain('Checking');
  });
});
