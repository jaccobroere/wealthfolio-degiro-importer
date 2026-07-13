# Development guide

## Requirements

- Node.js 20.19.0
- pnpm 10.34.5
- Wealthfolio 3.6.1 for disposable host tests

## Common commands

```sh
pnpm install
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` is the public, synthetic gate. It formats with `prettier
--check`, runs lint/type checks and tests, builds the addon, scans privacy
boundaries, validates the manifest, packages the ZIP, and validates the
archive.

## Fixtures

Synthetic fixtures live under `tests/fixtures` and must remain fictional. Keep
fixtures small and focused on one schema rule or import behavior. Do not copy a
real statement into the repository, even after redaction.

## Private acceptance

The real-statement gate is local only:

```sh
DEGIRO_ACCEPTANCE_CSV=/absolute/path/to/statement.csv \
DEGIRO_ACCEPTANCE_BASELINE=/absolute/path/to/baseline.json \
pnpm acceptance:local
```

Both files must exist. Their paths, contents, hashes, and exact results must
not be logged, committed, attached to CI, or included in release evidence.

## Host verification

The disposable Wealthfolio harness and its cleanup instructions are documented
in `tests/integration/README.md`. It must use only the pinned Wealthfolio image,
synthetic fixtures, loopback networking, and disposable storage.

## Pull requests

Keep parser behavior independent from React and the SDK where possible. Add a
synthetic fixture and focused test for every supported schema edge case. Update
the relevant user-facing format or limitation documentation when behavior
changes.
