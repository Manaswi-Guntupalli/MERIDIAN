import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/db-url.js';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/globalSetup.ts',
    setupFiles: ['./tests/setup.ts'],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-not-for-production-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    // The engine writes real transactions against a shared SQLite file —
    // running files in parallel workers risks SQLITE_BUSY. Each test builds
    // its own schoolId-scoped fixture, so sequential is enough for isolation
    // without needing per-test truncation.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 20_000,
  },
});
