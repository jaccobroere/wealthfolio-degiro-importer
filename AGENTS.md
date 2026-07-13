# AGENTS.md

Orientation for coding agents working in this repository.

## What this is

A Wealthfolio **3.6.1** addon that imports DEGIRO account-statement CSV exports.
Ported from `shuisman/degiro-importer` `v1.0.1`
(commit `b6fa986a511352d9d14715425f85b197dd12efeb`, MIT). See `NOTICE.md` and
`UPSTREAM.md`.

## Toolchain

- Node `20.19.0` (`.nvmrc`), pnpm `10.34.5` (`packageManager`).
- Use `pnpm`, never npm. The lockfile is frozen and committed.
- `pnpm type-check`, `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm format`.

## Pure-core boundary (non-negotiable)

Files under `src/domain`, `src/parser`, `src/mapping`, `src/validation`,
`src/duplicates`, and `src/reconciliation` **must not** import React or the
Wealthfolio SDK (`@wealthfolio/addon-sdk`). Only the Wealthfolio adapter layer
(`src/wealthfolio`) and the UI sandbox shell may import SDK/React.

Run this check before considering core work done:

```bash
rg -n 'from ["'']react|@wealthfolio/addon-sdk' \
  src/domain src/parser src/mapping src/validation src/duplicates src/reconciliation
# must return no matches
```

## Money and parsing

- Use `decimal.js` with decimal strings for all financial arithmetic. Never use
  floating-point for money. DEGIRO uses Dutch locale: `.` = thousands separator,
  `,` = decimal mark.
- Use `papaparse` for CSV mechanics. Both `papaparse` and `decimal.js` are
  **bundled** runtime dependencies (they are NOT host externals — see
  `manifest.json` `hostDependencies` and `vite.config.ts`).

## Privacy rules (non-negotiable)

Never log or emit raw rows, filenames, account identifiers, balances, holdings,
or order ids. Inspector/acceptance output is summary-only (counts and
invariants) unless a local, redacted debug mode is explicitly enabled. See
`docs/PRIVACY.md`.

Real statements are **never** committed and never copied into the repository.
They are referenced by absolute path only, through the `DEGIRO_ACCEPTANCE_CSV`
environment variable (see `.env.acceptance.example`). Ordinary `pnpm test` uses
synthetic fixtures only; `pnpm acceptance:local` is a local release gate.

## Approval gates (separate from this code)

Repository visibility, GitHub Actions enablement, release publication,
production installation, and VPS pinning are each **separate explicit approval
gates**. Do not enable Actions, publish a release, change visibility, or install
in production without explicit authorization. Disposable Wealthfolio integration
precedes release.
