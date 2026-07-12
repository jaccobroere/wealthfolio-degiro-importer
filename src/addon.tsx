/**
 * Wealthfolio 3.6.1 sandbox addon entry.
 *
 * Registers one runtime sidebar item and one route, owns exactly one React
 * root for the route, reuses that root across renders, and cleans both up in
 * `ctx.onDisable()`.
 *
 * Contract (verified against `@wealthfolio/addon-sdk` 3.6.1, see
 * `docs/SDK-CONTRACT.md`):
 * - `ctx.router.add({ id?, path, render })` with `render({ root, location })`.
 * - Create ONE React root via `createRoot(root)` (from `react-dom/client`),
 *   reuse it across renders, unmount in `ctx.onDisable()`.
 * - `ctx.sidebar.addItem(config)` returns a handle with `.remove()`; call
 *   `.remove()` in `ctx.onDisable()`.
 * - Uses the 3.6.1 `render`-callback route model (no legacy route component
 *   field, no manifest contribution block), no React-DOM global, no
 *   React-Router hooks (router context is unavailable in the sandbox).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  AddonContext,
  AddonRouteLocation,
  AddonRouteRenderContext,
} from '@wealthfolio/addon-sdk';

import { ImporterPage } from './pages/importer-page';

/** Manifest id, route id, and sidebar id — all identical and stable. */
const ADDON_ID = 'degiro-importer';
/** Sandbox route path. */
const ROUTE_PATH = '/addon/degiro-importer';

/**
 * Per-enable module state. Held in module-scope refs so the `render` callback
 * (a plain function, not a closure over `ctx`) can reach them, and so a fresh
 * `enable()` after a disable starts from clean refs.
 *
 * These are reset to `null` in `onDisable` so a re-enable creates a new root.
 */
let sidebarHandle: ReturnType<AddonContext['sidebar']['addItem']> | null = null;
let reactRoot: Root | null = null;

/**
 * Route render callback. Creates the React root lazily on first render and
 * reuses it on every subsequent render. The host hands us a fresh `root`
 * HTMLElement each time; we mount into it once and keep the `Root` handle.
 */
function render({ root, location, ...hostContext }: AddonRouteRenderContext): void {
  // Reuse the existing root across renders; create exactly once per enable
  // lifecycle. `root ??=` is intentionally NOT used here because the host may
  // pass a new HTMLElement on re-render — we keep the FIRST root's Root handle
  // and render into the originally-mounted container. The 3.6.1 contract
  // guarantees the same root element is reused for a given route registration.
  if (reactRoot === null) {
    reactRoot = createRoot(root);
  }
  reactRoot.render(createElement(ImporterPage, { ctx: ctxRef, location }));
  // Wealthfolio 3.6.1's iframe sandbox includes this internal acknowledgement
  // callback in the runtime context. Calling it prevents the hidden iframe's
  // next-paint fallback from blocking route completion for 10 seconds. The
  // public SDK type intentionally exposes only `root` and `location`, so keep
  // the runtime-only field isolated here.
  const onRendered = (hostContext as { onRendered?: unknown }).onRendered;
  if (typeof onRendered === 'function') {
    onRendered();
  }
}

/**
 * Holds the active `AddonContext` for the `render` callback. Set in `enable`,
 * cleared in `onDisable`. Module-scoped so `render` (registered by id) can
 * reach it without closing over `ctx`.
 */
let ctxRef: AddonContext | null = null;

/**
 * Addon enable entry. Called by the 3.6.1 sandbox when the addon is enabled.
 */
export function enable(ctx: AddonContext): void {
  // Guard against double-enable without an intervening disable.
  if (ctxRef !== null) {
    return;
  }
  ctxRef = ctx;

  sidebarHandle = ctx.sidebar.addItem({
    id: ADDON_ID,
    label: 'DEGIRO Import',
    icon: 'files',
    route: ROUTE_PATH,
    order: 100,
  });

  ctx.router.add({
    id: ADDON_ID,
    path: ROUTE_PATH,
    render,
  });

  ctx.onDisable(() => {
    // Remove the sidebar item exactly once.
    if (sidebarHandle !== null) {
      sidebarHandle.remove();
      sidebarHandle = null;
    }
    // Unmount the React root exactly once.
    if (reactRoot !== null) {
      reactRoot.unmount();
      reactRoot = null;
    }
    // Clear the context ref so a fresh enable re-registers cleanly.
    ctxRef = null;
  });
}

/** Exported for tests so they can reset module state between cases. */
export function __resetForTests(): void {
  sidebarHandle = null;
  reactRoot = null;
  ctxRef = null;
}

/** Re-export the location type for the page shell. */
export type { AddonRouteLocation };
