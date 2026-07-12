#!/bin/sh
set -eu

PNPM=${PNPM:-pnpm}
if [ -z "${DEGIRO_ACCEPTANCE_CSV:-}" ] || [ ! -f "$DEGIRO_ACCEPTANCE_CSV" ]; then
  echo 'DEGIRO_ACCEPTANCE_CSV must reference a readable real statement before release verification.' >&2
  exit 1
fi

$PNPM verify
if ! $PNPM acceptance:local -- --reporter=dot --silent >/dev/null 2>&1; then
  echo 'Local acceptance failed; no statement contents, filename, or path were emitted.' >&2
  exit 1
fi
$PNPM clean
$PNPM build
$PNPM package:addon
$PNPM validate:package
(cd artifacts && shasum -a 256 "wealthfolio-degiro-importer-1.1.0.zip" > SHA256SUMS)
$PNPM exec tsx scripts/write-acceptance-receipt.ts
