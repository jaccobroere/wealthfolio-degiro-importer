import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type FrameLocator, type Page } from '@playwright/test';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const ADDON_ZIP = path.join(ROOT, 'artifacts/wealthfolio-degiro-importer-1.1.0.zip');
export const CASH_FIXTURE = path.join(import.meta.dirname, 'fixtures/degiro-cash-only.csv');
export const INVALID_FIXTURE = path.join(ROOT, 'tests/fixtures/degiro-unknown-type.csv');
export const ACCOUNT_NAME = 'T09 Disposable DEGIRO';

export function addonFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe');
}

export function assertExactArchive(): void {
  const expected = readFileSync(path.join(ROOT, 'artifacts/SHA256SUMS'), 'utf8')
    .split('\n')
    .find((line) => line.endsWith('wealthfolio-degiro-importer-1.1.0.zip'))
    ?.trim()
    .split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(ADDON_ZIP)).digest('hex');
  if (!expected || actual !== expected) {
    throw new Error('The E2E harness only accepts the SHA256SUMS-validated release archive.');
  }
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  const password = page.getByRole('textbox', { name: 'Enter your password' });
  // The host first renders its auth-status loading state, so isVisible() can
  // race and skip the login form. The v3.6.1 password form stays at `/` after
  // successful submission; prove the documented JSON request succeeds and the
  // form is dismissed instead of waiting for a URL redirect that never occurs.
  await expect(password).toBeVisible();
  await password.fill('T09-disposable-password');
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect((await loginResponse).status()).toBe(200);
  await expect(password).toBeHidden();
}

export async function completeOnboarding(page: Page): Promise<void> {
  await signIn(page);

  // v3.6.1 presents onboarding at `/`; its mode cards are informational, and
  // onboarding advances with the footer controls. An initialized database has
  // no Transactions choice.
  const transactions = page.getByRole('heading', { name: 'Transactions' });
  await expect(transactions).toBeVisible();

  await page.getByTestId('onboarding-continue-button').click();
  await expect(page.getByText('Just a couple preferences to get you started')).toBeVisible();
  await page.getByTestId('onboarding-continue-button').click();
  await expect(page.getByText('Customize your experience')).toBeVisible();
  await page.getByTestId('onboarding-continue-button').click();
  await expect(page.getByRole('heading', { name: 'Wealthfolio Connect' })).toBeVisible();
  await page.getByTestId('onboarding-finish-button').click();
  await expect(page).toHaveURL(/\/settings\/accounts/);
}

export async function installExactAddon(page: Page): Promise<void> {
  assertExactArchive();
  await page.goto('/settings/addons');
  const install = page.locator("button[title='Install from File']:visible");
  await expect(install).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), install.click()]);
  await chooser.setFiles(ADDON_ZIP);
  await page.getByRole('button', { name: 'Approve & Install' }).click();
  await expect(page.getByRole('link', { name: 'DEGIRO Import' })).toBeVisible();
}

export async function createDisposableAccount(page: Page): Promise<void> {
  await page.goto('/settings/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('textbox', { name: 'Account Name' }).fill(ACCOUNT_NAME);
  await page.getByRole('radio', { name: /Transactions/ }).click();
  await page.getByRole('combobox', { name: 'Currency' }).click();
  await page.getByRole('option', { name: 'European Euro (EUR)' }).click();
  await page.getByRole('button', { name: 'Add Account' }).click();
  // The host renders desktop and compact account lists; the compact duplicate
  // is the visible one at the E2E viewport.
  await expect(page.getByText(ACCOUNT_NAME).last()).toBeVisible();
}

export async function openAddon(page: Page): Promise<FrameLocator> {
  await page.goto('/addon/degiro-importer');
  const frame = addonFrame(page);
  await expect(frame.getByRole('heading', { name: 'DEGIRO Importer' })).toBeVisible();
  return frame;
}

export async function upload(frame: FrameLocator, file: string): Promise<void> {
  await frame.getByTestId('file-input').setInputFiles(file);
}
