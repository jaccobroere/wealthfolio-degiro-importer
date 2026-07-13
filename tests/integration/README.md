# Disposable Wealthfolio 3.6.1 integration host

This harness is exclusively for the DEGIRO add-on T09 gate. It starts the
pinned `wealthfolio/wealthfolio:3.6.1` image by digest with project name
`wf-degiro-addon-test`, one disposable named volume
`wf-degiro-addon-test-data`, and a loopback-only port (`127.0.0.1:18088` by
default). It does not use any external Docker network, production hostname,
volume, account, or credential.

The host has one committed **synthetic, disposable** login only:
`T09-disposable-password`. Its test-only Argon2id hash is in the Compose file
solely because Wealthfolio requires an authenticated session to manage add-ons.

## Run

```sh
pnpm integration:up
pnpm integration:down
```

## Browser E2E

`pnpm test:e2e` starts and tears down this same pinned, loopback-only Compose
project itself. It verifies the SHA256SUMS-validated release ZIP (never `dist/`),
installs it, exercises route lifecycle, and uses only committed synthetic CSVs
and a disposable account. The suite is deliberately sequential (`workers: 1`).

```sh
pnpm test:e2e
```

The suite has no screenshots, videos, traces, HTML dumps, or raw-console
capture. A real statement is never read unless its absolute path is explicitly
provided. The opt-in parse-only run does not select an account or perform any
mapping, reconciliation, or write:

```sh
DEGIRO_ACCEPTANCE_CSV=/absolute/path/to/Account.csv pnpm test:e2e:acceptance
```

The browser-visible host cannot expose bridge call ordering or stored metadata.
The E2E suite proves write outcomes and duplicate behavior; the direct
`checkImport`-before-`saveMany` call ordering remains covered by
`tests/wealthfolio/import-flow.test.ts` until the host offers an auditable API.

The suite also proves the 3.6.1 bulk mutation failure boundary with a direct,
authenticated mixed cash-only request. It first captures the exact bulk route
and host-accepted cash create shape from the installed ZIP, removes only the
required cash `asset.quoteCcy` from the second create, and verifies HTTP 400
plus a zero authenticated-search count delta. It creates no asset or instrument
and global teardown removes the disposable volume.

The synthetic mapping-persistence test restarts only the `wealthfolio` service
without deleting the named disposable volume, then global teardown removes the
entire project. It saves a mapping configuration only—never an asset or an
activity—and proves the host returns it after restart. The accrued-interest
fixture explicitly selects a returned canonical identity for a generic
host-supported test instrument, but remains gated because the source-confirmed
valuation-history response returned no entries for the installed-importer
synthetic scenario.

Before any browser proof, validate the exact release archive
`artifacts/wealthfolio-degiro-importer-1.1.0.zip` against
`artifacts/SHA256SUMS`. The harness never tests `dist/` or a
loose add-on bundle.

For the optional local personal-statement parse-only gate, set
`DEGIRO_ACCEPTANCE_CSV` to an absolute path. The test uploads that file through
the installed add-on UI, asserts only the reviewed aggregate summary, and
never proceeds to mapping, reconciliation, or import/write actions. The path,
file name, contents, screenshots, traces, HTML, network bodies, and raw
console output are not captured.

## Cleanup

Always run `pnpm integration:down`. It deletes only this Compose project's
containers and its explicitly named disposable test volume:

```sh
pnpm integration:down
```
