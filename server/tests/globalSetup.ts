import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { TEST_DATABASE_URL } from './db-url.js';

// Runs once, in its own process, before any test file. Builds a fresh SQLite
// test database from the current schema so tests never depend on (or
// pollute) the dev database at server/prisma/meridian.db.
export default function globalSetup() {
  const dbPath = TEST_DATABASE_URL.replace('file:', '');
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
