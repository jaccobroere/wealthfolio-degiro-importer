# wealthfolio-degiro-importer

A [Wealthfolio](https://github.com/wealthfolio/wealthfolio) **3.6.1** addon that
imports DEGIRO account-statement CSV exports with explicit symbol review,
duplicate-safe imports, and full row-level reconciliation.

This is a port of [`shuisman/degiro-importer`](https://github.com/shuisman/degiro-importer)
(upstream release `v1.0.1`, base commit `b6fa986a511352d9d14715425f85b197dd12efeb`,
MIT licensed — see `NOTICE.md` and `UPSTREAM.md` for attribution and the list of
material changes).

## Status

Private. Targeted at Wealthfolio host `3.6.1`. Initial release version `1.1.0`.
Addon id `degiro-importer`; route `/addon/degiro-importer`.

## Requirements

- Node `20.19.0` (see `.nvmrc`) — the scaffold pins `vite@^7.1.5`, which requires
  Node 20.19+ or 22.12+.
- pnpm `10.34.5` (pinned via `packageManager`).

## Install dependencies

```bash
pnpm install
```

## Common scripts

```bash
pnpm build          # vite build -> dist/addon.js
pnpm dev            # vite build --watch
pnpm type-check     # tsc --noEmit
pnpm test           # vitest run (synthetic fixtures only)
pnpm lint
pnpm format
```

Scripts wired in later tasks: `pnpm inspect:csv`, `pnpm acceptance:local`,
`pnpm verify`, `pnpm verify:release`.

## Privacy

This addon never logs raw rows, filenames, account identifiers, balances, or
order ids. See `docs/PRIVACY.md`. Real DEGIRO statements are **never** committed;
only the upstream synthetic `example.csv` and manually reviewed synthetic
fixtures live in this repository.

The local acceptance test reads a real statement through an environment variable
only — see `.env.acceptance.example`:

```bash
cp .env.acceptance.example .env   # gitignored
# edit .env to point DEGIRO_ACCEPTANCE_CSV at your real Account.csv
```

## Documentation

- `docs/SDK-CONTRACT.md` — verified Wealthfolio 3.6.1 host/SDK contract.
- `docs/PRIVACY.md` — privacy rules for code and output.
- `NOTICE.md` / `UPSTREAM.md` — upstream attribution and material changes.

## License

MIT. Upstream copyright `(c) 2025 shuisman` is preserved in `LICENSE`.
