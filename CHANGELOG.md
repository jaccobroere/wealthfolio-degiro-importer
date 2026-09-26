# Changelog

Changes that affect users or maintainers are recorded here. Release-specific
notes live under [`docs/releases/`](docs/releases/).

## 1.6.0 — 2026-09-26

- Changed: security search is broad (ISIN/ticker, related tickers and names)
  and listings are ranked by instrument, then traded currency, then preferred
  exchanges. "Accept suggested listings" replaces the single-result bulk
  action and only takes a same-instrument listing in the traded currency that
  is strictly first on exchange preference.
- Added: a free-text search per security, richer result details (exchange,
  MIC, currency, name), and changing a confirmed mapping.
- Added: preferred exchanges, editable and saved per account.
- Added: "Forget remembered mappings" for the selected account.
- Fixed: remembered euro listings were reported as stale because they were
  re-verified against a search that only returns the primary listing.

## 1.5.1 — 2026-09-25

- Fixed: same-day repeats of cash-type activities (e.g. equal dividend tax on
  two securities) were still collapsed, because Wealthfolio ignores the
  security for deposits, withdrawals, fees, taxes and credits.
- Fixed: cash-type rows carrying an ISIN no longer trigger security creation.
- Changed: trades are matched against the account on quantity rather than
  trade value, so copies stored with a different unit price still match.

## 1.5.0 — 2026-09-25

- Fixed: re-importing a full DEGIRO history added duplicate dividends and
  trades. Activities are now matched against the destination account on type,
  day, currency and value before writing, independent of source row numbers
  and of whether the security existed at the earlier import.
- Fixed: activities for a security Wealthfolio did not know yet were stored
  without a security (Wealthfolio 3.6.1's import endpoint never creates
  assets). The importer now seeds the security through `activities.saveMany`
  and links the remaining activities to it; it never imports an instrument
  activity without its security. Adds the `activities.saveMany` permission.
- Fixed: repeated identical same-day activities (e.g. three equal dividend
  credits) were collapsed into one by Wealthfolio's import duplicate key. The
  2nd and later copies now carry a numbered comment and are all imported.
- Fixed: the activity that seeds a new security no longer passes DEGIRO's
  trade-currency-per-EUR rate as Wealthfolio's `fxRate`, which booked foreign
  trades' cash in EUR at the inverse rate.
- Added: an _Already in Wealthfolio_ section in the reconcile step with new /
  already-present counts and lists of extra copies and unlinked activities
  already on the account.
- Changed: review and reconcile show the mapped ticker and exchange, with the
  product name and ISIN, instead of the ISIN alone.

## 1.4.0 — 2026-09-15

- Added: fix problem rows in the review step instead of editing the CSV. Any
  row expands into per-row controls to edit its source values (with a live
  preview of the resulting outcome) or ignore it. Ignored rows are accounted as
  `user-ignored` skips so row conservation still holds; activities built from
  edited rows carry a warning, and the reconcile step summarizes every change
  before acknowledgement. Overrides are never written back to the source file.
- Added: `Inkomsten uit Securities Lending` rows are classified as INTEREST.
  They previously blocked the import as unrecognized.
- Added: `tests/fixtures/degiro-realistic-statement.csv`, a 200-row synthetic
  statement with a golden test asserting outcome counts, per-ledger balance
  integrity, and fingerprint stability.
- Fixed: three order-group mapping paths could leave a row with no outcome,
  breaking row conservation and hiding the row from review — an orphan group
  dropped accrued-interest rows, a zero-quantity group dropped fee/FX/tax/
  accrued rows, and a positive in-group `Transactiebelasting` row was dropped
  entirely. Group mapping now exits through a single guard that accounts for
  every input row.

## 1.2.7

- Added a strongly masked, instrument-bearing account-statement fixture and
  disposable-host E2E proof for mapping, `activities.import`, persistence, and
  duplicate re-import.
- CI now builds the current declared add-on archive and runs the browser E2E
  suite against the pinned Wealthfolio 3.6.1 host.

## 1.3.0 — 2026-08-03

- Fixed: large DEGIRO statements (>=200 activities) failing at the final
  submit step. The host import call is now chunked (default 100/ chunk);
  per-chunk failures surface as per-row failures instead of a fatal; only a
  complete host outage is fatal. Privacy-safe: counts only in any log
  surface.
- Fixed: the add-on's `api.activities.import(...)` call was being rewritten
  by the 3.6.1 host sandbox's `es-module-lexer` rewriter into a
  `globalThis.__wealthfolioImport(...)` call, which the host then rejected as
  an unknown method. The add-on now dispatches via `Reflect.get` so the
  `import` identifier is not in the call position of the minified bundle.
  The 3.6.1 host image SHA is recorded in the source.
- Added: a 250-row synthetic cash fixture and a disposable-host Playwright
  test exercising the chunked-import path end-to-end against the real
  Wealthfolio 3.6.1 host.

## 1.2.7

- Added a strongly masked, instrument-bearing account-statement fixture and
  disposable-host E2E proof for mapping, `activities.import`, persistence, and
  duplicate re-import.
- CI now builds the current declared add-on archive and runs the browser E2E
  suite against the pinned Wealthfolio 3.6.1 host.

## 1.2.4

- Made stale remembered mappings visible, replaceable, and safely removable
  within the selected account.
- Added a return-to-mapping recovery path after a host-level bulk-write
  rejection, without automatic partial retries.

## 1.2.3

- Added bulk confirmation for unambiguous security mappings, represents
  accrued-interest settlements as cash activity, and preserves checked host
  activities through import.
- Removed the release self-attestation artifact; release publication now relies
  on reproducible public validation and package checks.

## 1.2.2

- Restored the runtime sidebar entry and `/addon/degiro-importer` route required
  by the Wealthfolio 3.6.1 host. This makes the importer visible and reachable
  after installation.

## 1.2.1

- Same as 1.2.0 (the v1.2.0 tag was burned: its release workflow failed on an
  attestation-version mismatch before any artifact was published).

## 1.2.0

- Manifest-declared sidebar navigation (`contributes.links.sidebar`); runtime
  registers only the route renderer whose id matches the manifest route id.
- Host dependencies derived from the SDK `HOST_DEPENDENCIES` map (single source
  of truth across Vite externals, manifest, and peer dependencies).
- Source-level sandbox-contract scan rejecting browser storage and direct
  networking APIs.
- `@wealthfolio/addon-sdk` dev dependency pinned to `~3.6.1`.
- No change to import parsing semantics.

## 1.1.0

- Public-safe synthetic fixtures and local-only real-statement acceptance.
- Account-scoped symbol mapping review and duplicate-safe imports.
- Deterministic versioned ZIP packaging, checksums, privacy scanning, and
  tag-based release validation.
