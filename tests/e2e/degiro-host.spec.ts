import { expect, test } from '@playwright/test';

import {
  ACCOUNT_NAME,
  ACCRUED_INTEREST_FIXTURE,
  CASH_BATCH_PROBE_FIXTURE,
  CASH_FIXTURE,
  CASH_OVERLAP_FIXTURE,
  CANONICAL_SIGNS_FIXTURE,
  INVALID_FIXTURE,
  MAPPING_PERSISTENCE_FIXTURE,
  completeOnboarding,
  createDisposableAccount,
  installExactAddon,
  openAddon,
  restartDisposableHost,
  signIn,
  upload,
} from './helpers';
import { EXPECTED } from '../acceptance/degiro-real-expected';

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

test('saveMany rejects a mixed valid and invalid cash-only batch atomically', async ({ page }) => {
  let bulkRequest: { url: string; creates: Array<Record<string, unknown>> } | undefined;
  let activitiesSearch: { url: string; accountIdFilter: string[] } | undefined;
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.request().method() !== 'POST') return;
    const body = JSON.parse(response.request().postData() ?? '{}') as {
      creates?: unknown;
      accountIdFilter?: unknown;
      pageSize?: unknown;
    };
    // The live add-on supplies both the authenticated host route and a
    // host-accepted cash ActivityCreate shape. The direct mixed batch below
    // changes only quoteCcy on one otherwise cash-only create.
    if (pathname === '/api/v1/activities/bulk' && Array.isArray(body.creates)) {
      bulkRequest = {
        url: response.url(),
        creates: body.creates as Array<Record<string, unknown>>,
      };
    }
    if (
      pathname === '/api/v1/activities/search' &&
      body.pageSize === Number.MAX_SAFE_INTEGER &&
      Array.isArray(body.accountIdFilter) &&
      body.accountIdFilter.every((id): id is string => typeof id === 'string')
    ) {
      activitiesSearch = { url: response.url(), accountIdFilter: body.accountIdFilter };
    }
  });

  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, CASH_BATCH_PROBE_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByTestId('acknowledge-checkbox').click();
  await frame.getByTestId('import-button').click();
  await expect(frame.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect.poll(() => bulkRequest).toBeDefined();
  await expect.poll(() => activitiesSearch).toBeDefined();
  expect(bulkRequest!.creates).toHaveLength(1);

  const observed = await page.evaluate(
    async ({ bulkUrl, searchUrl, accountIdFilter, source }) => {
      const count = async () => {
        const response = await fetch(searchUrl, {
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
        const payload = (await response.json()) as { data?: unknown[] };
        return Array.isArray(payload.data) ? payload.data.length : -1;
      };
      const valid = structuredClone(source);
      const invalid = structuredClone(source);
      // Cash-only negative control: the documented mandatory cash quote currency
      // is removed. No asset, instrument, account, or personal input is created.
      invalid.asset = {};
      const before = await count();
      const response = await fetch(bulkUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creates: [valid, invalid] }),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      const object = typeof payload === 'object' && payload !== null ? payload : {};
      return {
        status: response.status,
        createdCount: Array.isArray((object as { created?: unknown }).created)
          ? (object as { created: unknown[] }).created.length
          : 0,
        errorCount: Array.isArray((object as { errors?: unknown }).errors)
          ? (object as { errors: unknown[] }).errors.length
          : 0,
        persistedDelta: (await count()) - before,
      };
    },
    {
      bulkUrl: bulkRequest!.url,
      searchUrl: activitiesSearch!.url,
      accountIdFilter: activitiesSearch!.accountIdFilter,
      source: bulkRequest!.creates[0],
    },
  );

  // Deliberately assert the observed host contract rather than infer it from
  // the SDK type: the persisted search delta is independent of response shape.
  expect(observed, 'mixed cash-batch host observation').toEqual({
    status: 400,
    createdCount: 0,
    errorCount: 0,
    persistedDelta: 0,
  });
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

test('persists a host-supported synthetic mapping configuration across a container restart', async ({
  page,
}) => {
  let mappingGetUrl: string | undefined;
  const searchResponses: { status: number; resultCount: number }[] = [];
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.request().method() === 'GET' && pathname === '/api/v1/activities/import/mapping') {
      mappingGetUrl = response.url();
    }
    if (response.request().method() === 'GET' && pathname === '/api/v1/market-data/search') {
      void response.json().then((body: unknown) => {
        searchResponses.push({
          status: response.status(),
          resultCount: Array.isArray(body) ? body.length : -1,
        });
      });
    }
  });

  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, MAPPING_PERSISTENCE_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await expect(frame.getByTestId('unresolved-count')).toHaveText('1 unresolved');
  await expect.poll(() => mappingGetUrl).toBeDefined();

  // This is an isolated mapping-config record only: it neither creates an
  // asset nor advances to review/import. The host API's accepted response is
  // the persistence evidence; the synthetic target is never submitted as an
  // activity asset.
  const mappingUrl = new URL(mappingGetUrl!);
  const accountId = mappingUrl.searchParams.get('accountId');
  expect(accountId).toBeTruthy();
  const mapping = {
    accountId,
    contextKind: 'degiro-importer',
    fieldMappings: {},
    activityMappings: {},
    accountMappings: {},
    symbolMappings: {
      'degiro-importer::XSYNTHETIC-MAPPING-PROBE': JSON.stringify({
        symbol: 'T09-PROBE',
        exchangeMic: 'XTEST',
        providerId: 't09-host-proof',
      }),
    },
  };
  const saved = await page.evaluate(async (payload) => {
    const response = await fetch('/api/v1/activities/import/mapping', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapping: payload }),
    });
    const body: unknown = await response.json();
    return {
      status: response.status,
      hasProbe:
        typeof body === 'object' &&
        body !== null &&
        'symbolMappings' in body &&
        typeof (body as { symbolMappings?: unknown }).symbolMappings === 'object' &&
        (body as { symbolMappings: Record<string, unknown> }).symbolMappings[
          'degiro-importer::XSYNTHETIC-MAPPING-PROBE'
        ] === payload.symbolMappings['degiro-importer::XSYNTHETIC-MAPPING-PROBE'],
    };
  }, mapping);
  expect(saved).toEqual({ status: 200, hasProbe: true });

  restartDisposableHost();
  await signIn(page);
  const reloaded = await page.evaluate(
    async ({ accountId: persistedAccountId }) => {
      const response = await fetch(
        `/api/v1/activities/import/mapping?accountId=${encodeURIComponent(persistedAccountId!)}&contextKind=degiro-importer`,
        { credentials: 'same-origin' },
      );
      const body: unknown = await response.json();
      return {
        status: response.status,
        hasProbe:
          typeof body === 'object' &&
          body !== null &&
          'symbolMappings' in body &&
          typeof (body as { symbolMappings?: unknown }).symbolMappings === 'object' &&
          typeof (body as { symbolMappings: Record<string, unknown> }).symbolMappings[
            'degiro-importer::XSYNTHETIC-MAPPING-PROBE'
          ] === 'string',
      };
    },
    { accountId },
  );
  expect(reloaded).toEqual({ status: 200, hasProbe: true });

  const restartedFrame = await openAddon(page);
  await upload(restartedFrame, MAPPING_PERSISTENCE_FIXTURE);
  await restartedFrame.getByTestId('account-select-trigger').click();
  await restartedFrame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await expect(restartedFrame.getByText('T09-PROBE · XTEST (saved)')).toBeVisible();
  await expect(restartedFrame.getByTestId('mapping-continue')).toBeEnabled();
  await expect.poll(() => searchResponses.some((entry) => entry.resultCount === 0)).toBe(true);
  expect(searchResponses.some((entry) => entry.status === 200 && entry.resultCount === 0)).toBe(
    true,
  );
});

