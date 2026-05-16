import React, { lazy } from 'react';
import type { AddonContext, HostAPI } from '@wealthfolio/addon-sdk';

function createImporterPage(api: HostAPI) {
  return lazy(async () => {
    const { default: ImporterPage } = await import('./components/ImporterPage');
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      default: function WrappedImporterPage(props: any) {
        return React.createElement(ImporterPage, { ...props, api });
      },
    };
  });
}

export function enable(ctx: AddonContext): void {
  ctx.sidebar.addItem({
    id: 'degiro-importer',
    label: 'DeGiro Import',
    icon: React.createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: 20, height: 20,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
      React.createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
      React.createElement('polyline', { points: '7 10 12 15 17 10' }),
      React.createElement('line', { x1: '12', y1: '15', x2: '12', y2: '3' }),
    ),
    route: '/addons/degiro-importer',
    order: 100,
  });

  ctx.router.add({
    path: '/addons/degiro-importer',
    component: createImporterPage(ctx.api),
  });

  ctx.onDisable(() => {});
}
