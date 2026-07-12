# NOTICE

This product includes software developed at the **shuisman/degiro-importer**
project (https://github.com/shuisman/degiro-importer).

- Upstream repository: https://github.com/shuisman/degiro-importer
- Upstream release: `v1.0.1`
- Base commit: `b6fa986a511352d9d14715425f85b197dd12efeb`
- Upstream license: MIT (preserved verbatim in `LICENSE`)

## Material modifications in this port

This fork (`jaccobroere/wealthfolio-degiro-importer`) adapts the upstream
DEGIRO parser to the Wealthfolio **3.6.1** addon sandbox and hardens it for
safe, duplicate-resistant imports. Material changes relative to the upstream
`v1.0.1` base:

- **Sandbox migration (SDK 3.3 → 3.6.1):** route registration via
  `ctx.router.add({ path, render })`, runtime sidebar item via
  `ctx.sidebar.addItem()` with cleanup in `ctx.onDisable()`, single owned
  React root (`react-dom/client`), manifest `permissions` as
  `{ category, functions: string[], purpose }`, host-provided ESM externals,
  and `activities.saveMany({ creates })` / `activities.checkImport()`.
- **Pure-core refactor:** parsing, classification, grouping, mapping,
  validation, duplicate fingerprints, and reconciliation are extracted into a
  React/SDK-independent core.
- **Localized decimal fix:** correct parsing of Dutch thousands-separated
  trade quantities (e.g. `1.861`, `2.707`, `7.117`, `1.771`).
- **Accrued-interest handling:** `Meegekochte Rente` rows are preserved as
  accrued-interest provenance rather than dropped as noise.
- **Duplicate / reconciliation additions:** deterministic source fingerprints
  and position/cash reconciliation before any write.
- **Removal of destructive clear:** the upstream "clear existing activities"
  path is removed; imports never send `deleteIds`.

The MIT license and upstream copyright notice are retained in `LICENSE`.
