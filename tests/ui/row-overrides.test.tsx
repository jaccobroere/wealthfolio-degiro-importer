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
  UNSUPPORTED_CSV,
  installFileReaderMock,
  installPointerCaptureMock,
} from './helpers';

/** Drive the wizard to the review step with a statement containing a blocker. */
async function renderPageToReview() {
  const host = createFakeHost({ searchResults: DEFAULT_SEARCH_RESULTS });
  const ctx = createAddonContext(host.api);
  const user = userEvent.setup();
  const fileReader = installFileReaderMock(UNSUPPORTED_CSV);
  installPointerCaptureMock();

  const view = render(
    <ImporterPage
      ctx={ctx}
      location={{ pathname: '/addon/degiro-importer', search: '', hash: '', params: {} }}
    />,
  );

  const fileInput = await screen.findByTestId('file-input');
  await user.upload(fileInput, new File([UNSUPPORTED_CSV], 'statement.csv', { type: 'text/csv' }));

  const accountTrigger = await screen.findByTestId('account-select-trigger');
  await user.click(accountTrigger);
  await user.click(await screen.findByRole('option', { name: /DEGIRO.*EUR/i }));
  await user.click(await screen.findByTestId('mapping-continue'));
  await screen.findByTestId('review-continue');

  return { ...view, user, host, restoreFileReader: fileReader.restore };
}

/** The review row whose source row number matches, by its rendered index. */
async function expandSourceRow(user: ReturnType<typeof userEvent.setup>, sourceRowNumber: number) {
  const cells = await screen.findAllByText(String(sourceRowNumber), { selector: 'td' });
  const row = cells[0].closest('tr');
  if (!row) throw new Error(`No review row for source row ${sourceRowNumber}`);
  const toggle = row.querySelector('[data-testid^="review-expand-"]');
  if (!toggle) throw new Error('No expand control on the review row');
  await user.click(toggle);
}

describe('review step — in-place row fixes', () => {
  afterEach(() => {
    cleanupUi();
  });

  it('shows the blocking row and lets the reviewer exclude it without touching the CSV', async () => {
    const { user, restoreFileReader } = await renderPageToReview();
    try {
      expect(screen.getByText('Requires review: 1')).toBeTruthy();

      await expandSourceRow(user, 2);
      // The raw description is only revealed for the row the reviewer opened.
      expect(await screen.findByText(/Onbekende Actie Die Niemand Kent/)).toBeTruthy();
      expect(screen.getByTestId('row-preview-2').textContent).toContain('Not recognized');

      await user.click(screen.getByTestId('row-ignore-2'));

      await waitFor(() => {
        expect(screen.getByText('Requires review: 0')).toBeTruthy();
      });
      expect(screen.getByTestId('override-summary').textContent).toContain('1 row changed by you');
      expect(screen.getByText('Skips: 1')).toBeTruthy();
    } finally {
      restoreFileReader();
    }
  });

  it('re-classifies a row live when the reviewer corrects its description', async () => {
    const { user, restoreFileReader } = await renderPageToReview();
    try {
      await expandSourceRow(user, 2);
      await user.click(screen.getByTestId('row-edit-2'));

      const description = screen.getByTestId('row-field-2-description');
      await user.clear(description);
      await user.type(description, 'Flatex Interest');

      // The preview updates before anything is applied.
      await waitFor(() => {
        expect(screen.getByTestId('row-preview-2').textContent).toContain('Recognized as INTEREST');
      });

      await user.click(screen.getByTestId('row-apply-2'));

      await waitFor(() => {
        expect(screen.getByText('Requires review: 0')).toBeTruthy();
      });
      // Edited rows stay visible as warnings rather than silently passing.
      expect(screen.getByText('Warnings: 1')).toBeTruthy();
    } finally {
      restoreFileReader();
    }
  });

  it('restores an ignored row and re-blocks the import', async () => {
    const { user, restoreFileReader } = await renderPageToReview();
    try {
      await expandSourceRow(user, 2);
      await user.click(screen.getByTestId('row-ignore-2'));
      await waitFor(() => {
        expect(screen.getByText('Requires review: 0')).toBeTruthy();
      });

      await user.click(screen.getByTestId('row-restore-2'));
      await waitFor(() => {
        expect(screen.getByText('Requires review: 1')).toBeTruthy();
      });
      expect(screen.queryByTestId('override-summary')).toBeNull();
    } finally {
      restoreFileReader();
    }
  });

  it('resets every decision at once', async () => {
    const { user, restoreFileReader } = await renderPageToReview();
    try {
      await expandSourceRow(user, 2);
      await user.click(screen.getByTestId('row-ignore-2'));
      await waitFor(() => {
        expect(screen.getByTestId('override-summary')).toBeTruthy();
      });

      await user.click(screen.getByTestId('clear-overrides'));
      await waitFor(() => {
        expect(screen.getByText('Requires review: 1')).toBeTruthy();
      });
      expect(screen.queryByTestId('override-summary')).toBeNull();
    } finally {
      restoreFileReader();
    }
  });
});
