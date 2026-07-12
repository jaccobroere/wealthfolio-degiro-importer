import { defineConfig } from 'vitest/config';

// Local-only real-statement acceptance config. This suite is deliberately
// excluded from ordinary CI (vitest.config.ts excludes tests/acceptance/**)
// because the real DEGIRO statement is never committed. It reads the statement
// ONLY through the DEGIRO_ACCEPTANCE_CSV env var and fails fast (non-zero exit,
// clear message) when that env var is unset, missing, unreadable, or not a
// regular file.
export default defineConfig({
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    exclude: ['node_modules/**'],
    // Fail fast: do not let the suite linger if the input is unavailable.
    bail: 1,
  },
});
