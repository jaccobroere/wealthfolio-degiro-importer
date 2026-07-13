# wealthfolio-degiro-importer

A Wealthfolio 3.6.1 addon for Dutch-locale DEGIRO account-statement CSV files.
It provides explicit symbol review, duplicate-safe imports, and reconciliation.
The public repository contains synthetic fixtures only.

Supported development versions are Node 20.19.0 and pnpm 10.34.5. Run
`pnpm install`, then `pnpm test`, `pnpm build`, and `pnpm verify`. Verification
is synthetic and non-mutating. `pnpm acceptance:local` is private and requires
`DEGIRO_ACCEPTANCE_CSV` plus `DEGIRO_ACCEPTANCE_BASELINE`.

Install the versioned ZIP through Wealthfolio’s add-on installer after checking
its `SHA256SUMS`. Review symbols before import; saved mappings are account
scoped. Repeated and overlapping imports are fingerprint-safe. The importer
does not resolve unsupported schemas or ambiguous symbols automatically.

See `docs/PRIVACY.md`, `docs/RELEASE.md`, and `docs/INSTALL.md`. The upstream
MIT license and attribution are preserved in `LICENSE`, `NOTICE.md`, and
`UPSTREAM.md`.
