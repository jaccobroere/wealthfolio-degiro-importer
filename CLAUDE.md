# CLAUDE.md — DeGiro Importer for Wealthfolio

Project context for Claude Code. Read this before touching anything.

---

## What this is

A Wealthfolio addon (TypeScript/React, Vite) that parses DeGiro's Dutch-locale
Account Statement CSV and imports activities into Wealthfolio via the addon SDK.

The addon is a single bundled JS file (`dist/addon.js`) loaded by Wealthfolio.
No backend, no server — everything runs inside the Wealthfolio addon sandbox.

---

## Build & test

```bash
npm run build           # tsc --noEmit + vite build → dist/addon.js
npm run bundle          # build + PowerShell zip → degiro-importer.zip (Windows only)
npm run dev             # vite build --watch
npx tsx test-parse.mts Account.csv   # smoke-test parser without Wealthfolio
```

Install in Wealthfolio: Settings → Addons → Install from file → select zip.

---

## Key file map

| File | Purpose |
|---|---|
| `src/addon.tsx` | Entry point — `enable(ctx)` registers sidebar + route |
| `src/types.ts` | Re-exports from `@wealthfolio/addon-sdk` — import from here, not the SDK directly |
| `src/parser/csv.ts` | Raw CSV text → `DeGiroRow[]` |
| `src/parser/mapper.ts` | `DeGiroRow[]` → `ActivityImport[]` |
| `src/parser/symbols.ts` | Extract unique ISINs, apply ticker mappings |
| `src/parser/openfigi.ts` | ISIN → ticker via OpenFIGI API (available but not wired up) |
| `src/components/ImporterPage.tsx` | Orchestrator: idle → mapping → review → importing → done |
| `src/components/SymbolMappingStep.tsx` | ISIN lookup + confirm step |
| `src/components/ActivityTable.tsx` | Editable review table |
| `src/components/FileUpload.tsx` | Drag-drop CSV upload |

---

## SDK API — confirmed working patterns

### Use `saveMany`, NOT `activities.import()`

`api.activities.import()` always returns `success=false` from the addon sandbox
for unknown reasons. Use `api.activities.saveMany({ creates: ActivityCreate[] })`
instead. It returns `{ created: Activity[], errors: ActivityBulkMutationError[] }`.

### `ActivityCreate` requirements (hard-won)

- `activityDate`: must be `YYYY-MM-DD` string — datetime strings without
  timezone (e.g. `"2020-04-21T09:30:00"`) are rejected with "Invalid date format".
  Always strip the time component.
- `asset.quoteCcy`: **required for ALL activity types**, including cash ones
  (DEPOSIT/WITHDRAWAL/FEE/INTEREST). Error if missing: "Quote currency is required".
  - Cash: `asset: { quoteCcy: currency }` — no `symbol` field.
  - Stock: `asset: { symbol: ticker, quoteCcy: currency }`.
- `accountId`: set per-activity in `ImporterPage` before import.

### Import mapping persistence

- `api.activities.getImportMapping(accountId)` → `{ symbolMappings: Record<string, string> }`
- `api.activities.saveImportMapping({ accountId, symbolMappings, fieldMappings: {}, activityMappings: {}, accountMappings: {} })`
- Saved per account — switching accounts reloads mappings.

### Sidebar / routing

- `ctx.sidebar.addItem({ id, label, icon, route, order })` — `icon` must be a
  `React.createElement('svg', ...)` element, NOT a string.
- `ctx.router.add({ path, component })` — route must start with `/addons/`.
- `manifest.json` uses `"main": "addon.js"` (zip puts files at root, not `dist/`).

---

## DeGiro CSV quirks

The "Account statement" export has **12 actual columns but only 10 named headers**.
`Mutatie` and `Saldo` each secretly span two columns (currency + amount):

```
Datum | Tijd | Valutadatum | Product | ISIN | Omschrijving | FX
  | Mutatie (ccy) | Mutatie (amt) | Saldo (ccy) | Saldo (amt) | Order Id
```

- Numbers: European locale — `.` thousands separator, `,` decimal.
- Dates: `DD-MM-YYYY`. Times: `HH:MM` (no timezone — always Europe/Amsterdam).
- Trades come in groups by Order Id (partial fills + fee row share the same id).
- French FTT (`Transactiebelasting`) is sometimes reversed same-day — only
  import negative amounts.

---

## Transaction type mapping

| Dutch description | Wealthfolio type | Notes |
|---|---|---|
| `Koop N @ P CCY` | `BUY` | Aggregated by Order Id |
| `Verkoop N @ P CCY` | `SELL` | Aggregated by Order Id |
| `Transactiekosten` | fee on trade | Merged into parent trade's `fee` field |
| `Transactiebelasting` (negative) | `TAX` | French FTT — positive = reversal, skip |
| `Dividendbelasting` | `TAX` | Dividend withholding tax |
| `flatex Storting` / `iDEAL storting` | `DEPOSIT` | |
| `Processed Flatex Withdrawal` (negative) | `WITHDRAWAL` | Positive = cancellation, skip |
| `Dividend` | `DIVIDEND` | |
| `Flatex Interest` | `INTEREST` | Can be negative (charged) |
| `Service-fee` / `Aansluitingskosten` / `B.T.W` | `FEE` | |
| Cash Sweep / Overboeking / WIJZIGING ISIN | skip | Internal noise |
| ISIN `LU1959429272` | skip | Morgan Stanley money market fund |
| ISIN `NLFLATEXACNT` | skip | Flatex bank account representation |

---

## Symbol mapping step

`SymbolMappingStep` is the ISIN → ticker confirmation step between CSV upload
and activity review.

**Architecture:**
- Parent owns `mappings: Record<string, string>` (confirmed tickers) and
  `suggestions: Record<string, SymbolSearchResult>` (pending, needs user action).
- Each `RowEditor` auto-searches on mount via `api.market.searchTicker(isin)`.
- `filterResults()` strips results where `symbol === isin` or symbol contains
  spaces or is longer than 15 chars (those are product names, not tickers).
- If exactly **one** currency-matching result → auto-confirm silently.
- If **multiple** → surface a suggestion chip with Accept (✓) / Skip (✕).
- **"Accept all (N)"** button bulk-accepts all pending suggestions.
- Confirmed mappings are persisted via `saveImportMapping` so repeat imports skip this step.
- `onMouseDown={e => e.preventDefault()}` on dropdown items prevents the input
  blur from firing before the click, which would clear the selection.

**isValidTicker:** `!t.includes(' ') && t.length <= 15` — rejects full product
names that old auto-confirm code may have saved as tickers.

**OpenFIGI** (`src/parser/openfigi.ts`) is available as a more reliable
ISIN → ticker resolver (batch POST to `api.openfigi.com/v3/mapping`, free, no
key needed). Not wired into the UI currently — can be added if the market data
provider doesn't support ISIN search.

---

## Rounding

- `round2()` — amounts and fees (2 decimal places).
- `round3()` — unit prices (3 decimal places).

---

## Smoke test results (Account.csv, 820 rows)

280 activities: 142 BUY, 74 DEPOSIT, 21 SELL, 12 DIVIDEND, 11 FEE,
8 INTEREST, 7 TAX, 5 WITHDRAWAL — all 280 created successfully via `saveMany`.
