# Wealthfolio SDK contract

This addon targets Wealthfolio 3.6.1 and uses the verified 3.6.x addon APIs:
account enumeration, account-scoped import mappings, market symbol search,
activity search, and bulk activity writes. Runtime host dependencies are
externalized according to `manifest.json`; parser dependencies are bundled.
The package validator enforces the Wealthfolio archive limits and runtime
asset closure.
