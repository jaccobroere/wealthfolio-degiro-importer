/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SymbolSearchResult } from '@wealthfolio/addon-sdk';

import { ImporterPage } from '../../src/pages/importer-page';
import { createFakeHost, type FakeHostOptions } from '../wealthfolio/fake-host';
import {
  DEFAULT_SEARCH_RESULTS,
  EXAMPLE_CSV,
  cleanupUi,
  createAddonContext,
  installFileReaderMock,
  installPointerCaptureMock,
} from './helpers';

const NAME = 'Synthetic Core World UCITS ETF USD Acc';
const result = (symbol: string, mic: string, currency: string, exchangeName: string) =>
  ({
    symbol,
    canonicalSymbol: symbol.split('.')[0],
    exchange: exchangeName,
    exchangeName,
    exchangeMic: mic,
    canonicalExchangeMic: mic,
    currency,
    longName: NAME,
    shortName: NAME,
    quoteType: 'ETF',
    providerId: 'YAHOO',
    providerSymbol: symbol,
  }) as unknown as SymbolSearchResult;

const LONDON = result('IWDA.L', 'XLON', 'GBp', 'LSE');
const AMSTERDAM = result('IWDA.AS', 'XAMS', 'EUR', 'Euronext Amsterdam');
const MILAN = result('IWDA.MI', 'XMIL', 'EUR', 'Borsa Italiana');

async function openMapping(options: FakeHostOptions) {
  installPointerCaptureMock();
  const host = createFakeHost(options);
  const reader = installFileReaderMock(EXAMPLE_CSV);
  const user = userEvent.setup();
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
  return { host, user, reader };
}

describe('DEGIRO listing choice', () => {
  afterEach(() => cleanupUi());

  it('suggests the EUR listing when the ISIN search only finds London', async () => {
    const { host, user, reader } = await openMapping({
      searchResults: {
        ...DEFAULT_SEARCH_RESULTS,
        // Yahoo's ISIN search returns only the primary (London) listing.
        IE00B4L5Y983: [LONDON],
        IWDA: [LONDON, MILAN, AMSTERDAM],
      },
    });
    try {
      const acceptAll = await screen.findByTestId('accept-all-suggested');
      await waitFor(() => expect((acceptAll as HTMLButtonElement).disabled).toBe(false));
      await user.click(acceptAll);

      await waitFor(() => {
        const saved = host.savedMapping?.symbolMappings['degiro-importer::IE00B4L5Y983'];
        expect(saved).toContain('"exchangeMic":"XAMS"');
        expect(saved).toContain('"quoteCcy":"EUR"');
      });
    } finally {
      reader.restore();
    }
  });

  it('lets the reviewer run their own search and pick any listing', async () => {
    const { host, user, reader } = await openMapping({
      searchResults: { ...DEFAULT_SEARCH_RESULTS, IE00B4L5Y983: [LONDON], 'IWDA.MI': [MILAN] },
    });
    try {
      await user.click(await screen.findByTestId('search-btn-IE00B4L5Y983'));
      await user.type(await screen.findByTestId('custom-query-IE00B4L5Y983'), 'IWDA.MI');
      await user.click(screen.getByTestId('custom-search-IE00B4L5Y983'));
      await waitFor(() =>
        expect(screen.getByTestId('search-results-IE00B4L5Y983').textContent).toContain('IWDA.MI'),
      );
      await user.click(screen.getByTestId('search-result-IE00B4L5Y983-0'));

      await waitFor(() =>
        expect(host.savedMapping?.symbolMappings['degiro-importer::IE00B4L5Y983']).toContain(
          '"exchangeMic":"XMIL"',
        ),
      );
    } finally {
      reader.restore();
    }
  });

  it('forgets every remembered mapping for the account after confirmation', async () => {
    const { host, user, reader } = await openMapping({
      searchResults: DEFAULT_SEARCH_RESULTS,
      importMapping: {
        accountId: 'acct-1',
        fieldMappings: {},
        activityMappings: {},
        accountMappings: {},
        symbolMappings: {
          'degiro-importer::IE00B3RBWM25': JSON.stringify({
            symbol: 'VWCE',
            exchangeMic: 'XETR',
            providerId: 'wf-vwce',
          }),
          'revolut-importer::SYNC': JSON.stringify({ symbol: 'SYNC' }),
        },
      },
    });
    try {
      const forget = await screen.findByTestId('forget-all-mappings');
      await waitFor(() => expect((forget as HTMLButtonElement).disabled).toBe(false));
      await user.click(forget);
      await user.click(await screen.findByTestId('confirm-forget-all-mappings'));

      await waitFor(() => {
        expect(Object.keys(host.savedMapping?.symbolMappings ?? {})).toEqual([
          'revolut-importer::SYNC',
        ]);
        expect(screen.getByText('No remembered mappings for this account.')).toBeTruthy();
      });
    } finally {
      reader.restore();
    }
  });
});
