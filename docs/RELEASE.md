# Maintainer release guide

## Before tagging

1. Work from a clean `main` checkout that has passed CI.
2. Run the one local release gate with your private statement and reviewed
   baseline:

   ```sh
   pnpm release:check
   ```

   It runs `check`, direct private-CSV acceptance, packages the ZIP, and runs
   the one disposable-host smoke test.

3. Confirm `package.json`, `manifest.json`, and `docs/releases/` have the same
   version.

## Tag and publish

```sh
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The tag workflow confirms the tag and versions, packages the tagged `main`
commit once, validates the archive, and publishes the ZIP, checksum, and
release notes. It does not repeat CI, private acceptance, or browser testing.

The workflow does not create or move tags. Create a new version when a released
artifact must change.
