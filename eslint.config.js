// Flat config (ESLint 9). TypeScript parsing via typescript-eslint.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'artifacts/**',
      '.local/**',
      'pnpm-lock.yaml',
      // T03: the pure core (src/domain, src/parser, src/mapping, src/validation,
      // src/duplicates, src/reconciliation) lints under this config. The legacy
      // SDK 3.3 UI (src/addon.tsx, src/components/**, src/types.ts) is rewritten
      // in T06; until then it is excluded so the pure core lints cleanly.
      'src/addon.tsx',
      'src/components/**',
      'src/types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
);