test('keeps unresolved synthetic instruments out of host writes', async ({ page }) => {
  const searchResponses: { status: number; resultCount: number }[] = [];
  page.on('response', (response) => {
    if (
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/market-data/search'
    ) {
      void response.json().then((body: unknown) => {
        searchResponses.push({
          status: response.status(),
          resultCount: Array.isArray(body) ? body.length : -1,
        });
      });
    }
  });
  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, CANONICAL_SIGNS_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await expect(frame.getByTestId('unresolved-count')).toHaveText('1 unresolved');
  await frame.getByTestId('search-btn-XSYNTHETIC01').click();
  await expect(frame.getByTestId('no-results-XSYNTHETIC01')).toBeVisible();
  await expect(frame.getByTestId('mapping-continue')).toBeDisabled();
  await expect.poll(() => searchResponses.length).toBeGreaterThan(0);
  expect(searchResponses).toContainEqual({ status: 200, resultCount: 0 });
});

test('explicitly selects a host-supported test instrument but keeps accrued-interest BUYs gated', async ({
  page,
}) => {
  const searchResponses: { status: number; resultCount: number }[] = [];
  page.on('response', (response) => {
    if (
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/market-data/search'
    ) {
      void response.json().then((body: unknown) => {
        searchResponses.push({
          status: response.status(),
          resultCount: Array.isArray(body) ? body.length : -1,
        });
      });
    }
  });
  await signIn(page);
  const frame = await openAddon(page);
  await upload(frame, ACCRUED_INTEREST_FIXTURE);
  await frame.getByTestId('account-select-trigger').click();
  await frame.getByText(`${ACCOUNT_NAME} (EUR)`).click();
  await frame.getByTestId('search-btn-US0378331005').click();
  await expect(frame.getByTestId('search-results-US0378331005')).toBeVisible();
  await expect(frame.getByTestId('search-result-US0378331005-0')).toBeVisible();
  await expect(frame.getByTestId('mapping-continue')).toBeDisabled();
  await frame.getByTestId('search-result-US0378331005-0').click();
  await expect(frame.getByTestId('mapping-continue')).toBeEnabled();
  await frame.getByTestId('mapping-continue').click();
  await frame.getByTestId('review-continue').click();
  await frame.getByTestId('acknowledge-checkbox').click();
  await expect(frame.getByTestId('import-button')).toBeDisabled();
  await expect.poll(() => searchResponses.length).toBeGreaterThan(0);
  expect(searchResponses.some((entry) => entry.status === 200 && entry.resultCount > 0)).toBe(true);
});

