#!/bin/sh
set -eu

PNPM=${PNPM:-pnpm}

if [ -z "${DEGIRO_ACCEPTANCE_CSV:-}" ] || [ ! -f "$DEGIRO_ACCEPTANCE_CSV" ] || [ -z "${DEGIRO_ACCEPTANCE_BASELINE:-}" ] || [ ! -f "$DEGIRO_ACCEPTANCE_BASELINE" ]; then
  echo 'DEGIRO_ACCEPTANCE_CSV and DEGIRO_ACCEPTANCE_BASELINE must reference readable local files.' >&2
  exit 1
fi

git diff --quiet && git diff --cached --quiet || {
  echo 'Release verification requires a clean Git tree.' >&2
  exit 1
}

$PNPM check
$PNPM acceptance:local
$PNPM test:host
