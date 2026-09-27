# DEGIRO input format

The importer accepts the DEGIRO **Account statement** CSV export. It does not
accept the separate order, portfolio, or account-summary reports.

## Header

The physical row has twelve fields. Dutch and English names are accepted for
the named columns:

```text
Datum/Date,Tijd/Time,Valutadatum/Value date,Product,ISIN,Omschrijving/Description,FX,Mutatie/Change,,Saldo/Balance,,Order Id
```

The two empty header positions are the numeric amount fields paired with the
change and balance currencies. Header validation is strict about the schema,
while the Dutch and English aliases are interchangeable.

## Numeric values

DEGIRO localized values use a comma as the decimal mark and may use a period as
the thousands separator. Quantities, prices, amounts, FX values, and balances
are parsed as decimals rather than binary floating-point numbers.

## Supported activity families

The classifier recognizes buys, sells, trade fees, accrued interest, taxes,
deposits, withdrawals, dividends, account interest, standalone fees, and
foreign-exchange rows. Order-related rows are grouped by their order ID when
the statement provides one.

FX mutations produce two internal cash transfers with an explicit shared group.
Order-linked partial fills are aggregated in each currency; orderless conversions
use the exact date/time and value date. Missing or ambiguous companions block
review rather than silently losing cash. Conversions use Wealthfolio's bulk-create
API because its 3.6.1 import DTO cannot carry an explicit transfer group.

Coupons and positive interest are income; negative interest and dividend corrections
are charges. Tax/fee refunds and promotional credits are cash inflows. Nonzero
money-market-fund mutations are preserved as credits or charges; conversion
records without monetary changes remain bookkeeping.

Sweeps and Flatex transfer summaries move funds between the broker's internal
ledgers, so importing them again would double-count the same cash. Positive
processed-withdrawal entries paired with Flatex refund bookkeeping also remain
skipped. The consolidated full-history cash target is the latest Flatex bank
balance, not a stale historical trading-ledger balance. Partial exports require
the account's opening cash; the importer does not manufacture it.

Some broker bookkeeping rows are intentionally skipped because they do not
represent a Wealthfolio activity. Every row receives a visible outcome; an
unknown or invalid row blocks the import until it is understood.
