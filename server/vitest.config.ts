import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: './src/test/global-setup.ts',
    setupFiles: ['./src/test/setup-env.ts'],
    // The suites share one SQLite test database — run files serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
