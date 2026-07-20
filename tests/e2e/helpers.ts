import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type FrameLocator, type Page } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../..');
const packageMetadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const addonZip = path.join(
  root,
  'artifacts',
  `${packageMetadata.name}-${packageMetadata.version}.zip`,
);
const cashFixture = path.join(import.meta.dirname, 'fixtures/degiro-cash-only.csv');
const accountName = 'Synthetic DEGIRO Test';

function assertExactArchive(): void {
  const expected = readFileSync(path.join(root, 'artifacts/SHA256SUMS'), 'utf8')
    .split('\n')
    .find((line) => line.endsWith(path.basename(addonZip)))
    ?.trim()
    .split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(addonZip)).digest('hex');
  if (!expected || actual !== expected) {
    throw new Error('Host smoke tests require the SHA256SUMS-validated release archive.');
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  const password = page.getByRole('textbox', { name: 'Enter your password' });
  await page.waitForTimeout(500);
  if ((await password.count()) === 0) return;
  await password.fill('synthetic-test-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(password).toBeHidden();
}

/** Prepare an empty disposable host and install the packaged add-on. */
export async function prepareHost(page: Page): Promise<void> {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await page.getByTestId('onboarding-continue-button').click();
  await page.getByTestId('onboarding-continue-button').click();
  await page.getByTestId('onboarding-continue-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await expect(page).toHaveURL(/\/settings\/accounts/);

  assertExactArchive();
  await page.goto('/settings/addons');
  const updateDialogClose = page.getByRole('button', { name: 'Close dialog' });
  if (await updateDialogClose.count()) await updateDialogClose.click();
  const install = page.getByRole('button', { name: 'Install from File' }).first();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), install.click()]);
  await chooser.setFiles(addonZip);
  await page.getByRole('button', { name: 'Approve & Install' }).click();
  await expect(page.getByRole('link', { name: 'DEGIRO Import' })).toBeVisible();

  await page.goto('/settings/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox', { name: 'Account Name' }).fill(accountName);
  await page.getByRole('radio', { name: /Transactions/ }).click();
  await page.getByRole('combobox', { name: 'Currency' }).click();
  await page.getByRole('option', { name: 'European Euro (EUR)' }).click();
  await page.getByRole('button', { name: 'Add Account' }).click();
  await expect(page.getByText(accountName).last()).toBeVisible();
}

/** Upload the synthetic cash fixture and advance it to explicit import confirmation. */
export async function prepareCashImport(page: Page): Promise<FrameLocator> {
  await page.goto('/addon/degiro-importer');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'DEGIRO Importer' })).toBeVisible();
  await frame.getByTestId('file-input').setInputFiles(cashFixture);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${accountName} (EUR)`).click();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByTestId('acknowledge-checkbox').click();
  await expect(frame.getByTestId('import-button')).toBeEnabled();
  return frame;
}
