import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AddonContext,
  HostAPI,
  SymbolSearchResult,
} from '@wealthfolio/addon-sdk';

import { ImporterPage } from '../../src/pages/importer-page';
import { ReconciliationPanel } from '../../src/components/reconciliation-panel';
import {
  computeConservation,
  computeImportGate,
  computeReconciliationResiduals,
  computeUploadSummary,
  importReducer,
  initialImportState,
  type ImportState,
  type ResolvedMapping,
  type SymbolResolution,
} from '../../src/state/import-state';
import { parseAndMapWithFingerprints } from '../../src/parser/parse-and-map';
import { createFakeHost, type FakeHostOptions } from '../wealthfolio/fake-host';

export const EXAMPLE_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
14-02-2026,11:00,14-02-2026,,,Processed Flatex Withdrawal,,EUR,"-500,00",EUR,"312,18",
02-01-2026,09:00,02-01-2026,,,iDEAL storting,,EUR,"1000,00",EUR,"812,18",
31-12-2025,08:00,31-12-2025,,,DEGIRO Aansluitingskosten 2026 (Xetra - XET),,EUR,"-2,50",EUR,"-187,82",
15-12-2025,14:22,15-12-2025,VANGUARD FTSE ALL-WORLD UCITS ETF,IE00B3RBWM25,Transactiebelasting,,EUR,"-0,30",EUR,"685,32",
15-12-2025,14:22,15-12-2025,VANGUARD FTSE ALL-WORLD UCITS ETF,IE00B3RBWM25,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"685,62",
15-12-2025,14:22,15-12-2025,VANGUARD FTSE ALL-WORLD UCITS ETF,IE00B3RBWM25,"Verkoop 7 @ 112,40 EUR",,EUR,"786,80",EUR,"687,62",c3d4e5f6-0000-0000-0000-000000000003
30-09-2025,15:00,30-09-2025,,,Valuta Creditering,,EUR,"18,62",EUR,"-98,88",
30-09-2025,15:00,30-09-2025,,,Valuta Debitering,"1,0920",USD,"-20,33",USD,"0,00",
30-09-2025,15:00,30-09-2025,ISHARES CORE MSCI WORLD UCITS ETF,IE00B4L5Y983,Dividend,,USD,"20,33",USD,"20,33",
30-06-2025,07:00,30-06-2025,,,Flatex Interest,,EUR,"-0,41",EUR,"-117,50",
15-03-2025,10:32,15-03-2025,ISHARES CORE MSCI WORLD UCITS ETF,IE00B4L5Y983,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"-117,09",
15-03-2025,10:32,15-03-2025,ISHARES CORE MSCI WORLD UCITS ETF,IE00B4L5Y983,"Koop 15 @ 76,50 EUR",,EUR,"-1147,50",EUR,"-115,09",b2c3d4e5-0000-0000-0000-000000000002
03-01-2025,09:00,03-01-2025,,,flatex Storting,,EUR,"500,00",EUR,"1032,41",
31-12-2024,08:00,31-12-2024,,,DEGIRO Aansluitingskosten 2025 (Xetra - XET),,EUR,"-2,50",EUR,"532,41",
`;

export const UNSUPPORTED_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,,,iDEAL storting,,EUR,"1000,00",EUR,"1000,00",
02-01-2026,11:00,02-01-2026,SYNTHETIC EQUITY,IE00UNK0001,Onbekende Actie Die Niemand Kent,,EUR,"-42,00",EUR,"958,00",
`;

