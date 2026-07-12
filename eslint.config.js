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
      // T02 baseline: the legacy upstream src/ targets SDK 3.3 and is replaced
      // by the pure-core refactor in T03. It is excluded here (mirroring
      // tsconfig.json) so the toolchain lints cleanly today. T03 reintroduces
      // src/** under this same configuration.
      'src/**',
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
