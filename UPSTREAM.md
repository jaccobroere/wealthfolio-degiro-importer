# Upstream provenance

This repository is a fork/port of **shuisman/degiro-importer**.

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/shuisman/degiro-importer |
| Upstream release | `v1.0.1` |
| Base commit | `b6fa986a511352d9d14715425f85b197dd12efeb` |
| Upstream license | MIT |
| Upstream `LICENSE` | preserved verbatim in this repository |

## How this repository tracks upstream

- `upstream` remote points at `https://github.com/shuisman/degiro-importer.git`.
- `origin` remote points at `https://github.com/jaccobroere/wealthfolio-degiro-importer.git`.
- Upstream tags (`v1.0.0`, `v1.0.1`) and full history are retained.
- The first downstream commit on `main` establishes the 3.6.1 baseline
  (licensing, privacy, toolchain, and package normalization).

## Verify the base commit

```bash
git cat-file -e 'b6fa986a511352d9d14715425f85b197dd12efeb^{commit}' && echo "base commit present"
git remote -v
git tag --list
```

## Material port changes

See `NOTICE.md` for the list of material modifications relative to the
upstream `v1.0.1` base (3.3 → 3.6.1 sandbox migration, pure-core refactor,
localized-decimal fix, accrued-interest handling, duplicate/reconciliation
additions, and removal of the destructive clear path).

## Upstream synthetic fixture

`example.csv` is the upstream-committed synthetic DEGIRO statement and is
retained as the baseline parser fixture (moved into `tests/fixtures/` in T03).
It contains no real personal data.
