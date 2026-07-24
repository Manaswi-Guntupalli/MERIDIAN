import { createServer } from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { initSocket } from './lib/socket.js';
import { prisma } from './lib/prisma.js';
import { runRetentionSweep } from './services/lumen/storage.js';

async function main() {
  const app = createApp();
  const httpServer = createServer(app);
  initSocket(httpServer);

  // A friendly message instead of an unhandled 'error' crash when the port is
  // taken — almost always a previous dev server that didn't shut down.
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ✖ Port ${env.port} is already in use — another Meridian server (likely a stale one) is still running.`);
      console.error(`    Free it and retry:  npm run dev:stop   then   npm run dev`);
      console.error(`    (or in one step:    npm run dev:fresh)\n`);
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(env.port, () => {
    console.log(`\n  ⬦ Meridian API  →  http://localhost:${env.port}/api`);
    console.log(`  ⬦ Health        →  http://localhost:${env.port}/api/health`);
    console.log(`  ⬦ AI (OpenAI)   →  ${env.aiEnabled ? 'enabled' : 'simulation fallback (no key)'}`);
    console.log(`  ⬦ Client origin →  ${env.clientOrigin}\n`);
  });

  // Document retention: sweep on boot, then daily. unref() so a pending timer
  // never holds the process open during shutdown.
  void runRetentionSweep().catch(() => {});
  setInterval(() => void runRetentionSweep().catch(() => {}), 24 * 3600 * 1000).unref();

  const shutdown = async () => {
    await prisma.$disconnect();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
