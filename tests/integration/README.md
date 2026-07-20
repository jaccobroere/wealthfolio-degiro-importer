# Disposable Wealthfolio host

The host smoke test uses a pinned Wealthfolio 3.6.1 image, a loopback-only
port, and one disposable named volume. It has no production credentials,
network, or storage.

Run it with:

```sh
pnpm test:host
```

The command builds and validates the release ZIP, starts a clean host, imports
one synthetic cash CSV, then verifies a repeat import creates no activities.
It cleans up the host and volume automatically.

For host debugging only, the underlying commands remain available:

```sh
pnpm integration:up
pnpm integration:down
```
