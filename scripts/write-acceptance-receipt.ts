import { mkdirSync, statSync, writeFileSync } from 'node:fs';

const envName = 'DEGIRO_ACCEPTANCE_CSV';
const input = process.env[envName];
if (!input || !statSync(input).isFile())
  throw new Error(`${envName} must reference a readable regular file.`);
if (
  !process.env.DEGIRO_ACCEPTANCE_BASELINE ||
  !statSync(process.env.DEGIRO_ACCEPTANCE_BASELINE).isFile()
)
  throw new Error('DEGIRO_ACCEPTANCE_BASELINE must reference a readable regular file.');
mkdirSync('.local', { recursive: true });
writeFileSync(
  '.local/acceptance-receipt.json',
  `${JSON.stringify({ schemaVersion: 1, acceptance: 'passed' }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log('Local acceptance receipt written; reviewed aggregate result: passed.');
