/**
 * Narrow, explicit allow-list of DEGIRO broker-bookkeeping rows that are
 * skipped (never become activities) but remain visible in review counts.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * Anything NOT matching one of these reasons AND not mapping to an activity or
 * group becomes `unsupported`, which blocks the batch. There is no catch-all
 * silent skip.
 */
export type SkipReason =
  /** Daily price ticks / conversions of the money-market fund (LU1959429272). */
  | 'money-market-fund'
  /** Internal cash sweep between DEGIRO trading balance and flatex bank. */
  | 'cash-sweep'
  /** Paired `overboeking` / `flatex terugstorting` flatex bank transfers. */
  | 'flatex-internal-transfer'
  /** Temporary iDEAL reservation hold pairing with a later deposit. */
  | 'reservation-hold'
  /** ISIN rename (`productwijziging`): paired buy+sell net to zero. */
  | 'isin-rename'
  /** Positive reversal side of a withdrawal / tax that nets to zero. */
  | 'positive-reversal'
  /** Currency-conversion leg (`valuta debitering/creditering`). */
  | 'fx-helper'
  /** Declared activity row with exactly zero economic amount. */
  | 'zero-amount'
  /** Standalone `Transactiekosten` fee with no parent trade order to merge into. */
  | 'orphan-trade-fee'
  /**
   * `Verrekening welkomstactie` promotional credit (v1 deferral; not modelled
   * as a deposit/income activity).
   */
  | 'promotional-credit'
  /**
   * `Coupon` on NL00… cash-equivalent bonds (v1 models equity dividends only;
   * deferred — revisit when bond income is in scope).
   */
  | 'cash-equivalent-coupon'
  /**
   * Bare `Rente` account-level interest bookkeeping with no ISIN; the economic
   * interest is captured by `flatex interest` INTEREST activities.
   */
  | 'account-interest-bookkeeping';

export const SKIP_REASONS: readonly SkipReason[] = [
  'money-market-fund',
  'cash-sweep',
  'flatex-internal-transfer',
  'reservation-hold',
  'isin-rename',
  'positive-reversal',
  'fx-helper',
  'zero-amount',
  'orphan-trade-fee',
  'promotional-credit',
  'cash-equivalent-coupon',
  'account-interest-bookkeeping',
];
