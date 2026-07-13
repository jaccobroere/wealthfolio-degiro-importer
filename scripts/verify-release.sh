#!/bin/sh
set -eu

PNPM=${PNPM:-pnpm}
if [ -z "${DEGIRO_ACCEPTANCE_CSV:-}" ] || [ ! -f "$DEGIRO_ACCEPTANCE_CSV" ] || [ -z "${DEGIRO_ACCEPTANCE_BASELINE:-}" ] || [ ! -f "$DEGIRO_ACCEPTANCE_BASELINE" ]; then
  echo 'DEGIRO_ACCEPTANCE_CSV and DEGIRO_ACCEPTANCE_BASELINE must reference readable local files.' >&2
  exit 1
fi
git diff --quiet && git diff --cached --quiet || { echo 'Release verification requires a clean Git tree.' >&2; exit 1; }

$PNPM verify
if ! $PNPM acceptance:local -- --reporter=dot --silent >/dev/null 2>&1; then
  echo 'Local acceptance failed; no statement contents, filename, or path were emitted.' >&2
  exit 1
fi
$PNPM clean
$PNPM build
$PNPM package:addon
$PNPM validate:package
(cd artifacts && shasum -a 256 "wealthfolio-degiro-importer-$($PNPM exec node -p "require('./package.json').version")".zip > SHA256SUMS)
$PNPM exec tsx scripts/write-acceptance-receipt.ts
git diff --quiet && git diff --cached --quiet || { echo 'Release verification changed tracked files.' >&2; exit 1; }
