/**
 * Addon sandbox lifecycle proof (T06).
 *
 * Verifies the 3.6.1 sandbox contract from `docs/SDK-CONTRACT.md`:
 *  1. `enable(ctx)` registers exactly one sidebar item and one route.
 *  2. Calling `render({ root, location })` multiple times calls `createRoot`
 *     exactly once and reuses the same root (subsequent renders call
 *     `root.render` again, no new `createRoot`).
 *  3. The `onDisable` callback removes the sidebar item exactly once and
 *     unmounts the root exactly once.
 *  4. After disable, a fresh `render` creates a new root (refs cleared) —
 *     ensures re-enable works.
 *
 * Plus static checks that `src/addon.tsx` and `manifest.json` contain no
 * `component:` or `contributes`, and that `createRoot` is imported from
 * `react-dom/client` (not `react-dom`).
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
  RouteConfig,
  SidebarItemConfig,
  SidebarItemHandle,
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
  pathname: '/addon/degiro-importer',
  search: '',
  hash: '',
  params: {},
};

// Import the addon AFTER mocks are in place. We import the named exports plus
// the internal `__routeRender` / `__resetForTests` helpers.
import { enable, __resetForTests } from '../src/addon';

function makeSidebarHandle(): SidebarItemHandle {
  return { remove: vi.fn() };
}

function makeRootEl(): HTMLElement {
  return document.createElement('div');
}

describe('addon sandbox lifecycle (T06)', () => {
  let ctx: FakeCtx;
  let disableCb: (() => void) | undefined;
  let sidebarHandle: SidebarItemHandle;
  let routeConfig: RouteConfig | undefined;

  beforeEach(() => {
    __resetForTests();
    createRootMock.mockReset();
    fakeRoot.render.mockReset();
    fakeRoot.unmount.mockReset();
    // `createRoot` returns the shared fake root so the addon reuses it.
    createRootMock.mockReturnValue(fakeRoot);

    ctx = createFakeCtx();
    sidebarHandle = makeSidebarHandle();
    ctx.sidebar.addItem.mockReturnValue(sidebarHandle);
    ctx.onDisable.mockImplementation((cb: () => void) => {
      disableCb = cb;
    });
    ctx.router.add.mockImplementation((cfg: RouteConfig) => {
      routeConfig = cfg;
    });

    enable(ctx as unknown as AddonContext);
  });

  it('registers exactly one sidebar item and one route', () => {
    expect(ctx.sidebar.addItem).toHaveBeenCalledTimes(1);
    const cfg = ctx.sidebar.addItem.mock.calls[0][0] as SidebarItemConfig;
    expect(cfg.id).toBe('degiro-importer');
    expect(cfg.label).toBe('DEGIRO Import');
    expect(cfg.icon).toBe('files');
    expect(cfg.route).toBe('/addon/degiro-importer');

    expect(ctx.router.add).toHaveBeenCalledTimes(1);
    expect(routeConfig).toBeDefined();
    expect(routeConfig!.id).toBe('degiro-importer');
    expect(routeConfig!.path).toBe('/addon/degiro-importer');
    expect(typeof routeConfig!.render).toBe('function');
    // No `component` field on the route config.
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

  it('onDisable removes the sidebar item exactly once and unmounts the root exactly once', () => {
    expect(routeConfig).toBeDefined();
    // Render once so a root exists.
    routeConfig!.render({ root: makeRootEl(), location: fakeLocation });
    expect(createRootMock).toHaveBeenCalledTimes(1);

    expect(disableCb).toBeDefined();
    disableCb!();

    expect(sidebarHandle.remove).toHaveBeenCalledTimes(1);
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
    expect(ctx.sidebar.addItem).toHaveBeenCalledTimes(1);
    expect(ctx.router.add).toHaveBeenCalledTimes(1);
  });
});

// --- Static contract checks ------------------------------------------------
describe('addon static contract (T06)', () => {
  const addonSrc = readFileSync(resolve(__dirname, '../src/addon.tsx'), 'utf8');
  const manifestSrc = readFileSync(resolve(__dirname, '../manifest.json'), 'utf8');

  it('src/addon.tsx has no `component:` route field', () => {
    expect(addonSrc).not.toMatch(/\bcomponent\s*:/);
  });

  it('manifest.json has no `contributes` field', () => {
    expect(manifestSrc).not.toMatch(/"contributes"\s*:/);
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
