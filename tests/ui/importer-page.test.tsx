/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { cleanupUi, renderPageToReconcile } from './helpers';

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
});
