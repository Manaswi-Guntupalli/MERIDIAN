import path from 'node:path';

// Shared by globalSetup (separate process) and vitest.config.ts (test.env) —
// both need to agree on the exact same file. SQLite resolves a relative
// `file:` URL relative to the schema's location, so we use an absolute,
// forward-slash path to sidestep that ambiguity entirely (including on
// Windows, where backslashes in a `file:` URL are misparsed).
const dbFile = path.resolve(process.cwd(), 'prisma/test.db').replace(/\\/g, '/');
export const TEST_DATABASE_URL = `file:${dbFile}`;
