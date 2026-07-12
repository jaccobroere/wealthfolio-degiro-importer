import { readFileSync, readdirSync } from 'node:fs';

type Manifest = {
  id: string;
  version: string;
  main: string;
  sdkVersion: string;
  minWealthfolioVersion: string;
  hostDependencies: Record<string, string>;
  permissions: Array<{ category: string; functions: string[]; purpose: string }>;
  contributes?: unknown;
};

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as Manifest;
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
  peerDependencies: Record<string, string>;
};
const expectedId = 'degiro-importer';
const expectedPermissions: Record<string, string[]> = {
  ui: ['sidebar.addItem', 'router.add', 'onDisable'],
  accounts: ['getAll'],
  activities: ['getAll', 'checkImport', 'saveMany', 'getImportMapping', 'saveImportMapping'],
  'market-data': ['searchTicker'],
};

function fail(message: string): never {
  throw new Error(`Manifest validation failed: ${message}`);
}

if (manifest.id !== expectedId) fail(`id must be ${expectedId}`);
if (manifest.version !== packageJson.version) fail('version must match package.json');
if (manifest.main !== 'dist/addon.js') fail('main must be dist/addon.js');
if (manifest.sdkVersion !== '3.6.1' || manifest.minWealthfolioVersion !== '3.6.1') {
  fail('sdkVersion and minWealthfolioVersion must be 3.6.1');
}
if (manifest.contributes !== undefined)
  fail('contributes is unsupported; register routes through the host API');
if (JSON.stringify(manifest.hostDependencies) !== JSON.stringify(packageJson.peerDependencies)) {
  fail('hostDependencies must exactly match package.json peerDependencies');
}
const permissions = Object.fromEntries(
  manifest.permissions.map((permission) => [permission.category, permission.functions]),
);
if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions))
  fail('permissions do not match the approved host contract');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${directory}/${entry.name}`)
      : [`${directory}/${entry.name}`],
  );
}
if (
  sourceFiles('src').some(
    (file) => /\.[tj]sx?$/.test(file) && /\bcomponent\s*:/.test(readFileSync(file, 'utf8')),
  )
) {
  fail('source-level component route registration is unsupported');
}
console.log('Manifest validation passed.');
