#!/usr/bin/env tsx
/**
 * Privacy-safe DEGIRO CSV inspector.
 *
 * Reads ONE account-statement CSV by absolute path and prints summary-only
 * output (counts and invariants) unless `--redacted-debug` is explicitly passed.
 * NEVER prints raw rows, products, tickers, balances, order ids, or monetary
 * totals by default. The real statement should be referenced via an absolute
 * path argument (typically `$DEGIRO_ACCEPTANCE_CSV`).
 *
 * Usage:
 *   pnpm inspect:csv -- /absolute/path/to/Account.csv [--summary-only]
 */

import { readFileSync, statSync } from 'node:fs';
import { parseAndMapWithFingerprints } from '../src/parser/parse-and-map';

interface CliArgs {
  csvPath: string | null;
  summaryOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let summaryOnly = false;
  for (const arg of argv.slice(2)) {
    if (arg === '--') continue; // end-of-options separator (pnpm/npm pass it through)
    if (arg === '--summary-only') summaryOnly = true;
    else if (arg.startsWith('--')) {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    } else positional.push(arg);
  }
  return { csvPath: positional[0] ?? null, summaryOnly };
}

function main(): void {
  const args = parseArgs(process.argv);
  if (!args.csvPath) {
    console.error('Usage: inspect:csv -- <path-to-Account.csv> [--summary-only]');
    console.error('Tip: DEGIRO_ACCEPTANCE_CSV=/abs/path pnpm inspect:csv -- "$DEGIRO_ACCEPTANCE_CSV" --summary-only');
    process.exit(2);
  }

  let stat;
  try {
    stat = statSync(args.csvPath);
  } catch {
    console.error(`cannot read input file (use an absolute path via $DEGIRO_ACCEPTANCE_CSV)`);
    process.exit(1);
  }
  if (!stat.isFile()) {
    console.error('input path is not a regular file');
    process.exit(1);
  }

  const content = readFileSync(args.csvPath, 'utf-8');
  // `--summary-only` is accepted for scripting parity; the inspector never
  // prints raw data regardless (privacy rules in AGENTS.md / docs/PRIVACY.md).
  void args.summaryOnly;
  parseAndMapWithFingerprints(content)
    .then((r) => {
      printSummary(r);
      const fatal =
        r.batch.summary.unsupportedCount > 0 ||
        r.batch.summary.invalidCount > 0 ||
        r.batch.summary.unaccountedCount !== 0 ||
        r.hasFingerprintCollision;
      process.exit(fatal ? 1 : 0);
    })
    .catch((err) => {
      console.error('inspection failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

function printSummary(
  r: Awaited<ReturnType<typeof parseAndMapWithFingerprints>>,
): void {
  const { batch, reconciliation } = r;
  const s = batch.summary;

  console.log('=== DEGIRO import summary ===');
  console.log(`source rows:        ${s.sourceRowCount}`);
  console.log(`activities:         ${s.activityCount}`);
  console.log(`unaccounted:        ${s.unaccountedCount}`);
  console.log(`unsupported:        ${s.unsupportedCount}`);
  console.log(`invalid:            ${s.invalidCount}`);
  console.log(`fingerprint collide:${r.fingerprintCollisions.size}`);
  console.log(`overlap clusters:   ${r.overlapClusterCount} (${r.overlapActivityCount} activities)`);

  console.log('--- by outcome ---');
  for (const [k, v] of Object.entries(s.byOutcome)) console.log(`  ${k.padEnd(14)} ${v}`);

  console.log('--- by activity type ---');
  for (const [k, v] of Object.entries(s.byActivityType).sort()) console.log(`  ${k.padEnd(10)} ${v}`);

  console.log('--- known-skip reasons ---');
  for (const [k, v] of Object.entries(s.skipReasons).sort()) console.log(`  ${k.padEnd(28)} ${v}`);

  console.log('--- reconciliation (counts only) ---');
  console.log(`distinct instrument positions: ${reconciliation.positions.length}`);
  console.log(`currencies touched:           ${reconciliation.cashByCurrency.length}`);
  console.log(`accrued-interest activities:  ${reconciliation.accruedInterestActivityCount}`);
  console.log(`accrued-interest source rows: ${reconciliation.accruedInterestSourceRowCount}`);
  console.log(`BUY drafts w/ accrued (T09):  ${reconciliation.buyDraftsWithAccruedInterestCount}`);
  console.log(`known internal movements:     ${reconciliation.knownInternalMovementCount}`);
}

main();
