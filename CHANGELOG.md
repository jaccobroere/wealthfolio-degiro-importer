# Changelog

Changes that affect users or maintainers are recorded here. Release-specific
notes live under [`docs/releases/`](docs/releases/).

## Unreleased

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
