/**
 * Addon sandbox lifecycle proof (3.6.1 render-callback model).
 *
 * Verifies the documented SDK contract from `docs/SDK-CONTRACT.md`:
 *  1. `enable(ctx)` registers exactly one route (sidebar navigation is
 *     manifest-declared via `contributes.links.sidebar`, so the runtime does
 *     NOT call `ctx.sidebar.addItem`).
 *  2. Multiple `render({ root, location })` calls invoke `createRoot` exactly
 *     once and reuse the same root.
 *  3. The undocumented `onRendered` host acknowledgement is called after each
 *     render (retained defensively in both importers).
 *  4. `onDisable` unmounts the root exactly once.
 *  5. After disable, a fresh `render` creates a new root (per-enable state was
 *     cleared).
 *
 * Plus static checks that `src/addon.tsx` and `manifest.json` use the
 * manifest-declared navigation + 3.6.1 render model (contributes present,
 * runtime route id matches manifest route id, no singular `/addon/` path, no
 * `sidebar.addItem`, route uses `render`).
 *
 * `react-dom/client` is mocked so `createRoot` is a spy returning a fake root.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- Fake React root --------------------------------------------------------
// `vi.hoisted` runs before `vi.mock`'s hoisted factory, so the mock factory
// can safely reference these.
const fakeRoots: { render: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> }[] = [];

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => {
    const root = { render: vi.fn(), unmount: vi.fn() };
    fakeRoots.push(root);
    return root;
  }),
}));

// --- Types for the fake context --------------------------------------------
import type {
  AddonContext,
  AddonRouteLocation,
  AddonRouteRenderContext,
  RouteConfig,
} from '@wealthfolio/addon-sdk';

// Import the addon AFTER mocks are in place.
import { enable } from '../src/addon';
import { createRoot } from 'react-dom/client';

interface FakeCtx {
  sidebar: { addItem: ReturnType<typeof vi.fn> };
  router: { add: ReturnType<typeof vi.fn> };
  onDisable: ReturnType<typeof vi.fn>;
  api: unknown;
}

function createFakeCtx(): FakeCtx {
  return {
    sidebar: { addItem: vi.fn() },
    router: { add: vi.fn() },
    onDisable: vi.fn(),
    api: {},
  };
}

const fakeLocation: AddonRouteLocation = {
  pathname: '/addons/degiro-importer',
  search: '',
  hash: '',
  params: {},
};

function makeRootEl(): HTMLElement {
  return document.createElement('div');
}

describe('addon sandbox lifecycle (3.6.1 render model)', () => {
  let ctx: FakeCtx;
  let disableCb: (() => void) | undefined;
  let routeConfig: RouteConfig | undefined;

  beforeEach(() => {
    fakeRoots.length = 0;
    vi.mocked(createRoot).mockClear();
    ctx = createFakeCtx();
    ctx.onDisable.mockImplementation((cb: () => void) => {
      disableCb = cb;
    });
    ctx.router.add.mockImplementation((cfg: RouteConfig) => {
      routeConfig = cfg;
    });
    enable(ctx as unknown as AddonContext);
  });

  it('registers exactly one route and does not call sidebar.addItem', () => {
    expect(ctx.sidebar.addItem).not.toHaveBeenCalled();
    expect(ctx.router.add).toHaveBeenCalledTimes(1);
    expect(routeConfig).toBeDefined();
    expect(routeConfig!.id).toBe('main');
    expect(routeConfig!.path).toBe('/addons/degiro-importer');
    expect(typeof routeConfig!.render).toBe('function');
  });

  it('repeated render() calls invoke createRoot exactly once and reuse the root', () => {
    const render = routeConfig!.render as (c: AddonRouteRenderContext) => void;
    const root1 = makeRootEl();
    render({ root: root1, location: fakeLocation });
    render({ root: root1, location: fakeLocation });
    render({ root: root1, location: fakeLocation });
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(fakeRoots).toHaveLength(1);
    expect(fakeRoots[0]!.render).toHaveBeenCalledTimes(3);
  });

  it('calls the undocumented onRendered acknowledgement after each render', () => {
    const render = routeConfig!.render as (
      c: AddonRouteRenderContext & { onRendered: () => void },
    ) => void;
    const onRendered = vi.fn();
    render({ root: makeRootEl(), location: fakeLocation, onRendered });
    expect(fakeRoots[0]!.render).toHaveBeenCalledTimes(1);
    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it('onDisable unmounts the root exactly once', () => {
    const render = routeConfig!.render as (c: AddonRouteRenderContext) => void;
    render({ root: makeRootEl(), location: fakeLocation });
    expect(fakeRoots).toHaveLength(1);
    expect(disableCb).toBeDefined();
    disableCb!();
    expect(fakeRoots[0]!.unmount).toHaveBeenCalledTimes(1);
  });

  it('after disable, a fresh render creates a new root (per-enable state cleared)', () => {
    const render = routeConfig!.render as (c: AddonRouteRenderContext) => void;
    render({ root: makeRootEl(), location: fakeLocation });
    expect(fakeRoots).toHaveLength(1);
    const firstRoot = fakeRoots[0]!;
    disableCb!();
    render({ root: makeRootEl(), location: fakeLocation });
    expect(createRoot).toHaveBeenCalledTimes(2);
    expect(fakeRoots).toHaveLength(2);
    expect(fakeRoots[1]).not.toBe(firstRoot);
  });
});

// --- Static contract checks ------------------------------------------------
describe('addon static contract', () => {
  const addonSrc = readFileSync(resolve(__dirname, '../src/addon.tsx'), 'utf8');
  const manifestSrc = readFileSync(resolve(__dirname, '../manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestSrc) as {
    contributes?: { routes?: { id: string }[]; links?: { sidebar?: { route: string }[] } };
    permissions?: { category: string; functions: string[] }[];
  };

  it('manifest.json declares contributes with a "main" route', () => {
    expect(manifest.contributes).toBeDefined();
    expect(manifest.contributes!.routes!.map((r) => r.id)).toContain('main');
  });

  it('manifest.json sidebar links reference a declared route', () => {
    const routeIds = new Set(manifest.contributes!.routes!.map((r) => r.id));
    for (const link of manifest.contributes!.links!.sidebar!) {
      expect(routeIds.has(link.route)).toBe(true);
    }
  });

  it('runtime route id matches the manifest route id', () => {
    const constMatch = addonSrc.match(/const\s+ROUTE_ID\s*=\s*['"]([^'"]+)['"]/);
    const literal = addonSrc.match(/ctx\.router\.add\(\s*\{[^}]*\bid:\s*['"]([^'"]+)['"]/s);
    const ref = addonSrc.match(/ctx\.router\.add\(\s*\{[^}]*\bid:\s*([A-Za-z_$][\w$]*)/s);
    const runtimeId = literal ? literal[1] : ref && constMatch ? constMatch[1] : undefined;
    expect(runtimeId).toBe('main');
  });

  it('src/addon.tsx has no singular "/addon/" legacy path', () => {
    expect(addonSrc).not.toMatch(/['"]\/addon\//);
  });

  it('src/addon.tsx does not call sidebar.addItem', () => {
    expect(addonSrc).not.toMatch(/sidebar\.addItem\s*\(/);
  });

  it('manifest.json permissions do not request sidebar.addItem', () => {
    const ui = manifest.permissions!.find((p) => p.category === 'ui');
    expect(ui?.functions).not.toContain('sidebar.addItem');
  });

  it('src/addon.tsx imports createRoot from react-dom/client', () => {
    expect(addonSrc).toMatch(/from\s+['"]react-dom\/client['"]/);
  });

  it('src/addon.tsx uses no ReactDOM global, useLocation, or useParams', () => {
    expect(addonSrc).not.toMatch(/\bReactDOM\b/);
    expect(addonSrc).not.toMatch(/\buseLocation\b/);
    expect(addonSrc).not.toMatch(/\buseParams\b/);
  });

  it('manifest.json declares no query permission', () => {
    expect(manifestSrc).not.toMatch(/"query"\s*:/);
  });
});
