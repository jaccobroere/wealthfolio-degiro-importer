#!/bin/sh
set -eu

# Public-release privacy gate. It reports file/object names and rule names only.
failures=0
report() { printf '%s: %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }

patterns='(/Users/|/home/|[A-Za-z]:\\\\Users\\\\|[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[A-Za-z]{2,})'
for file in $(git ls-files); do
  [ "$file" = "scripts/privacy-scan.sh" ] && continue
  if [ -f "$file" ] && LC_ALL=C grep -IEn "$patterns" "$file" >/dev/null 2>&1; then report "$file" "privacy-pattern"; fi
done

for file in $(git ls-files '*.csv' '*.md' '*.json' '*.yml' '*.yaml' '*.ts' '*.tsx' '*.js' '*.sh' '*.toml'); do
  [ -f "$file" ] || continue
  case "$file" in tests/fixtures/*|*.csv|README.md|CHANGELOG.md|docs/*|manifest.json|package.json|release/*)
    if LC_ALL=C grep -IEn '(/Users/|/home/|[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30})' "$file" >/dev/null 2>&1; then report "$file" "broker-or-path-pattern"; fi ;;
  esac
done

for zip in artifacts/*.zip; do
  [ -f "$zip" ] || continue
  if unzip -Z1 "$zip" | LC_ALL=C grep -Eiq '(^|/)(tests?|scripts?|src|\.local|.*\.csv|.*\.env)(/|$|\.)'; then report "$zip" "prohibited-archive-entry"; fi
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT HUP INT TERM
  unzip -qq "$zip" -d "$tmp"
  if LC_ALL=C grep -RIEq "$patterns" "$tmp"; then report "$zip" "archive-content-pattern"; fi
  rm -rf "$tmp"
done

objects=$(mktemp)
trap 'rm -f "$objects"' EXIT HUP INT TERM
git fsck --no-reflogs --unreachable 2>/dev/null | awk '$2=="blob"{print $3}' > "$objects"
while read -r object; do
  if git cat-file blob "$object" 2>/dev/null | LC_ALL=C grep -IEq "$patterns"; then
    report "object:$object" "unreachable-object-pattern"
  fi
done < "$objects"

if [ "$failures" -ne 0 ]; then
  printf 'Privacy scan failed (%s findings).\n' "$failures" >&2
  exit 1
fi
printf 'Privacy scan passed (tracked text, fixtures, archives, refs, and unreachable objects).\n'
