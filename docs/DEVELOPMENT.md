# Development guide

## Requirements

- Node.js 22
- pnpm 10.34.5

## Everyday work

```sh
pnpm install
pnpm check
```

`pnpm check` is the only CI gate. It checks formatting, linting, types, all
synthetic Vitest tests, synthetic fixture privacy, the production build, and
the addon manifest. It does not start Docker, a browser, or package a release.

Use `pnpm package` when you need the release ZIP locally. It builds the addon,
creates the ZIP, and validates its contents and checksum.

## Fixtures

Synthetic fixtures live under `tests/fixtures` and must remain fictional. Keep
fixtures small and focused on one schema rule or import behavior. Do not copy a
real statement into the repository, even after redaction.

## Private acceptance

The real-statement parser check is local only:

```sh
DEGIRO_ACCEPTANCE_CSV=/absolute/path/to/statement.csv \
DEGIRO_ACCEPTANCE_BASELINE=/absolute/path/to/baseline.json \
pnpm acceptance:local
```

Both files must exist. Their paths and contents must not be committed or sent
to CI. This test exercises the parser directly; it does not start a host or
write imported activities.

## Host smoke test

`pnpm test:host` packages the current addon, starts an isolated pinned
Wealthfolio host, imports one synthetic cash CSV, and verifies the duplicate
import creates no activities. Run it before a release and after a host SDK
upgrade, not for every change.
