import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const textFixture = /^(tests\/fixtures\/.*\.(?:csv|txt|json)|.*\.personal\.csv)$/i;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const iban = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i;
const account = /\b(?:account(?:\s*(?:number|no\.?))?\s*[:=]\s*|acct\s*[:=]\s*)\d{6,}\b/i;
const absoluteUserPath = /(?:^|["'\s])(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/i;
const uuidFilename =
  /(?:^|\/)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.csv$/i;

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => textFixture.test(file));
const forbidden = (process.env.FIXTURE_FORBIDDEN_TERMS ?? '')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
const failures: string[] = [];

for (const file of tracked) {
  const text = readFileSync(file, 'utf8');
  if (uuidFilename.test(file)) failures.push(`${file}: UUID-like source filename`);
  for (const [label, pattern] of Object.entries({ email, iban, account, absoluteUserPath })) {
    if (pattern.test(text)) failures.push(`${file}: likely ${label}`);
  }
  for (const term of forbidden) {
    if (text.includes(term)) failures.push(`${file}: configured forbidden term`);
  }
}

if (failures.length > 0) {
  console.error('Fixture privacy scan failed; remove or redact the flagged synthetic fixture.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Fixture privacy scan passed (${tracked.length} tracked synthetic text fixtures).`);
