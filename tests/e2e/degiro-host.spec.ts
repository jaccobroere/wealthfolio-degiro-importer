import { expect, test } from '@playwright/test';

import {
  ACCOUNT_NAME,
  ACCRUED_INTEREST_FIXTURE,
  CASH_FIXTURE,
  CASH_OVERLAP_FIXTURE,
  CANONICAL_SIGNS_FIXTURE,
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
  const hostFailures: string[] = [];
  const activityPosts: string[] = [];
  let bulkRequest: { url: string; body: { creates?: Array<{ metadata?: unknown }> } } | undefined;
  let activitiesSearch: { url: string; accountIdFilter: string[] } | undefined;
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url().includes('/api/v1/activities/')) {
      activityPosts.push(`${new URL(response.url()).pathname} ${response.status()}`);
      if (response.url().includes('/bulk')) {
        bulkRequest = {
          url: response.url(),
          body: JSON.parse(response.request().postData() ?? '{}') as {
            creates?: Array<{ metadata?: unknown }>;
          },
        };
      }
    }
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/activities/search'
    ) {
      const body = JSON.parse(response.request().postData() ?? '{}') as {
        accountIdFilter?: unknown;
        pageSize?: unknown;
      };
      // `activities.getAll(accountId)` is bridged to this unpaginated search.
      // Record only the opaque disposable account filter; never emit it.
      if (
        body.pageSize === Number.MAX_SAFE_INTEGER &&
        Array.isArray(body.accountIdFilter) &&
        body.accountIdFilter.every((id): id is string => typeof id === 'string')
      ) {
        activitiesSearch = { url: response.url(), accountIdFilter: body.accountIdFilter };
      }
    }
    if (response.status() < 400 || !response.url().includes('/api/v1/activities/')) return;
    void response
      .text()
      .catch(() => '<response body unavailable>')
      .then((body) => {
        // This disposable test only records response shape and validation details;
        // never print identifiers should a host response include them.
        hostFailures.push(
          `${response.status()} ${new URL(response.url()).pathname} ${body
            .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, '<id>')
            .replace(/"accountId"\s*:\s*"[^"]*"/g, '"accountId":"<id>"')}`,
        );
      });
  });
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
  // Give the bridge response handler a microtask to capture any host rejection.
  await page.waitForTimeout(100);
  if (hostFailures.length > 0) throw new Error(hostFailures.join('\n'));
  const saveMany = activityPosts.find((entry) => entry.includes('/bulk '));
  // `runImport` awaits checkImport before it can issue this bulk request; the
  // sandbox bridge does not expose checkImport as a separate HTTP response.
  expect(saveMany, `activity POSTs: ${activityPosts.join(', ')}`).toBeDefined();
  expect(saveMany!).toMatch(/ 200$/);
  await expect(frame.getByText('2 activity(ies) created successfully.')).toBeVisible();

  // UI evidence above proves the import result. Metadata is intentionally not
  // rendered by the UI, so this is separate authenticated host-API evidence.
  expect(bulkRequest?.body.creates).toHaveLength(2);
  expect(activitiesSearch).toBeDefined();
  const retrieved = await page.evaluate(async ({ url, accountIdFilter }) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        page: 0,
        pageSize: Number.MAX_SAFE_INTEGER,
        accountIdFilter,
        sort: { id: 'date', desc: true },
      }),
    });
    const payload: unknown = await response.json();
    const activities =
      typeof payload === 'object' && payload !== null && 'data' in payload
        ? (payload as { data: unknown }).data
        : undefined;
    return {
      status: response.status,
      activities,
      // API-shape diagnostics only; no activity contents or identifiers.
      topLevelKeys:
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? Object.keys(payload)
          : [],
    };
  }, activitiesSearch!);
  expect(retrieved.status).toBe(200);
  expect(
    Array.isArray(retrieved.activities),
    `activity response keys: ${retrieved.topLevelKeys}`,
  ).toBe(true);
  expect(retrieved.activities).toHaveLength(2);
  const sentMetadata = bulkRequest!.body.creates!.map((create) =>
    typeof create.metadata === 'string' ? JSON.parse(create.metadata) : create.metadata,
  );
  const returnedMetadata = (retrieved.activities as Array<{ metadata?: unknown }>).map(
    (activity) => activity.metadata,
  );
  expect(returnedMetadata).toEqual(expect.arrayContaining(sentMetadata));

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
  // The persisted activity count is unchanged, independently of UI reporting.
  const afterDuplicate = await page.evaluate(async ({ url, accountIdFilter }) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        page: 0,
        pageSize: Number.MAX_SAFE_INTEGER,
        accountIdFilter,
        sort: { id: 'date', desc: true },
      }),
    });
    return (await response.json()) as { data?: unknown[] };
  }, activitiesSearch!);
  expect(afterDuplicate.data).toHaveLength(2);

  // An overlap is the same two exact rows plus one new row: only the new row
  // may be created. This is a UI proof, while the activity POST status above is
  // the independent host-API proof.
  await frame.getByTestId('reset-button').click();
  await upload(frame, CASH_OVERLAP_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByTestId('acknowledge-checkbox').click();
  await frame.getByTestId('import-button').click();
  await expect(frame.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect(frame.getByText('1 activity(ies) created successfully.')).toBeVisible();
  const afterOverlap = await page.evaluate(async ({ url, accountIdFilter }) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        page: 0,
        pageSize: Number.MAX_SAFE_INTEGER,
        accountIdFilter,
        sort: { id: 'date', desc: true },
      }),
    });
    return (await response.json()) as { data?: unknown[] };
  }, activitiesSearch!);
  expect(afterOverlap.data).toHaveLength(3);
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

test('keeps unresolved synthetic instruments out of host writes', async ({ page }) => {
  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, CANONICAL_SIGNS_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await expect(frame.getByTestId('unresolved-count')).toHaveText('1 unresolved');
  await frame.getByTestId('search-btn-XSYNTHETIC01').click();
  await expect(frame.getByTestId('no-results-XSYNTHETIC01')).toBeVisible();
  await expect(frame.getByTestId('mapping-continue')).toBeDisabled();
});

test('keeps accrued-interest BUYs blocked until a synthetic asset is safely resolved', async ({
  page,
}) => {
  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, ACCRUED_INTEREST_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await frame.getByTestId('search-btn-XSYNTHETIC02').click();
  await expect(frame.getByTestId('no-results-XSYNTHETIC02')).toBeVisible();
  await expect(frame.getByTestId('mapping-continue')).toBeDisabled();
});

test('@acceptance parses a personal statement only when explicitly opted in', async ({ page }) => {
  test.skip(
    !process.env.DEGIRO_ACCEPTANCE_CSV,
    'DEGIRO_ACCEPTANCE_CSV was not explicitly supplied',
  );
  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, process.env.DEGIRO_ACCEPTANCE_CSV!);
  // Parse-only review: do not select an account, map a symbol, reconcile, or write.
  await expect(frame.getByText('File parsed successfully')).toBeVisible();
  await expect(frame.getByText(/\d+ rows/)).toBeVisible();
  await expect(frame.getByText(/Header: (Dutch|English)/)).toBeVisible();
  await expect(frame.getByText(/Date range: \d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(frame.getByRole('heading', { name: /Step 2.*Account/ })).toBeVisible();
  await expect(frame.getByTestId('step-mapping')).toBeVisible();
});
