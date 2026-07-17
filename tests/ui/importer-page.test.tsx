/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImporterPage } from '../../src/pages/importer-page';
import { createFakeHost } from '../wealthfolio/fake-host';
import {
  cleanupUi,
  createAddonContext,
  DEFAULT_SEARCH_RESULTS,
  EXAMPLE_CSV,
  installFileReaderMock,
  renderPageToReconcile,
} from './helpers';

describe('DEGIRO importer page', () => {
  afterEach(() => {
    cleanupUi();
  });

  it('reaches reconcile and enables Import only after acknowledgement when every blocker is cleared', async () => {
    const { user, restoreFileReader } = await renderPageToReconcile();

    try {
      const importButton = await screen.findByTestId('import-button');
      const acknowledgeCheckbox = screen.getByTestId('acknowledge-checkbox');

      expect((importButton as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('Reconciliation not acknowledged')).toBeTruthy();

      await user.click(acknowledgeCheckbox);

      expect((importButton as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText('Reconciliation not acknowledged')).toBeNull();
    } finally {
      restoreFileReader();
    }
  });

  it('keeps privacy-safe parse totals visible after upload without mapping or writing', async () => {
    const host = createFakeHost();
    const reader = installFileReaderMock(EXAMPLE_CSV);
    const user = userEvent.setup();

    try {
      render(
        <ImporterPage
          ctx={createAddonContext(host.api)}
          location={{ pathname: '/addon/degiro-importer', search: '', hash: '', params: {} }}
        />,
      );
      await user.upload(
        await screen.findByTestId('file-input'),
        new File([EXAMPLE_CSV], 'synthetic.csv', { type: 'text/csv' }),
      );

      expect(await screen.findByTestId('parsed-statement-summary')).toBeTruthy();
      expect(screen.getByTestId('parsed-row-count').textContent).toBe('14 rows');
      expect(screen.getByTestId('parsed-activity-count').textContent).toBe('10 activities');
      expect(screen.getByTestId('parsed-activity-type-BUY').textContent).toBe('BUY: 1');
      expect(host.saveManyCalls).toHaveLength(0);
      expect(host.savedMapping).toBeUndefined();
    } finally {
      reader.restore();
    }
  });

  it('accepts and saves only unambiguous security search results in one action', async () => {
    const vwce = DEFAULT_SEARCH_RESULTS.IE00B3RBWM25[0];
    const host = createFakeHost({
      searchResults: {
        ...DEFAULT_SEARCH_RESULTS,
        IE00B3RBWM25: [
          vwce,
          { ...vwce, symbol: 'VWRL', canonicalSymbol: 'VWRL', providerId: 'wf-vwrl' },
        ],
      },
    });
    const reader = installFileReaderMock(EXAMPLE_CSV);
    const user = userEvent.setup();

    try {
      render(
        <ImporterPage
          ctx={createAddonContext(host.api)}
          location={{ pathname: '/addon/degiro-importer', search: '', hash: '', params: {} }}
        />,
      );
      await user.upload(
        await screen.findByTestId('file-input'),
        new File([EXAMPLE_CSV], 'synthetic.csv', { type: 'text/csv' }),
      );

      await user.click(await screen.findByTestId('account-select-trigger'));
      await user.click(await screen.findByRole('option', { name: /DEGIRO.*EUR/i }));
      const acceptAll = await screen.findByTestId('accept-all-suggested');
      await waitFor(() => expect((acceptAll as HTMLButtonElement).disabled).toBe(false));
      await user.click(acceptAll);

      const continueButton = screen.getByTestId('mapping-continue') as HTMLButtonElement;
      await waitFor(() => {
        expect(continueButton.disabled).toBe(true);
        expect(screen.getByText('Ambiguous (2 candidates)')).toBeTruthy();
        expect(host.savedMapping?.symbolMappings['degiro-importer::IE00B3RBWM25']).toBeUndefined();
        expect(host.savedMapping?.symbolMappings['degiro-importer::IE00B4L5Y983']).toContain(
          'IWDA',
        );
      });
    } finally {
      reader.restore();
    }
  });
});
