/**
 * Importer page — T06 SHELL ONLY.
 *
 * This is the minimal 3.6.1 sandbox page mounted by `src/addon.tsx`. It
 * receives the addon context and the route location and renders a placeholder.
 * It does NOT call any write APIs.
 *
 * T07 fills in the four-step wizard (upload → account/mapping → review →
 * reconcile/import). Until then this shell proves the sandbox lifecycle:
 * one React root, sidebar item, route, and clean disable.
 *
 * The shell imports the pure-core pipeline entry (`parseAndMap`) so the Vite
 * build bundles `papaparse` and `decimal.js` (broker-specific parser deps that
 * must NOT be externalized). T07 wires `parseAndMap` into the upload step.
 */
import type { ReactElement } from 'react';
import { createElement } from 'react';

import type { AddonContext, AddonRouteLocation } from '@wealthfolio/addon-sdk';

import { parseAndMap } from '../parser/parse-and-map';

export interface ImporterPageProps {
  /** The 3.6.1 addon context. T07 uses `ctx.api` for accounts/activities. */
  ctx: AddonContext | null;
  /** Route location supplied by the host on each render. */
  location: AddonRouteLocation;
}

/**
 * Minimal placeholder page. Intentionally has no effects and no API calls —
 * T07 implements the wizard. Kept as a named export so `src/addon.tsx` can
 * import it without a default-export churn.
 */
export function ImporterPage({ ctx, location }: ImporterPageProps): ReactElement {
  // `ctx` is accepted for T07 wiring; the shell does not call it. Reference it
  // so strict `noUnusedParameters` stays happy and the prop shape is stable.
  void ctx;
  void location;
  // `parseAndMap` is the T07 upload-step entry; referencing it here keeps it in
  // the module graph so the build bundles papaparse + decimal.js.
  void parseAndMap;
  return createElement(
    'div',
    { className: 'degiro-importer-shell' },
    createElement('h1', null, 'DEGIRO Importer'),
    createElement('p', null, 'Sandbox shell loaded. The import wizard is implemented in T07.'),
  );
}
