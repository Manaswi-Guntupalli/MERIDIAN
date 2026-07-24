import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Bind 0.0.0.0 so the dev server is reachable at the laptop's LAN address
    // (e.g. http://192.168.x.x:5173) — required for a phone on the same Wi-Fi to
    // open the session /scan QR. Vite prints this "Network" URL on startup.
    host: true,
    port: 5173,
    // Fail loudly if 5173 is taken (stale dev server) rather than silently
    // drifting to 5174 — run `npm run dev:stop` to clear it. Keeps the URL the
    // projector opens (and the QR encodes) stable and predictable.
    strictPort: true,
    // Also accept tunnel hostnames (ngrok / cloudflared) without Vite's host
    // check blocking them — the fallback when a network blocks device-to-device
    // traffic. Dev server only.
    allowedHosts: true,
    proxy: {
      // The phone talks only to this Vite origin; these forward to the backend
      // on the laptop, so there are no CORS or cross-origin concerns.
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