test('@acceptance parses a personal statement only when explicitly opted in', async ({ page }) => {
  test.skip(
    !process.env.DEGIRO_ACCEPTANCE_CSV,
    'DEGIRO_ACCEPTANCE_CSV was not explicitly supplied',
  );
  await signIn(page);
  const frame = await openAddon(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith('/api/v1/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    ) {
      // Keep failure output structural: never retain request data, IDs, or paths.
      writes.push(request.method());
    }
  });
  await upload(frame, process.env.DEGIRO_ACCEPTANCE_CSV!);
  // The wizard advances immediately after parsing, so parse-only evidence lives
  // on mapping. Do not select an account, map a symbol, reconcile, or write.
  await expect(
    frame.getByText('Could not parse this file'),
    'The local UI reported a parse error; statement contents are intentionally not emitted.',
  ).toBeHidden();
  await expect(frame.getByRole('heading', { name: /Step 2.*Account/ })).toBeVisible();
  await expect(frame.getByTestId('parsed-statement-summary')).toBeVisible();
  await expect(frame.getByTestId('parsed-row-count')).toHaveText(`${EXPECTED.sourceRowCount} rows`);
  await expect(frame.getByTestId('parsed-activity-count')).toHaveText(
    `${EXPECTED.activityCount} activities`,
  );
  for (const [type, count] of Object.entries(EXPECTED.byActivityType)) {
    await expect(frame.getByTestId(`parsed-activity-type-${type}`)).toHaveText(`${type}: ${count}`);
  }
  expect(writes).toEqual([]);
});
