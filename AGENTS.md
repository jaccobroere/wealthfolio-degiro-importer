# AGENTS.md

AI agent guide for this repository. Covers behavioral rules, architecture, and
common task playbooks.

---

## Behavioral Guidelines

**These come first because they prevent the most mistakes.**

### 1. Think Before Coding

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### 2. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

### 3. Surgical Changes

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated issues, mention them — don't fix them.
- Remove only what YOUR changes made unused.

### 4. Goal-Driven Execution

- Transform tasks into verifiable goals.
- For multi-step tasks, state a brief plan with verification steps.
- Unverified work is incomplete work.

### 5. Output Precision

- Lead with findings, not process descriptions.
- Use structured formats (lists, tables, code blocks).
- Include absolute file paths — never relative.

---

## Overview

A Wealthfolio addon that parses DeGiro account statement CSV files and imports
activities. Pure TypeScript/React — no backend, no server, runs entirely inside
the Wealthfolio addon sandbox.

- **Parser**: `src/parser/` — CSV → structured rows → `ActivityImport` objects
- **UI**: `src/components/` — multi-step import wizard
- **SDK**: `@wealthfolio/addon-sdk` v3.3.0 — the only runtime dependency

---

## Code Layout

```
src/
├── addon.tsx               # Entry point — registers sidebar item and route
├── types.ts                # Re-exports from @wealthfolio/addon-sdk
└── parser/
│   ├── csv.ts              # Raw CSV → DeGiroRow[]
│   ├── mapper.ts           # DeGiroRow[] → ActivityImport[]
│   ├── symbols.ts          # Extract unique ISINs, apply ticker mappings
│   └── openfigi.ts         # Optional: ISIN → ticker via OpenFIGI API
└── components/
    ├── ImporterPage.tsx     # Orchestrator: idle → mapping → review → done
    ├── SymbolMappingStep.tsx# ISIN auto-search, suggestion chips, Accept/Reject
    ├── ActivityTable.tsx    # Editable review table
    └── FileUpload.tsx       # Drag-drop CSV upload
```

### Key data flow

```
CSV file
  → parseCsv()          [csv.ts]      DeGiroRow[]
  → mapToActivities()   [mapper.ts]   ActivityImport[]  (pre-mapping)
  → SymbolMappingStep                 user confirms ISIN → ticker
  → applyMappings()     [symbols.ts]  ActivityImport[]  (post-mapping)
  → api.activities.saveMany()         imported into Wealthfolio
```

---

## Run Targets

| Task              | Command                              |
| ----------------- | ------------------------------------ |
| Dev (watch)       | `npm run dev`                        |
| Build             | `npm run build`                      |
| Bundle (zip)      | `npm run bundle`                     |
| Smoke-test parser | `npx tsx test-parse.mts Account.csv` |

`npm run bundle` produces `degiro-importer.zip` — install via Wealthfolio →
Settings → Addons → Install from file.

---

## Agent Playbook

### Adding a new DeGiro transaction type

1. **Classify** — add a `RowKind` variant and a `classify()` branch in
   `src/parser/mapper.ts`. Match on `row.description.toLowerCase()`.
2. **Map** — add a `case` in `processStandaloneRow()` (or extend
   `processOrderGroup()` if it has an Order Id).
3. **Smoke-test** — run `npx tsx test-parse.mts Account.csv` and verify the
   new type appears in the summary counts.
4. **Document** — add the Dutch description and Wealthfolio type to the table
   in `README.md`.

### Fixing a CSV parsing edge case

The DeGiro CSV has 12 columns but only 10 named headers. See the comment block
at the top of `src/parser/csv.ts`. `Mutatie` and `Saldo` each hide a currency
column. Numbers use European locale (`,` decimal, `.` thousands). Dates are
`DD-MM-YYYY`.

1. Reproduce with `npx tsx test-parse.mts Account.csv`.
2. Edit `parseCsv()` or `parseAmount()` in `src/parser/csv.ts`.
3. Re-run smoke test; check row counts match expectations.

### Changing the symbol mapping UI

All symbol mapping logic lives in `src/components/SymbolMappingStep.tsx`.

- Parent (`SymbolMappingStep`) owns `mappings` (confirmed) and `suggestions`
  (pending) state.
- `RowEditor` is the per-row component. It auto-searches on mount via
  `api.market.searchTicker()`, surfaces one suggestion at a time.
- `filterResults()` strips symbols that are the ISIN itself or contain spaces.
- Auto-confirm fires when exactly one currency-matching result is found.
- Confirmed tickers are saved via `api.activities.saveImportMapping()` so they
  persist across imports.

### Changing how activities are created

Activities are sent to Wealthfolio via `api.activities.saveMany({ creates })`.
Do **not** use `api.activities.import()` — it returns `success=false` from the
addon sandbox for unknown reasons.

`ActivityCreate` requirements (hard-won):
- `activityDate`: `YYYY-MM-DD` string — no time component, no timezone suffix.
- `asset.quoteCcy`: required for **all** activity types, including cash ones.
- Cash activities: `asset: { quoteCcy: currency }` (no `symbol`).
- Stock activities: `asset: { symbol: ticker, quoteCcy: currency }`.

---

## DeGiro CSV Quirks

| Quirk | Detail |
|---|---|
| Hidden columns | 12 actual columns, 10 named — `Mutatie` and `Saldo` each have an unlabelled currency column |
| Numbers | European locale: `.` thousands, `,` decimal |
| Dates | `DD-MM-YYYY` |
| Partial fills | Grouped by Order Id — aggregate quantity, weighted-average price |
| Fees | `Transactiekosten` rows share an Order Id with their trade; merged into `fee` |
| FTT | `Transactiebelasting` reversed same-day — only import negative amounts |
| Money market | `LU1959429272` (Morgan Stanley EUR Liquidity) — always skipped |
| ISIN renames | `WIJZIGING ISIN` rows — always skipped |

---

## Transaction Type Mapping

| Dutch description | Wealthfolio type |
|---|---|
| `Koop N @ P CCY` | `BUY` |
| `Verkoop N @ P CCY` | `SELL` |
| `Transactiekosten` | fee field of parent trade |
| `Transactiebelasting` (negative) | `TAX` |
| `Dividendbelasting` | `TAX` |
| `flatex Storting` / `iDEAL storting` | `DEPOSIT` |
| `Processed Flatex Withdrawal` (negative) | `WITHDRAWAL` |
| `Dividend` | `DIVIDEND` |
| `Flatex Interest` | `INTEREST` |
| `Service-fee` / `Aansluitingskosten` / `B.T.W` | `FEE` |
| Cash Sweep / Overboeking / WIJZIGING ISIN | skipped |

---

## Conventions

- **No comments** unless the *why* is non-obvious. Never describe what the code does.
- **No speculative abstractions** — three similar lines beats a premature helper.
- **Functional React** — hooks only, no class components.
- **Types** — import from `src/types.ts` (re-exports from addon-sdk); do not
  import from `@wealthfolio/addon-sdk` directly in components.
- **Rounding** — `round2()` for amounts and fees, `round3()` for unit prices.
- **Dates** — always `YYYY-MM-DD`; use `toIsoDate()` from `csv.ts`.

---

## Validation Checklist

Before completing any task:

- [ ] `npm run build` passes (TypeScript + Vite, zero errors)
- [ ] `npx tsx test-parse.mts Account.csv` output matches expected activity counts
- [ ] No personal financial data (CSV files) staged for commit
- [ ] Changes are minimal and surgical

---

When in doubt, follow the nearest existing pattern in the file you are editing.
