# Maintainer release guide

Releases are created from reviewed `vX.Y.Z` tags. GitHub Actions runs synthetic
checks only; the real-statement acceptance gate is deliberately local.

## Before tagging

1. Work from a clean `main` checkout.
2. Run the local acceptance gate with the real statement and ignored baseline:

   ```sh
   pnpm verify:release
   ```

3. Run the disposable Wealthfolio 3.6.1 installation tests against the exact
   ZIP that will be released.
4. Confirm the package, manifest, release notes, and sanitized attestation all
   contain the same version.
5. Run the public verification suite and privacy scan.

## Tag and publish

Create an exact semver tag from the approved commit:

```sh
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The tag workflow verifies tag syntax and ancestry, package versions, synthetic
tests, archive contents, deterministic rebuilds, runtime closure, and the
committed attestation. It publishes only the versioned ZIP, `SHA256SUMS`, and
reviewed release notes.

The workflow does not create or move tags. Do not retag an existing release.
Create a new version when a released artifact must change.

## After publication

Download the release assets again without relying on the local checkout, verify
`SHA256SUMS`, and repeat the disposable Wealthfolio installation test. Record
only aggregate pass/fail evidence. Production imports and VPS changes require
separate approval.
