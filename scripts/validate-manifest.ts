import { readFileSync, readdirSync } from 'node:fs';
import { HOST_DEPENDENCIES } from '@wealthfolio/addon-sdk/host-dependencies';

type Manifest = {
  id: string;
  version: string;
  main: string;
  sdkVersion: string;
  minWealthfolioVersion: string;
  hostDependencies: Record<string, string>;
  permissions: Array<{ category: string; functions: string[]; purpose: string }>;
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
  activities: ['getAll', 'checkImport', 'import', 'getImportMapping', 'saveImportMapping'],
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

// --- host dependencies (single source of truth: SDK HOST_DEPENDENCIES) ------
// manifest.hostDependencies MUST exactly match the SDK's exported
// HOST_DEPENDENCIES, which is also what vite.config.ts externalizes. This
// prevents drift between the manifest, the build, and the package.json peer
// dependencies. Keep package.json peerDependencies in sync too (asserted
// below).
if (JSON.stringify(manifest.hostDependencies) !== JSON.stringify(HOST_DEPENDENCIES)) {
  fail('hostDependencies must exactly match @wealthfolio/addon-sdk HOST_DEPENDENCIES');
}
if (JSON.stringify(manifest.hostDependencies) !== JSON.stringify(packageJson.peerDependencies)) {
  fail('hostDependencies must exactly match package.json peerDependencies');
}

// --- permissions -------------------------------------------------------------
const permissions = Object.fromEntries(
  manifest.permissions.map((permission) => [permission.category, permission.functions]),
);
if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
  fail('permissions do not match the approved host contract');
}
const uiFunctions = permissions.ui ?? [];
if (!uiFunctions.includes('sidebar.addItem')) {
  fail('sidebar.addItem must be requested for the Wealthfolio 3.6.1 runtime sidebar');
}

// --- source-level checks -----------------------------------------------------
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${directory}/${entry.name}`)
      : [`${directory}/${entry.name}`],
  );
}

const addonSrc = readFileSync('src/addon.tsx', 'utf8');
// The runtime route id must match the manifest's single declared route id.
// The addon may pass a string literal (`id: 'main'`) or a const reference
// (`id: ROUTE_ID`). Resolve a top-level `const ROUTE_ID = '...'` first, then
// fall back to a literal in the router.add call.
const expectedRouteId = 'main';
const constMatch = addonSrc.match(/const\s+ROUTE_ID\s*=\s*['"]([^'"]+)['"]/);
const routeIdLiteral = addonSrc.match(/ctx\.router\.add\(\s*\{[^}]*\bid:\s*['"]([^'"]+)['"]/s);
let runtimeRouteId: string | undefined;
if (routeIdLiteral) {
  runtimeRouteId = routeIdLiteral[1];
} else {
  // Look for `id: ROUTE_ID` (a const reference) and resolve via the const decl.
  const routeIdRef = addonSrc.match(/ctx\.router\.add\(\s*\{[^}]*\bid:\s*([A-Za-z_$][\w$]*)/s);
  if (routeIdRef && constMatch) {
    runtimeRouteId = constMatch[1];
  } else if (routeIdRef) {
    fail(`could not resolve runtime route id "${routeIdRef[1]}" (no const declaration found)`);
  }
}
if (runtimeRouteId === undefined) {
  fail('src/addon.tsx must call ctx.router.add({ id: "..." })');
}
if (runtimeRouteId !== expectedRouteId) {
  fail(`runtime route id "${runtimeRouteId}" must equal "${expectedRouteId}"`);
}
if (!addonSrc.includes("const ROUTE_PATH = '/addon/degiro-importer'")) {
  fail('src/addon.tsx must register the /addon/degiro-importer route');
}
if (!/sidebar\.addItem\s*\(/.test(addonSrc)) {
  fail('src/addon.tsx must register its sidebar item at runtime');
}
// The published 3.6.1 SDK supports only the `render` route model; the
// `component` model is unreleased (3.6.2). Reject `component:` in source so a
// future contributor does not adopt an API that does not exist on the targeted
// host. Revisit when 3.6.2 ships.
if (
  sourceFiles('src').some(
    (file) => /\.[tj]sx?$/.test(file) && /\bcomponent\s*:/.test(readFileSync(file, 'utf8')),
  )
) {
  fail('source-level component route registration is unsupported on the 3.6.1 SDK (render only)');
}

// --- sandbox contract: no browser storage or direct external networking -----
// The opaque-origin sandbox throws on localStorage/sessionStorage/indexedDB,
// and direct fetch/XHR/WebSocket/EventSource are blocked by CSP. Addons must
// use ctx.api.storage and ctx.api.network.request respectively. This scan
// covers the addon's OWN source only (bundled third-party code like papaparse
// may legitimately reference XMLHttpRequest in an unused download fallback).
const forbiddenSandboxApis = [
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bfetch\s*\(/,
];
for (const file of sourceFiles('src')) {
  if (!/\.[tj]sx?$/.test(file)) continue;
  const src = readFileSync(file, 'utf8');
  for (const pattern of forbiddenSandboxApis) {
    if (pattern.test(src)) {
      fail(`src/${file.replace(/^src\//, '')} references forbidden sandbox API: ${pattern.source}`);
    }
  }
}
console.log('Manifest validation passed.');
