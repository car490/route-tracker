// dashboard/vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'api/**/*.test.js'],
    environment: 'node',
  },
});
