# Wealthfolio integration contract

This addon targets Wealthfolio 3.6.1 and the 3.6.x addon SDK contract.

## Host capabilities used

- runtime sidebar navigation plus one sandboxed route renderer, both using
  `/addon/degiro-importer`, with cleanup of the navigation item and addon state
  on disable;
- account enumeration for destination selection;
- activity lookup and import checks for duplicate safety;
- account-scoped import mapping persistence;
- market-data search for user-reviewed instrument identities;
- bulk activity writes after validation and reconciliation.

The manifest declares these permissions and the purpose of each one. The 3.6.1
host builds add-on navigation at runtime, so this addon calls
`ctx.sidebar.addItem` as well as `ctx.router.add`.
Host dependencies are externalized according to `manifest.json`; parser
dependencies are bundled into the release runtime closure.

## Compatibility policy

The supported host baseline is Wealthfolio 3.6.1. Its sandboxed SDK uses the
`render` callback route model and runtime sidebar registration; later host
versions use a different declarative-navigation model. A change to addon
routes, permission names, activity payloads, or host dependency behavior
requires an explicit compatibility review and release-note entry.

This file describes the integration boundary for contributors. It is not a
replacement for Wealthfolio's official addon documentation.
