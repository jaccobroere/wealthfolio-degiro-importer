import { defineConfig } from 'vitest/config';

// Ordinary test config. Acceptance, integration, and e2e suites are excluded
// here; they run under their own configs (vitest.acceptance.config.ts in T03,
// playwright in T09) and never in CI.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/acceptance/**', 'tests/integration/**', 'tests/e2e/**', 'node_modules/**'],
  },
});
