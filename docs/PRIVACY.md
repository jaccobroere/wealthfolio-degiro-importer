# Privacy rules

These rules are binding for all code, tests, logs, and output in this addon.

## What is sensitive

All of the following are **sensitive** and must never be logged, printed,
serialized into committed files, or sent anywhere outside the user's machine:

- Raw CSV rows and parsed field values from a real broker statement.
- Filenames and absolute/relative paths of real statement files.
- Account identifiers (account numbers, IBANs, UUIDs).
- Balances, holdings, positions, quantities of held securities.
- Order ids, transaction ids, broker references.
- Tickers / ISINs / product names **in the context of a user's holdings**
  (synthetic fixture tickers are fine; a user's real holdings are not).
- Monetary totals from a real statement (aggregate acceptance invariants are
  reviewed counts only — see below).

## Output rules

- Inspector output (`pnpm inspect:csv`) and acceptance output
  (`pnpm acceptance:local`) are **summary-only**: row counts, activity-type
  counts, validation invariant booleans, and reconciliation conservation
  results. They never print row values, tickers, products, balances, order ids,
  filenames, or paths.
- A local **debug mode** may emit redacted/per-row detail only when explicitly
  enabled by a developer, and must redact values. It is never enabled in
  acceptance or release output.
- Logs (`ctx.api.logger`) never receive raw rows, identifiers, balances, or
  order ids. Logging is structural/diagnostic only.

## File rules

- Real statements are **never** committed, copied, or read from a tracked path.
  `.gitignore` ignores `/private-fixtures/`, `/local-fixtures/`, `/.local/`,
  `/Account.csv`, `/*.personal.csv`, `.env*` (except `.env.acceptance.example`).
- Only the upstream synthetic `example.csv` and manually reviewed synthetic
  fixtures are tracked as CSV. Verify with:
  `git ls-files '*.csv' '*.env' '*.zip'`.
- The acceptance environment variable (`DEGIRO_ACCEPTANCE_CSV`) holds an
  absolute path to the user's real statement. Only `.env.acceptance.example`
  (a placeholder) is committed.

## Acceptance output

Acceptance suites emit aggregate counts and invariants only — e.g. "1,133
source rows", "297 normalized activities", "zero unaccounted rows". They never
emit monetary totals, tickers, holdings, or any value that could reconstruct a
user's portfolio.
