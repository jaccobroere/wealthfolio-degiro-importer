/**
 * Addon sandbox lifecycle proof.
 *
 * Verifies the 3.6.1+ sandbox contract from `docs/SDK-CONTRACT.md`:
 *  1. `enable(ctx)` registers exactly one route (sidebar navigation is
 *     manifest-declared via `contributes.links.sidebar`, so the runtime does
 *     NOT call `ctx.sidebar.addItem`).
 *  2. Calling `render({ root, location })` multiple times calls `createRoot`
 *     exactly once and reuses the same root (subsequent renders call
 *     `root.render` again, no new `createRoot`).
 *  3. The `onDisable` callback unmounts the root exactly once.
 *  4. After disable, a fresh `render` creates a new root (refs cleared) —
 *     ensures re-enable works.
 *
 * Plus static checks that `src/addon.tsx` and `manifest.json` use the
 * manifest-declared navigation model (contributes present, runtime route id
 * matches manifest route id, no singular `/addon/` path, no runtime
 * `sidebar.addItem`) and that `createRoot` is imported from `react-dom/client`.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- Fake React root --------------------------------------------------------
// `vi.hoisted` runs before `vi.mock`'s hoisted factory, so the mock factory
// can safely reference these.
const { fakeRoot, createRootMock } = vi.hoisted(() => ({
  fakeRoot: { render: vi.fn(), unmount: vi.fn() },
  createRootMock: vi.fn(),
}));

// Mock `react-dom/client` BEFORE importing the addon so the addon's
// `import { createRoot } from 'react-dom/client'` resolves to the mock.
vi.mock('react-dom/client', () => ({
  createRoot: createRootMock,
}));

// --- Types for the fake context --------------------------------------------
import type {
  AddonContext,
  AddonRouteLocation,
  AddonRouteRenderContext,
  RouteConfig,
} from '@wealthfolio/addon-sdk';

interface FakeCtx {
  sidebar: {
    addItem: ReturnType<typeof vi.fn>;
  };
  router: {
    add: ReturnType<typeof vi.fn>;
  };
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

// Import the addon AFTER mocks are in place.
import { enable, __resetForTests } from '../src/addon';

function makeRootEl(): HTMLElement {
  return document.createElement('div');
}

describe('addon sandbox lifecycle', () => {
  let ctx: FakeCtx;
  let disableCb: (() => void) | undefined;
  let routeConfig: RouteConfig | undefined;

  beforeEach(() => {
    __resetForTests();
    createRootMock.mockReset();
    fakeRoot.render.mockReset();
    fakeRoot.unmount.mockReset();
    // `createRoot` returns the shared fake root so the addon reuses it.
    createRootMock.mockReturnValue(fakeRoot);

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
    // Sidebar navigation is manifest-declared; the runtime must not register it.
    expect(ctx.sidebar.addItem).not.toHaveBeenCalled();

    expect(ctx.router.add).toHaveBeenCalledTimes(1);
    expect(routeConfig).toBeDefined();
    expect(routeConfig!.id).toBe('main');
    expect(routeConfig!.path).toBe('/addons/degiro-importer');
    expect(typeof routeConfig!.render).toBe('function');
    // No `component` field on the route config yet (PR 2 switches to component).
    expect((routeConfig as unknown as Record<string, unknown>).component).toBeUndefined();
  });

  it('calls createRoot exactly once across repeated renders and reuses the root', () => {
    expect(routeConfig).toBeDefined();
    const render = routeConfig!.render;

    const root1 = makeRootEl();
    const root2 = makeRootEl();

    render({ root: root1, location: fakeLocation });
    render({ root: root2, location: fakeLocation });
    render({ root: root1, location: fakeLocation });

    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(fakeRoot.render).toHaveBeenCalledTimes(3);
  });

  it('acknowledges a host route render after scheduling the React render', () => {
    expect(routeConfig).toBeDefined();
    const onRendered = vi.fn();

    routeConfig!.render({
      root: makeRootEl(),
      location: fakeLocation,
      // The 3.6.1 iframe host supplies this acknowledgement callback at
      // runtime, although it is intentionally absent from the public SDK type.
      onRendered,
    } as AddonRouteRenderContext & { onRendered: () => void });

    expect(fakeRoot.render).toHaveBeenCalledTimes(1);
    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it('onDisable unmounts the root exactly once', () => {
    expect(routeConfig).toBeDefined();
    // Render once so a root exists.
    routeConfig!.render({ root: makeRootEl(), location: fakeLocation });
    expect(createRootMock).toHaveBeenCalledTimes(1);

    expect(disableCb).toBeDefined();
    disableCb!();

    expect(fakeRoot.unmount).toHaveBeenCalledTimes(1);
  });

  it('after disable, a fresh render creates a new root (refs cleared)', () => {
    expect(routeConfig).toBeDefined();
    routeConfig!.render({ root: makeRootEl(), location: fakeLocation });
    expect(createRootMock).toHaveBeenCalledTimes(1);

    expect(disableCb).toBeDefined();
    disableCb!();
    expect(fakeRoot.unmount).toHaveBeenCalledTimes(1);

    // Refs cleared → a fresh render must create a new root.
    createRootMock.mockClear();
    fakeRoot.render.mockClear();
    routeConfig!.render({ root: makeRootEl(), location: fakeLocation });
    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(fakeRoot.render).toHaveBeenCalledTimes(1);
  });

  it('does not double-register on a second enable without an intervening disable', () => {
    // The second enable should be a no-op (guard).
    enable(ctx as unknown as AddonContext);
    expect(ctx.sidebar.addItem).not.toHaveBeenCalled();
    expect(ctx.router.add).toHaveBeenCalledTimes(1);
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

  it('src/addon.tsx has no `component:` route field', () => {
    expect(addonSrc).not.toMatch(/\bcomponent\s*:/);
  });

  it('manifest.json declares contributes with a "main" route', () => {
    expect(manifest.contributes).toBeDefined();
    expect(manifest.contributes!.routes).toBeDefined();
    expect(manifest.contributes!.routes!.map((r) => r.id)).toContain('main');
  });

  it('manifest.json sidebar links reference a declared route', () => {
    const routeIds = new Set(manifest.contributes!.routes!.map((r) => r.id));
    const sidebar = manifest.contributes!.links!.sidebar!;
    for (const link of sidebar) {
      expect(routeIds.has(link.route)).toBe(true);
    }
  });

  it('runtime route id matches the manifest route id', () => {
    // The addon may pass a string literal or a ROUTE_ID const reference.
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

  it('src/addon.tsx imports createRoot from react-dom/client (not react-dom)', () => {
    expect(addonSrc).toMatch(/from\s+['"]react-dom\/client['"]/);
    // No bare `react-dom` import for createRoot.
    expect(addonSrc).not.toMatch(/import\s+\{[^}]*createRoot[^}]*\}\s+from\s+['"]react-dom['"]/);
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
