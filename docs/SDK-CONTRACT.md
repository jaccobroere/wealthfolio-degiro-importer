# Wealthfolio integration contract

This addon targets Wealthfolio 3.6.1 and the 3.6.x addon SDK contract.

## Host capabilities used

- manifest-declared sidebar navigation (`contributes.links.sidebar`) plus one
  route renderer registered at runtime with an id (`main`) that exactly matches
  `contributes.routes[].id` in the manifest, with cleanup of addon state on
  disable;
- account enumeration for destination selection;
- activity lookup and import checks for duplicate safety;
- account-scoped import mapping persistence;
- market-data search for user-reviewed instrument identities;
- bulk activity writes after validation and reconciliation.

The manifest declares these permissions and the purpose of each one. Sidebar
navigation is manifest-declared (`contributes.links.sidebar`); the runtime
registers only the route renderer and does not call `ctx.sidebar.addItem`.
Host dependencies are externalized according to `manifest.json`; parser
dependencies are bundled into the release runtime closure.

## Compatibility policy

The supported host baseline is Wealthfolio 3.6.1. The manifest-declared
navigation model (`contributes.routes` + `contributes.links`) and the preferred
host-managed `component` route model are 3.6.1+ features (3.6.0 removed
`RouteConfig.component`; 3.6.1 restored it as preferred and added manifest
contributions). A change to addon routes, permission names, activity payloads,
or host dependency behavior requires an explicit compatibility review and
release-note entry.

This file describes the integration boundary for contributors. It is not a
replacement for Wealthfolio's official addon documentation.
