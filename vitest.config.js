// vitest.config.js
// Scoped to src/**/*.test.js only — tests/**/*.test.js stays on the
// existing root Jest setup (jest.config.cjs) so this doesn't double-run
// or replace working test infra.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
    environment: 'node',
  },
});
