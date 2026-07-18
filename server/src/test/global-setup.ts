import { execSync } from 'node:child_process';

/** Create a fresh, isolated SQLite database for the test run. */
export default function globalSetup() {
  execSync('npx prisma db push --force-reset --skip-generate', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  });
}
