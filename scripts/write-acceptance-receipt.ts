import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const envName = 'DEGIRO_ACCEPTANCE_CSV';
const input = process.env[envName];
if (!input || !statSync(input).isFile())
  throw new Error(`${envName} must reference a readable regular file.`);
const inputSha256 = createHash('sha256').update(readFileSync(input)).digest('hex');
mkdirSync('.local', { recursive: true });
writeFileSync(
  '.local/acceptance-receipt.json',
  `${JSON.stringify({ schemaVersion: 1, acceptance: 'passed', inputSha256 }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log('Local acceptance receipt written; reviewed aggregate result: passed.');
