// Free Meridian's dev ports by killing whatever is still listening on them.
//
// The usual cause of "EADDRINUSE :::4000" or the client silently drifting to
// 5174 is a previous `npm run dev` that didn't shut down cleanly. Run
// `npm run dev:stop` (or `npm run dev:fresh` to stop-then-start) to clear it.
//
// Cross-platform: uses netstat+taskkill on Windows, lsof+kill elsewhere.
// Only touches the dev ports below — the Python face (8020) and intelligence
// (8010) services are left alone.

import { execSync } from 'node:child_process';
import os from 'node:os';

const DEFAULT_PORTS = [4000, 5173, 5174];
const ports = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const targets = ports.length ? ports : DEFAULT_PORTS;
const isWin = os.platform() === 'win32';

function pidsOnPort(port) {
  try {
    if (isWin) {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        // e.g. "  TCP    0.0.0.0:4000   0.0.0.0:0   LISTENING   38660"
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (m && Number(m[1]) === port) pids.add(m[2]);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return []; // nothing listening (netstat/lsof found no match)
  }
}

function kill(pid) {
  try {
    if (isWin) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let freed = 0;
for (const port of targets) {
  const pids = pidsOnPort(port);
  if (!pids.length) {
    console.log(`  · port ${port} already free`);
    continue;
  }
  for (const pid of pids) {
    if (kill(pid)) {
      console.log(`  ✓ freed port ${port} (stopped PID ${pid})`);
      freed++;
    } else {
      console.log(`  ✖ could not stop PID ${pid} on port ${port} — try running the terminal as admin`);
    }
  }
}
console.log(freed ? `\n  Done — ${freed} stale process(es) stopped. Start with: npm run dev` : `\n  All dev ports already free. Start with: npm run dev`);
