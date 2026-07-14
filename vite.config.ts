import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { HOST_DEPENDENCIES } from '@wealthfolio/addon-sdk/host-dependencies';

// Single source of truth for host-provided dependencies: the SDK's exported
// HOST_DEPENDENCIES map. The top-level packages are externalized as ESM imports
// because the sandbox provides them at runtime. The fixed subpath externals
// (deep imports + react/jsx-runtime etc.) are appended below. Broker-specific
// parser dependencies (papaparse, decimal.js) are intentionally bundled and
// must NOT appear here.
//
// validate-manifest.ts compares manifest.hostDependencies against this same
// HOST_DEPENDENCIES export, so the build externals and the manifest stay in
// sync automatically.
const hostProvidedDependencies: string[] = [
  ...Object.keys(HOST_DEPENDENCIES),
  // SDK + UI deep-import subpaths (not separate packages).
  '@wealthfolio/addon-sdk/goal-progress',
  '@wealthfolio/addon-sdk/host-api',
  '@wealthfolio/addon-sdk/host-dependencies',
  '@wealthfolio/addon-sdk/manifest',
  '@wealthfolio/addon-sdk/permissions',
  '@wealthfolio/addon-sdk/query-keys',
  '@wealthfolio/addon-sdk/types',
  '@wealthfolio/addon-sdk/utils',
  '@wealthfolio/ui/chart',
  // React deep imports the bundler emits.
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: 'src/addon.tsx',
      fileName: () => 'addon.js',
      formats: ['es'],
    },
    outDir: 'dist',
    minify: true,
    sourcemap: false,
    rollupOptions: {
      external: hostProvidedDependencies,
    },
  },
});
