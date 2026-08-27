// vitest.config.js
// Scoped to driver/src/**/*.test.js, announce/src/**/*.test.js, and
// announce/mele-server/**/*.test.js only — tests/**/*.test.js stays on the
// existing root Jest setup (jest.config.cjs) so this doesn't double-run or
// replace working test infra. announce/src/ added alongside driver/src/ for
// BusOps Announce Lite's own co-located pure-logic tests (same convention:
// injectable-storage/no-DOM modules, see announceLiteSetup.js).

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['driver/src/**/*.test.js', 'announce/src/**/*.test.js', 'announce/mele-server/**/*.test.js'],
    environment: 'node',
  },
});
