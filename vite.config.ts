import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import externalGlobals from 'rollup-plugin-external-globals';

export default defineConfig({
  plugins: [
    react({ jsxRuntime: 'classic' }),
    externalGlobals({ react: 'React', 'react-dom': 'ReactDOM' }),
  ],
  build: {
    lib: {
      entry: 'src/addon.tsx',
      formats: ['es'],
      fileName: () => 'addon.js', // force .js extension expected by manifest
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        // Bundle all dynamic imports (lazy components) into the single addon.js
        // file so Wealthfolio only needs to load one script
        inlineDynamicImports: true,
      },
    },
    minify: false,
    sourcemap: true,
  },
});
