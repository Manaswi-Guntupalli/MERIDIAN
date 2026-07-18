// Per-file setup hook. Nothing global is needed today — DATABASE_URL is
// injected via vitest.config.ts's `test.env`, and each test builds its own
// schoolId-scoped fixture (see tests/helpers.ts) rather than relying on
// shared/reset state. Kept as an explicit file so future global hooks have
// an obvious home.
export {};
