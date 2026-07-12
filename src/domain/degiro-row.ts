/**
 * Domain model for a single physical DEGIRO account-statement row.
 *
 * Pure core: no React, no `Wealthfolio addon SDK` imports.
 *
 * The exported "Account statement" CSV has 12 actual columns despite only 10
 * named headers — both "Mutatie"/"Change" and "Saldo"/"Balance" secretly span a
 * currency column followed by an unlabelled amount column:
 *
 *   Datum/Date | Tijd/Time | Valutadatum/Value date | Product | ISIN |
 *   Omschrijving/Description | FX | Mutatie/Change (ccy) | Mutatie/Change (amt) |
 *   Saldo/Balance (ccy) | Saldo/Balance (amt) | Order Id
 *
 * Monetary quantities are kept as raw decimal strings (Dutch locale:
 * `.` = thousands separator, `,` = decimal mark). They are parsed on demand by
 * `parseDegiroDecimal()` so no floating-point ever touches money.
 */

/**
 * A single parsed DEGIRO row. `rowIndex` is the 1-based source-data line number
 * (header is line 0) and is used for provenance, fingerprints, and accounting.
 */
export interface DegiroRow {
  rowIndex: number;
  date: string; // DD-MM-YYYY as-is
  time: string; // HH:MM as-is
  valueDate: string; // DD-MM-YYYY as-is
  product: string;
  isin: string;
  description: string;
  /** Raw FX-rate string (Dutch decimal, e.g. "1,0920"). Empty when absent. */
  fxRaw: string;
  /** Currency of the change/mutation column (EUR, USD, …). */
  changeCurrency: string;
  /** Raw change/mutation amount string (Dutch decimal). Empty when absent. */
  changeAmountRaw: string;
  /** Currency of the running balance column. */
  balanceCurrency: string;
  /** Raw balance amount string (Dutch decimal). Empty when absent. */
  balanceAmountRaw: string;
  /** Broker order identifier. Empty for standalone rows. */
  orderId: string;
}

/** The 12 physical field positions in a DEGIRO account-statement data row. */
export const FIELD_COUNT = 12;

/** Known money-market fund ISIN (Morgan Stanley EUR Liquidity Fund). */
export const MONEY_MARKET_FUND_ISIN = 'LU1959429272';

/**
 * Flatex bank-account pseudo-ISIN used by older exports. The real statement
 * uses real NL00… bond ISINs for cash-equivalent coupons; those are matched by
 * description instead.
 */
export const FLATEX_ACCOUNT_ISIN = 'NLFLATEXACNT';

/**
 * Accepted header aliases (lower-cased, trimmed) for each physical position.
 * DEGIRO exports Dutch and English variants; both are supported. The two
 * unlabelled amount positions (8 and 10, 0-indexed) are always empty in the
 * header row.
 */
export const HEADER_ALIASES: readonly string[][] = [
  ['datum', 'date'], // 0
  ['tijd', 'time'], // 1
  ['valutadatum', 'value date'], // 2
  ['product'], // 3
  ['isin'], // 4
  ['omschrijving', 'description'], // 5
  ['fx'], // 6
  ['mutatie', 'change'], // 7
  [''], // 8 (unlabelled mutation amount)
  ['saldo', 'balance'], // 9
  [''], // 10 (unlabelled balance amount)
  ['order id'], // 11
];
