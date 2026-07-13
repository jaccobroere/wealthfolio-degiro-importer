# Roll back a release

A release rollback means choosing a previously published, verified addon
version. It does not mean moving or deleting a Git tag.

1. Download the older ZIP and its `SHA256SUMS` from GitHub Releases.
2. Verify the checksum:

   ```sh
   shasum -a 256 -c SHA256SUMS
   ```

3. Install the verified ZIP through Wealthfolio's addon installer.
4. Disable or remove the newer addon version if Wealthfolio requires it.
5. Re-run a small synthetic import and review the result before using personal
   data.

Imported activities are fingerprint-checked, so re-import behavior remains
duplicate-safe. Keep the failed release tag and notes intact for diagnosis.
