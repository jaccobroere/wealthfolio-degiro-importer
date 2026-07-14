# DEGIRO Importer for Wealthfolio

Import a DEGIRO **Account statement** CSV into Wealthfolio with a review step
for symbols, reconciliation before writing, and duplicate-safe imports.

This addon is designed for Wealthfolio 3.6.1+. It reads a file exported from
DEGIRO locally; it does not connect to DEGIRO and does not send your statement
to a service.

[Install](docs/INSTALL.md) · [Input format](docs/FORMAT.md) · [Privacy](docs/PRIVACY.md) · [Contributing](CONTRIBUTING.md)

## Compatibility

- Wealthfolio: >= 3.6.1
- Add-on SDK: 3.6.x (built against ~3.6.1)
- Tested with Wealthfolio: 3.6.2

| Component     | Supported version or format                            |
| ------------- | ------------------------------------------------------ |
| Wealthfolio   | >= 3.6.1                                               |
| Addon package | `wealthfolio-degiro-importer-<version>.zip`            |
| Source file   | DEGIRO **Account statement** CSV                       |
| License       | MIT; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) |

## Install a release

1. Download the addon ZIP and `SHA256SUMS` from a GitHub Release.
2. Verify the download:

   ```sh
   shasum -a 256 -c SHA256SUMS
   ```

3. Install the verified ZIP from Wealthfolio's addon settings.
4. Open the DEGIRO importer and follow the review steps before importing.

See the complete [installation guide](docs/INSTALL.md).

## Import workflow

1. Export an **Account statement** CSV from DEGIRO.
2. Select the file and the Wealthfolio account that should receive the data.
3. Review every detected instrument and confirm ticker/exchange mappings.
4. Inspect validation messages and the reconciliation summary.
5. Import only after the review is complete.

Saved mappings are scoped to the selected Wealthfolio account. Repeating the
same import, or importing overlapping date ranges, is protected by stable row
fingerprints and import checks.

## What is supported

The importer understands the DEGIRO account-statement schema in Dutch and
English header variants, including localized numeric values. Supported
activity families include:

- buys and sells, including grouped order fees and accrued-interest rows;
- dividends, taxes, fees, deposits, withdrawals, and account interest;
- foreign-exchange rows used by the statement format.

Known broker bookkeeping rows may be reported as intentionally skipped. Invalid
or unsupported rows remain visible in the review and block an unsafe import;
they are never silently discarded.

See [the input-format reference](docs/FORMAT.md) for the exact headers and
supported behavior.

## Safety and privacy

- The addon processes the selected CSV locally inside Wealthfolio.
- Symbols are reviewed explicitly; the addon does not guess silently.
- Duplicate and overlapping imports are checked before writes.
- Reconciliation and row accounting are shown before import.
- This public repository contains synthetic fixtures only. Real statements and
  local acceptance baselines are never committed or published.

Read the [privacy policy](docs/PRIVACY.md) for the repository and release
guarantees.

## Limitations

- Only the DEGIRO **Account statement** export is supported; other DEGIRO
  reports are not interchangeable.
- Instrument mapping still requires user review and a Wealthfolio market-data
  match.
- The addon does not provide investment, tax, or accounting advice.
- A release ZIP is an addon package, not a standalone broker client.

## Development

```sh
pnpm install
pnpm verify
```

Public verification uses synthetic fixtures. Real-statement acceptance is a
separate local-only gate. See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[development guide](docs/DEVELOPMENT.md).

## Attribution

This addon is maintained as a Wealthfolio port of the DEGIRO importer. Upstream
license, copyright, and attribution are preserved in [LICENSE](LICENSE),
[NOTICE.md](NOTICE.md), and [UPSTREAM.md](UPSTREAM.md).
