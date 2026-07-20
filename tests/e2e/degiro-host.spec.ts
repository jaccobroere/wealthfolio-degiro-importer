import { expect, test } from '@playwright/test';

import { prepareCashImport, prepareHost } from './helpers';

test('imports a packaged add-on CSV once and skips the duplicate import', async ({ page }) => {
  await prepareHost(page);

  const firstImport = await prepareCashImport(page);
  await firstImport.getByTestId('import-button').click();
  await expect(firstImport.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect(firstImport.getByText('2 activity(ies) created successfully.')).toBeVisible();

  const duplicateImport = await prepareCashImport(page);
  await duplicateImport.getByTestId('import-button').click();
  await expect(duplicateImport.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect(duplicateImport.getByText('0 activity(ies) created successfully.')).toBeVisible();
});
