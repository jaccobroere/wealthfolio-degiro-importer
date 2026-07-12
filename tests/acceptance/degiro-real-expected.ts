/**
 * Reviewed, non-sensitive aggregate expectations and invariants for the supplied
 * real DEGIRO Account.csv. Contains ONLY counts, presence flags, and structural
 * invariants — never raw rows, products, tickers, balances, monetary totals,
 * order ids, or filenames.
 *
 * Locked values come from the verified planning evidence (PLAN.md T03 /
 * IDEA.md) and MUST be produced exactly by the pure core on the supplied file.
 * Any change in the host statement that shifts these counts fails the local
 * release gate visibly.
 */

export const EXPECTED = {
  /** Parsed source rows (excludes the header line). */
  sourceRowCount: 1133,
  /** Normalized activities before symbol resolution. */
  activityCount: 297,
  /** Per-type activity counts (sum must equal activityCount). */
  byActivityType: {
    BUY: 52,
    SELL: 24,
    DIVIDEND: 148,
    TAX: 27,
    DEPOSIT: 22,
    FEE: 15,
    INTEREST: 8,
    WITHDRAWAL: 1,
  } as Record<string, number>,
  /**
   * Corrected grouped BUY quantities for the four Dutch thousands-separated
   * trade rows (period = thousands separator). Identified by synthetic position
   * tags here; the test resolves them by matching the parsed quantity strings
   * against this set.
   */
  localizedBuyQuantities: ['1861', '2707', '7117', '1771'],
  /** Number of grouped BUY drafts that carry accrued-interest provenance. */
  buyDraftsWithAccruedInterest: 4,
  /** Distinct source rows behind accrued-interest provenance (Meegekochte Rente). */
  accruedInterestSourceRowCount: 4,
  /** Fatal outcome counts — all must be zero. */
  unsupported: 0,
  invalid: 0,
  unaccounted: 0,
  fingerprintCollisions: 0,
} as const;

/** Env var that points at the real statement (absolute path, never committed). */
export const ACCEPTANCE_ENV = 'DEGIRO_ACCEPTANCE_CSV';
