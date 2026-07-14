import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

type Manifest = {
  id: string;
  version: string;
  main: string;
  hostDependencies: Record<string, string>;
};
type ZipEntry = { name: string; compressed: number; uncompressed: number };
const MiB = 1024 * 1024;
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as Manifest;
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string;
  version: string;
};
const zipPath = `artifacts/${packageJson.name}-${packageJson.version}.zip`;

function fail(message: string): never {
  throw new Error(`Package validation failed: ${message}`);
}
function runtimeFiles(): string[] {
  const pending = [manifest.main];
  const files = new Set<string>();
  const reference = /(?:from\s*|import\s*\(|url\()\s*["'](\.\/?[^"')?#]+)["']/g;
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    if (!file.startsWith('dist/') || !existsSync(file)) fail(`runtime file is missing: ${file}`);
    files.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(reference)) {
      const target = posix.normalize(posix.join(posix.dirname(file), match[1]));
      if (!target.startsWith('dist/') || target.includes('..'))
        fail(`unsafe runtime reference: ${match[1]}`);
      pending.push(target);
    }
  }
  return [...files].sort();
}
function readZipEntries(file: string): ZipEntry[] {
  const data = readFileSync(file);
  const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) fail('ZIP end-of-directory is missing');
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) fail('ZIP central directory is malformed');
    const compressed = data.readUInt32LE(offset + 20);
    const uncompressed = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name, compressed, uncompressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
const runtime = runtimeFiles();
if (process.argv.includes('--print-runtime-files')) {
  process.stdout.write(`${runtime.join('\n')}\n`);
  process.exit(0);
}
if (manifest.version !== packageJson.version) fail('package and manifest versions disagree');
if (manifest.main !== 'dist/addon.js') fail('manifest main must be dist/addon.js');
if (!existsSync(zipPath)) fail(`missing ${zipPath}`);
const sumsPath = 'artifacts/SHA256SUMS';
if (!existsSync(sumsPath)) fail('missing artifacts/SHA256SUMS');
const checksum = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
if (
  !readFileSync(sumsPath, 'utf8').includes(`${checksum}  ${zipPath.slice('artifacts/'.length)}\n`)
)
  fail('SHA256SUMS does not match the ZIP');
const expected = ['README.md', 'manifest.json', ...runtime].sort();
const entries = readZipEntries(zipPath);
if (entries.length > 256) fail('archive contains more than 256 entries');
if (statSync(zipPath).size > 50 * MiB) fail('archive exceeds 50 MiB compressed limit');
for (const entry of entries) {
  if (
    !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(entry.name) ||
    entry.name.includes('..') ||
    entry.name.includes('\\')
  )
    fail(`unsafe archive path: ${entry.name}`);
  if (entry.uncompressed > 5 * MiB) fail(`entry exceeds 5 MiB: ${entry.name}`);
  if (/\.(?:map|csv|env|lock)$/i.test(entry.name) || /^(?:src|tests|scripts)\//.test(entry.name))
    fail(`prohibited archive content: ${entry.name}`);
}
if (entries.reduce((total, entry) => total + entry.uncompressed, 0) > 25 * MiB)
  fail('archive exceeds 25 MiB uncompressed limit');
const actual = entries.map((entry) => entry.name).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected))
  fail(`archive contents must exactly equal ${expected.join(', ')}`);
const bundle = readFileSync(manifest.main, 'utf8');
const bareImports = [...bundle.matchAll(/^import[^\n]*?from\s*["']([^"']+)["']/gm)].map(
  (match) => match[1],
);
if (bareImports.some((name) => name === 'papaparse' || name === 'decimal.js'))
  fail('broker parser dependencies must be bundled');
const root = (name: string) =>
  name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
if (bareImports.some((name) => !(root(name) in manifest.hostDependencies)))
  fail('bundle has a non-host external import');
for (const signature of ['delimitersToGuess', 'dynamicTyping']) {
  if (!bundle.includes(signature)) fail(`missing bundled parser signature: ${signature}`);
}
for (const hostImport of ['react', 'react-dom/client', '@wealthfolio/ui']) {
  if (
    !bareImports.includes(hostImport) &&
    !bareImports.some((name) => name.startsWith(`${hostImport}/`))
  )
    fail(`host dependency is not an ESM external: ${hostImport}`);
}

console.log(
  `Package validation passed (${entries.length} entries; ${statSync(zipPath).size} compressed bytes).`,
);
