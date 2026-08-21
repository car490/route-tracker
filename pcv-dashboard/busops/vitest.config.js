// vitest.config.js
// Scoped to driver/src/**/*.test.js and announce/pi-server/**/*.test.js
// only — tests/**/*.test.js stays on the existing root Jest setup
// (jest.config.cjs) so this doesn't double-run or replace working test
// infra.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['driver/src/**/*.test.js', 'announce/pi-server/**/*.test.js'],
    environment: 'node',
  },
});
