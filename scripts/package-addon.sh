#!/bin/sh
set -eu

PNPM=${PNPM:-pnpm}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

name=$($PNPM exec node -p "require('./package.json').name")
version=$($PNPM exec node -p "require('./package.json').version")
output="$ROOT/artifacts/$name-$version.zip"
stage=$(mktemp -d "${TMPDIR:-/tmp}/wealthfolio-addon.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

mkdir -p artifacts "$stage/dist"
rm -f "$output"
cp manifest.json README.md "$stage/"
runtime_files=$($PNPM exec tsx scripts/validate-package.ts --print-runtime-files | LC_ALL=C sort)
printf '%s\n' "$runtime_files" | while IFS= read -r file; do
  [ -n "$file" ] || continue
  mkdir -p "$stage/$(dirname "$file")"
  cp "$file" "$stage/$file"
  chmod 0644 "$stage/$file"
  touch -t 200001010000 "$stage/$file"
done
chmod 0644 "$stage/manifest.json" "$stage/README.md"
touch -t 200001010000 "$stage/manifest.json" "$stage/README.md"
(cd "$stage" && LC_ALL=C printf '%s\n' manifest.json README.md $runtime_files | LC_ALL=C sort | zip -X -q "$output" -@)
echo "Packaged addon ZIP."
