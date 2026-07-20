# Changelog

Changes that affect users or maintainers are recorded here. Release-specific
notes live under [`docs/releases/`](docs/releases/).

## 1.2.7

- Added a strongly masked, instrument-bearing account-statement fixture and
  disposable-host E2E proof for mapping, `activities.import`, persistence, and
  duplicate re-import.
- CI now builds the current declared add-on archive and runs the browser E2E
  suite against the pinned Wealthfolio 3.6.1 host.

## 1.2.4

- Made stale remembered mappings visible, replaceable, and safely removable
  within the selected account.
- Added a return-to-mapping recovery path after a host-level bulk-write
  rejection, without automatic partial retries.

## 1.2.3

- Added bulk confirmation for unambiguous security mappings, represents
  accrued-interest settlements as cash activity, and preserves checked host
  activities through import.
- Removed the release self-attestation artifact; release publication now relies
  on reproducible public validation and package checks.

## 1.2.2

- Restored the runtime sidebar entry and `/addon/degiro-importer` route required
  by the Wealthfolio 3.6.1 host. This makes the importer visible and reachable
  after installation.

## 1.2.1

- Same as 1.2.0 (the v1.2.0 tag was burned: its release workflow failed on an
  attestation-version mismatch before any artifact was published).

## 1.2.0

- Manifest-declared sidebar navigation (`contributes.links.sidebar`); runtime
  registers only the route renderer whose id matches the manifest route id.
- Host dependencies derived from the SDK `HOST_DEPENDENCIES` map (single source
  of truth across Vite externals, manifest, and peer dependencies).
- Source-level sandbox-contract scan rejecting browser storage and direct
  networking APIs.
- `@wealthfolio/addon-sdk` dev dependency pinned to `~3.6.1`.
- No change to import parsing semantics.

## 1.1.0

- Public-safe synthetic fixtures and local-only real-statement acceptance.
- Account-scoped symbol mapping review and duplicate-safe imports.
- Deterministic versioned ZIP packaging, checksums, privacy scanning, and
  tag-based release validation.