export const ACCRUED_INTEREST_CSV = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-01-2026,10:00,02-01-2026,SYNTHETIC BOND A,IE00LCL0001,"Koop 1.861 @ 100,00 EUR",,EUR,"-1.861,00",EUR,"1.861,00",ord-localized-0001
02-01-2026,10:00,02-01-2026,SYNTHETIC BOND A,IE00LCL0001,Meegekochte Rente,,EUR,"-1,23",EUR,"1.859,77",ord-localized-0001
02-01-2026,10:00,02-01-2026,SYNTHETIC BOND A,IE00LCL0001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"1.857,77",ord-localized-0001
`;

export const DEFAULT_SEARCH_RESULTS: Record<string, SymbolSearchResult[]> = {
  IE00B3RBWM25: [symbolSearchResult({ symbol: 'VWCE', exchangeName: 'Xetra', exchangeMic: 'XETR', providerId: 'wf-vwce' })],
  IE00B4L5Y983: [symbolSearchResult({ symbol: 'IWDA', exchangeName: 'Euronext Amsterdam', exchangeMic: 'XAMS', providerId: 'wf-iwda' })],
  IE00LCL0001: [symbolSearchResult({ symbol: 'BOND-A', exchangeName: 'Xetra', exchangeMic: 'XETR', providerId: 'wf-bond-a' })],
};

export function createAddonContext(api: HostAPI): AddonContext {
  return {
    api,
    sidebar: { addItem: () => ({ remove: () => {} }) },
    router: { add: () => {} },
    onDisable: () => {},
    navigation: { navigate: () => {} },
  } as unknown as AddonContext;
}

export async function buildState(options: {
  csv?: string;
  accountId?: string | null;
  acknowledged?: boolean;
  resolvedSymbols?: boolean;
  importedFingerprints?: string[];
} = {}): Promise<ImportState> {
  const {
    csv = EXAMPLE_CSV,
    accountId = 'acct-1',
    acknowledged = false,
    resolvedSymbols = true,
    importedFingerprints = [],
  } = options;

  const pipeline = await parseAndMapWithFingerprints(csv);
  let state = importReducer(initialImportState(), {
    type: 'UPLOAD_SUCCESS',
    pipeline,
    summary: computeUploadSummary(pipeline),
  });

  if (accountId) {
    state = importReducer(state, { type: 'SELECT_ACCOUNT', accountId });
  }

  state = importReducer(state, {
    type: 'DUPLICATE_INDEX_LOADED',
    fingerprints: new Set(importedFingerprints),
  });

  const resolutions: Record<string, SymbolResolution> = {};
  for (const symbol of state.instrumentSymbols) {
    resolutions[symbol] = resolvedSymbols
      ? {
          status: 'resolved',
          mapping: resolvedMapping(symbol),
        }
      : { status: 'pending' };
  }

  state = importReducer(state, { type: 'SYMBOL_RESOLUTIONS', resolutions });
  state = importReducer(state, { type: 'GOTO_STEP', step: 'reconcile' });

  if (acknowledged) {
    state = importReducer(state, { type: 'SET_ACKNOWLEDGED', acknowledged: true });
  }

  return state;
}

export function renderReconciliation(state: ImportState) {
  if (!state.pipeline) {
    throw new Error('Expected pipeline state before rendering reconciliation');
  }

  return render(
    <ReconciliationPanel
      state={state}
      reconciliation={state.pipeline.reconciliation}
      conservation={computeConservation(state)}
      residuals={computeReconciliationResiduals(state)}
      gate={computeImportGate(state)}
      onAcknowledge={() => {}}
      onImport={() => {}}
      onBack={() => {}}
    />,
  );
}

export async function renderPageToReconcile(hostOptions: FakeHostOptions = {}) {
  const host = createFakeHost({ searchResults: DEFAULT_SEARCH_RESULTS, ...hostOptions });
  const ctx = createAddonContext(host.api);
  const user = userEvent.setup();
  const fileReader = installFileReaderMock(EXAMPLE_CSV);
  installPointerCaptureMock();

  const view = render(
    <ImporterPage
      ctx={ctx}
      location={{ pathname: '/addon/degiro-importer', search: '', hash: '', params: {} }}
    />,
  );

  const fileInput = await screen.findByTestId('file-input');
  await user.upload(fileInput, new File([EXAMPLE_CSV], 'statement.csv', { type: 'text/csv' }));

  await screen.findByTestId('mapping-continue');

  const accountTrigger = await screen.findByTestId('account-select-trigger');
  await user.click(accountTrigger);
  await user.click(await screen.findByRole('option', { name: /DEGIRO.*EUR/i }));

  for (const symbol of ['IE00B3RBWM25', 'IE00B4L5Y983']) {
    await user.click(screen.getByTestId(`search-btn-${symbol}`));
    await user.click(await screen.findByTestId(`search-result-${symbol}-0`));
  }

  const mappingContinue = screen.getByTestId('mapping-continue');
  await waitFor(() => {
    if ((mappingContinue as HTMLButtonElement).disabled) {
      throw new Error('Mapping continue still disabled');
    }
  });
  await user.click(mappingContinue);

  await user.click(await screen.findByTestId('review-continue'));
  await screen.findByTestId('import-button');

  return {
    ...view,
    ctx,
    host,
    restoreFileReader: fileReader.restore,
    user,
  };
}

export function installFileReaderMock(text: string) {
  const original = globalThis.FileReader;

  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsText(): void {
      this.result = text;
      queueMicrotask(() => {
        this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
      });
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

  return {
    restore(): void {
      globalThis.FileReader = original;
    },
  };
}

export function cleanupUi(): void {
  cleanup();
}

function installPointerCaptureMock(): void {
  const elementProto = HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (pointerId: number) => boolean;
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
    scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
  };

  if (typeof elementProto.hasPointerCapture !== 'function') {
    elementProto.hasPointerCapture = () => false;
  }
  if (typeof elementProto.setPointerCapture !== 'function') {
    elementProto.setPointerCapture = () => {};
  }
  if (typeof elementProto.releasePointerCapture !== 'function') {
    elementProto.releasePointerCapture = () => {};
  }
  if (typeof elementProto.scrollIntoView !== 'function') {
    elementProto.scrollIntoView = () => {};
  }
}

function resolvedMapping(sourceTickerOrIsin: string): ResolvedMapping {
  const firstResult = DEFAULT_SEARCH_RESULTS[sourceTickerOrIsin]?.[0];
  return {
    sourceTickerOrIsin,
    symbol: firstResult?.canonicalSymbol ?? firstResult?.symbol ?? sourceTickerOrIsin,
    ...(firstResult?.canonicalExchangeMic ?? firstResult?.exchangeMic
      ? { exchangeMic: firstResult?.canonicalExchangeMic ?? firstResult?.exchangeMic }
      : {}),
    ...(firstResult?.providerId ? { providerId: firstResult.providerId } : {}),
    fromSaved: false,
  };
}

function symbolSearchResult(input: {
  symbol: string;
  exchangeName: string;
  exchangeMic?: string;
  providerId?: string;
}): SymbolSearchResult {
  return {
    symbol: input.symbol,
    canonicalSymbol: input.symbol,
    exchange: input.exchangeName,
    exchangeName: input.exchangeName,
    exchangeMic: input.exchangeMic,
    canonicalExchangeMic: input.exchangeMic,
    providerId: input.providerId,
  } as unknown as SymbolSearchResult;
}
