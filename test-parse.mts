import { readFileSync } from 'fs';
import { parseCsv } from './src/parser/csv';
import { mapToActivities } from './src/parser/mapper';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: npx tsx test-parse.mts <path-to-Account.csv>');
  process.exit(1);
}

const content = readFileSync(csvPath, 'utf-8');
const rows = parseCsv(content);
const activities = mapToActivities(rows);

console.log(`\nParsed ${rows.length} rows → ${activities.length} activities\n`);

// Summary by type
const byType = activities.reduce<Record<string, number>>((acc, a) => {
  acc[a.activityType] = (acc[a.activityType] ?? 0) + 1;
  return acc;
}, {});
console.log('By type:');
console.table(byType);

// Invalid activities (missing symbol etc.)
const invalid = activities.filter(a => !a.isValid);
if (invalid.length) {
  console.warn(`\n⚠ ${invalid.length} invalid activities:`);
  invalid.forEach(a => console.warn(' ', JSON.stringify(a.errors), '→', a.activityType, a.date));
} else {
  console.log('\n✓ All activities valid');
}

// First 10 rows as a preview
console.log('\nFirst 10 activities:');
const preview = activities.slice(0, 10).map(a => ({
  date:   String(a.date ?? '').slice(0, 10),
  type:   a.activityType,
  symbol: a.symbol ?? '',
  qty:    a.quantity,
  price:  a.unitPrice,
  fee:    a.fee,
  amount: a.amount,
  ccy:    a.currency,
}));
console.table(preview);
