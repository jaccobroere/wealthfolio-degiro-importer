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
const largeBatchFixture = path.join(import.meta.dirname, 'fixtures/degiro-large-batch.csv');
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

/**
 * Dismiss the v3.6.2 "New Update Available" modal that the 3.6.1 host
 * overlays on every page. Evidence (see /tmp/degiro-explore.log):
 *   - snapshot 1 (post-signin, /):  Close dialog count=1, Remind me later
 *     count=1, "New Update Available" h2 visible; dashboard dimmed.
 *   - snapshot 3 (/settings/addons): same dialog re-appears.
 *   - snapshot 4 (/settings/accounts): same dialog re-appears.
 *   - snapshot 9 (/addon/...): same dialog re-appears.
 *   - snapshot 2 (after dismiss, /): Close dialog count=0; dashboard clean.
 * The X / `Close dialog` button is the most reliable target; "Remind me
 * later" is a fallback. The dialog content has `pointer-events: auto` and
 * sits on top of a same-z overlay, so we click the X and wait for the
 * dialog to fully unmount before the next interaction.
 *
 * IMPORTANT: the v3.6.2 dialog mounts AFTER the host's settings pages
 * render. A simple `count() > 0` check after a flat wait can race and
 * see `count() === 0` while the dialog is about to mount, so we wait
 * for the X to become visible (or to remain hidden — meaning the
 * current page has no dialog and we can no-op).
 */
