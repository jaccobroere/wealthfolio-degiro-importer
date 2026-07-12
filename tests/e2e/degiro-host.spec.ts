import { expect, test } from '@playwright/test';

import {
  ACCOUNT_NAME,
  CASH_FIXTURE,
  INVALID_FIXTURE,
  completeOnboarding,
  createDisposableAccount,
  installExactAddon,
  openAddon,
  signIn,
  upload,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('installs the exact archive, renders repeatedly, and survives disable/re-enable', async ({
  page,
}) => {
  await completeOnboarding(page);
  await installExactAddon(page);

  await openAddon(page);
  await openAddon(page);

  await page.goto('/settings/addons');
  const enabled = page.getByRole('switch');
  await enabled.click();
  await expect(page.getByRole('link', { name: 'DEGIRO Import' })).toBeHidden();
  await enabled.click();
  await expect(page.getByRole('link', { name: 'DEGIRO Import' })).toBeVisible();
  await openAddon(page);
});

test('imports a synthetic cash-only statement and skips the same statement on re-import', async ({
  page,
}) => {
  await signIn(page);
  await createDisposableAccount(page);
  const frame = await openAddon(page);
  await upload(frame, CASH_FIXTURE);
  await expect(frame.getByRole('heading', { name: /Step 2.*Account/ })).toBeVisible();
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await frame.getByTestId('mapping-continue').click();
  await expect(frame.getByRole('heading', { name: /Step 3.*Review/ })).toBeVisible();
  await frame.getByTestId('review-continue').click();
  await expect(frame.getByRole('heading', { name: /Step 4.*Reconcile/ })).toBeVisible();
  await frame.getByTestId('acknowledge-checkbox').click();
  await expect(frame.getByTestId('import-button')).toBeEnabled();
  await frame.getByTestId('import-button').click();
  await expect(frame.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect(frame.getByText('2 activity(ies) created successfully.')).toBeVisible();

  await frame.getByTestId('reset-button').click();
  await upload(frame, CASH_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByTestId('acknowledge-checkbox').click();
  await frame.getByTestId('import-button').click();
  await expect(frame.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect(frame.getByText('0 activity(ies) created successfully.')).toBeVisible();
});

test('blocks a synthetic invalid statement before the import action is available', async ({
  page,
}) => {
  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, INVALID_FIXTURE);
  await expect(frame.getByRole('heading', { name: /Step 2.*Account/ })).toBeVisible();
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await expect(frame.getByRole('heading', { name: /Step 4.*Reconcile/ })).toBeVisible();
  await expect(frame.getByTestId('import-button')).toBeDisabled();
});

test('@acceptance parses a personal statement only when explicitly opted in', async ({ page }) => {
  test.skip(
    !process.env.DEGIRO_ACCEPTANCE_CSV,
    'DEGIRO_ACCEPTANCE_CSV was not explicitly supplied',
  );
  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, process.env.DEGIRO_ACCEPTANCE_CSV!);
  // Do not select an account, map a symbol, reconcile, or invoke an import/write action.
  await expect(frame.getByRole('heading', { name: /Step 2.*Account/ })).toBeVisible();
  await expect(frame.getByTestId('step-mapping')).toBeVisible();
});
