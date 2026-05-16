# DeGiro Importer for Wealthfolio

A [Wealthfolio](https://wealthfolio.app) addon that imports your DeGiro account
statement CSV into Wealthfolio activities.

---

## Features

- Imports **buys, sells, dividends, deposits, withdrawals, fees, and taxes**
- Handles DeGiro's Dutch-locale CSV format (European numbers, `DD-MM-YYYY` dates)
- Aggregates **partial fills** by Order ID with weighted-average price
- Merges broker **transaction fees** into the parent trade
- Skips noise: cash sweeps, money market fund ticks, ISIN renames
- **Symbol mapping step**: auto-searches each ISIN via your configured market
  data provider and asks you to confirm the ticker before importing
- Timestamps interpreted as **Europe/Amsterdam** time (CET / CEST)
- Saves ticker mappings per account so repeat imports skip the confirmation step

---

## Installation

1. Download the latest `degiro-importer.zip` from
   [Releases](../../releases/latest).
2. Open Wealthfolio → **Settings → Addons → Install from file**.
3. Select the downloaded zip.

---

## Usage

**Export from DeGiro**

1. Log in to DeGiro.
2. Go to **Inbox → Account statement**.
3. Select your date range and click **Download** (CSV format).

**Import into Wealthfolio**

1. Open the **DeGiro Importer** addon from the Wealthfolio sidebar.
2. Upload the CSV file.
3. On the **Map symbols** step, review the auto-suggested ticker for each ISIN.
   - A single unambiguous match is confirmed automatically.
   - Multiple matches show a suggestion chip — click **✓** to accept or **✕**
     to skip (the ISIN will import as a custom asset).
   - Use **Accept all** to confirm all pending suggestions at once.
   - You can also type a ticker manually in the search box.
4. On the **Review activities** step, select the destination account.
5. Click **Import**.

---

## Supported transaction types

| DeGiro description | Wealthfolio type |
|---|---|
| `Koop N @ P CCY` | BUY |
| `Verkoop N @ P CCY` | SELL |
| `Transactiekosten` | fee on parent trade |
| `Transactiebelasting` (negative only) | TAX |
| `Dividendbelasting` | TAX |
| `flatex Storting` / `iDEAL storting` / `Storting` | DEPOSIT |
| `Processed Flatex Withdrawal` (negative) | WITHDRAWAL |
| `Dividend` | DIVIDEND |
| `Flatex Interest` | INTEREST |
| `Service-fee` / `Aansluitingskosten` / `B.T.W` | FEE |
| Cash Sweep / Overboeking / WIJZIGING ISIN | skipped |

---

## Building from source

```bash
npm install
npm run build      # type-check + bundle → dist/addon.js
npm run bundle     # build + zip → degiro-importer.zip
```

To smoke-test the parser without Wealthfolio:

```bash
npx tsx test-parse.mts /path/to/Account.csv
```

---

## Contributing

Bug reports and pull requests are welcome. Please:

- Open an issue before starting significant work.
- Keep changes minimal and surgical — see [AGENTS.md](AGENTS.md) for coding
  conventions used in this project.
- Never commit personal financial data (CSV exports).

---

## License

[MIT](LICENSE)
