# Install

## Current status

There is no published `1.1.0` release. Installation is blocked pending the T09
release proof described in `RELEASE.md`.

## After a future approved release

1. Download the versioned ZIP directly from that immutable release; do not
   rebuild the archive locally.
2. Download the matching `SHA256SUMS` file and verify the ZIP with
   `shasum -a 256 -c SHA256SUMS`.
3. In Wealthfolio, choose the add-on installer and select the verified ZIP.
4. Import through the add-on review flow. Re-importing the same rows is
   duplicate-safe: already imported fingerprints are skipped.

The expected artifact convention is
`wealthfolio-degiro-importer-<version>.zip`, with its checksum recorded in the
same release's `SHA256SUMS`.
