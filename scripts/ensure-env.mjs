// Foolproof first run: create server/.env from server/.env.example when it's
// missing, so a fresh clone never dies on `prisma db push` with
// "Environment variable not found: DATABASE_URL". Runs via the root
// postinstall — idempotent, never overwrites an existing .env, and never
// fails an install (a copy problem must not block `npm install`).
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

try {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const envPath = join(root, 'server', '.env');
  const examplePath = join(root, 'server', '.env.example');
  if (existsSync(envPath)) {
    // Already configured — leave the developer's file untouched.
  } else if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log('✓ Created server/.env from server/.env.example (edit it to add keys).');
  }
} catch (err) {
  console.warn('ensure-env: skipped —', err instanceof Error ? err.message : err);
}
