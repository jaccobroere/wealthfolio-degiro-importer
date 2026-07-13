# Rollback

## Current status

No release is available to roll back. Version `1.1.0` remains blocked by T09.

## After a future approved release

If an installed release must be reverted, disable or remove that add-on in
Wealthfolio and install a previously verified ZIP from its immutable release.
Verify the selected ZIP against that release's `SHA256SUMS` before installing.

Do not overwrite an existing release, alter a historical tag, or reuse a
version number. Publish a new version for fixes. Re-import is duplicate-safe:
the importer skips rows whose fingerprints were already imported, so repeating
an unchanged statement after rollback does not intentionally create duplicate
activities. Review the importer result before confirming any new rows.
