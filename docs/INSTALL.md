# Install and use the DEGIRO importer

## Before you start

- Wealthfolio 3.6.1 or a compatible later release.
- A DEGIRO **Account statement** CSV export.
- The addon ZIP and matching `SHA256SUMS` from the same GitHub Release.

## Verify and install

Download both release assets into one directory and verify the checksum:

```sh
shasum -a 256 -c SHA256SUMS
```

Continue only when the command reports a match. In Wealthfolio, open the addon
installer/settings, choose the verified ZIP, and enable the addon.

## Import a statement

1. Open the DEGIRO importer from the Wealthfolio addon navigation.
2. Choose the DEGIRO Account statement CSV.
3. Choose the destination Wealthfolio account.
4. Review instrument mappings. Search results are suggestions, not automatic
   approval.
5. Resolve validation, unsupported-row, and duplicate warnings.
6. Review the reconciliation summary.
7. Confirm the import only when the result matches your expectations.

The importer does not write activities while you are selecting a file or
reviewing mappings. Re-import checks run before the final write.

## If an import is blocked

- Confirm that the file is an **Account statement**, not an order, portfolio,
  or transaction-summary report.
- Keep the original exported CSV unchanged and export it again if the header
  does not match the [supported format](FORMAT.md).
- Resolve every unknown instrument and unsupported row shown by the review.
- If the checksum does not match, download the release assets again.

For a reproducible bug report, attach a small synthetic fixture or a redacted
description. Do not attach a personal statement.