async function dismissUpdateDialog(page: Page): Promise<void> {
  // Wait for the X to appear. The dialog mounts asynchronously after
  // the host's settings page renders; if we don't see it within 5s
  // the page has no dialog and we move on.
  const closeDialog = page.getByRole('button', { name: 'Close dialog' });
  const appeared = await closeDialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await closeDialog.click({ timeout: 5_000 }).catch(() => {});
  }
  // Fallback: "Remind me later" button (in case Close dialog is up but
  // not visible, e.g. behind another element).
  const remindLater = page.getByRole('button', { name: 'Remind me later' });
  if ((await remindLater.count()) > 0) {
    await remindLater.click({ timeout: 5_000 }).catch(() => {});
  }
  // Wait for the dialog to actually unmount, not just a flat timeout.
  // The Radix dialog unmounts with a brief exit animation, so we wait
  // for the X button count to drop to 0 (with a hard ceiling to avoid
  // hanging on a stuck dialog).
  await page
    .waitForFunction(
      () => document.querySelectorAll('[aria-label="Close dialog"]').length === 0,
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
  // Also wait for the overlay backdrop to disappear, otherwise
  // pointer-events still intercept the next click. The overlay uses
  // a class with the dialog state and a fixed z-50 wrapper.
  await page
    .waitForFunction(
      () => {
        const overlays = document.querySelectorAll(
          '[data-slot="dialog-overlay"][data-state="closed"], [data-slot="dialog-overlay"][data-state="open"]',
        );
        if (overlays.length > 0) return false;
        return true;
      },
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Walk the 3.6.1 host's first-sign-in onboarding wizard if it is showing.
 * Evidence (see /tmp/degiro-explore.log, exploration `_explore-onboarding`):
 *   - snapshot 10 (/onboarding, fresh host): data-testid="onboarding-page"
 *     wrapper, two h3 ("Holdings" / "Transactions") mode picker, button
 *     "Continue" with data-testid="onboarding-continue-button".
 *   - snapshot 11 (step 2): Language / Currency / Timezone pickers, "Continue".
 *   - snapshot 12 step 3: theme (Light/Dark/System + Sidebar/Floating +
 *     Mono/Sans/Serif), "Continue".
 *   - snapshot 12 step 4: Wealthfolio Connect h2 + three h3s (Brokerage /
 *     Device / Household), "Get Started" with
 *     data-testid="onboarding-finish-button".
 *   - snapshot 12 step 5: URL changes to /settings/accounts.
 * The wizard is shown only on a fresh host (no user yet, or a user who
 * has not completed the wizard). Once completed, the host routes straight
 * to the dashboard. We probe the testid and only run the walk when the
 * wizard is actually showing.
 */
async function completeOnboardingIfPresent(page: Page): Promise<void> {
  // Wait for either the wizard to mount, or for the host to settle on a
  // post-wizard page. The signIn above just dismissed a password field;
  // the host then renders either the wizard (fresh volume) or the
  // dashboard (non-fresh volume). We wait up to 10s for the wizard
  // testid to appear, or for the URL to settle on a non-onboarding
  // path (which means the wizard is done and we can skip the walk).
  const wizard = page.getByTestId('onboarding-page');
  const wizardAppeared = await wizard
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!wizardAppeared) return;
  for (let step = 0; step < 3; step += 1) {
    const cont = page.getByTestId('onboarding-continue-button');
    await expect(cont).toBeVisible({ timeout: 15_000 });
    await cont.click();
    // The next step re-renders; settle before the next interaction.
    await page.waitForTimeout(500);
  }
  const finish = page.getByTestId('onboarding-finish-button');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  await finish.click();
  // The host routes to /settings/accounts; wait for that URL.
  await page.waitForURL(/\/settings\/accounts/, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/** Prepare an empty disposable host and install the packaged add-on. */
export async function prepareHost(page: Page): Promise<void> {
  await signIn(page);
  // The 3.6.1 host shows a 4-step onboarding wizard on a fresh volume
  // (mode picker, preferences, theme, Wealthfolio Connect). It routes to
  // /settings/accounts after the final "Get Started" click. The wizard
  // is also the only place the host surfaces the "Transactions" heading
  // (as an h3 in the mode picker), so the original helper's
  // `getByRole('heading', { name: 'Transactions' })` assertion is a
  // wizard-detection probe that only succeeds against a fresh host. If
  // the volume is non-fresh (user already exists, wizard complete), the
  // host goes straight to the dashboard at /. completeOnboardingIfPresent
  // detects whichever state we are in and acts accordingly.
  await completeOnboardingIfPresent(page);
  // Whether the wizard ran or was skipped, we are now on a host page that
  // is overlaid by the v3.6.2 "New Update Available" dialog. Dismiss it
  // so subsequent clicks land on the host UI instead of the dialog
  // overlay.
  await dismissUpdateDialog(page);

  assertExactArchive();
  await page.goto('/settings/addons');
  await dismissUpdateDialog(page);
  const install = page.getByRole('button', { name: 'Install from File' }).first();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), install.click()]);
  await chooser.setFiles(addonZip);
  await page.getByRole('button', { name: 'Approve & Install' }).click();
  await expect(page.getByRole('link', { name: 'DEGIRO Import' })).toBeVisible();

  await page.goto('/settings/accounts');
  // The v3.6.2 update dialog re-appears on every navigation. Dismiss it
  // before opening the Add Account form so the click lands on the host
  // button instead of being eaten by the dialog overlay.
  await dismissUpdateDialog(page);
  // Two "Add account" buttons render on the page (header + empty-state CTA);
  // snapshot 5 reports count=2 even with the dialog dismissed. Use .first()
  // to satisfy Playwright strict mode.
  await page.getByRole('button', { name: 'Add account' }).first().click();
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
  await frame.getByText(`${accountName} (EUR)`).first().click();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByTestId('acknowledge-checkbox').click();
  await expect(frame.getByTestId('import-button')).toBeEnabled();
  return frame;
}

/** Absolute path to the 250-row large-batch synthetic cash fixture. */
export function getLargeBatchFixturePath(): string {
  return largeBatchFixture;
}

/** Upload the 250-row large-batch fixture and advance it to explicit import confirmation. */
export async function prepareLargeBatchImport(page: Page): Promise<FrameLocator> {
  await page.goto('/addon/degiro-importer');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'DEGIRO Importer' })).toBeVisible();
  await frame.getByTestId('file-input').setInputFiles(largeBatchFixture);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${accountName} (EUR)`).first().click();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByTestId('acknowledge-checkbox').click();
  await expect(frame.getByTestId('import-button')).toBeEnabled();
  return frame;
}
