import dotenv from 'dotenv';
dotenv.config();

function required(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

// In production a real secret is mandatory — never silently fall back to a
// well-known dev default (that would let anyone forge tokens).
function requiredSecret(): string {
  const v = process.env.JWT_SECRET;
  if (isProd && (!v || v.length < 32)) {
    throw new Error('JWT_SECRET must be set to a strong (32+ char) value in production');
  }
  return v ?? 'meridian-dev-only-secret-not-for-production';
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  jwtSecret: requiredSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  openaiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  get aiEnabled() {
    return this.openaiKey.trim().length > 0;
  },
  // Lumen document storage. The key encrypts uploaded documents at rest
  // (AES-256-GCM); set LUMEN_STORAGE_KEY explicitly in production so the key
  // rotates independently of the JWT secret it otherwise derives from.
  lumenStorageKey: process.env.LUMEN_STORAGE_KEY ?? '',
  // How long failed/abandoned documents are kept before the retention sweep
  // removes them. Committed and verified records are never auto-deleted.
  lumenRetentionDays: Number(process.env.LUMEN_RETENTION_DAYS ?? 30),
  // Python intelligence engine (FastAPI). Node only orchestrates — all
  // analytics, confidence and ranking are computed there.
  intelligenceUrl: process.env.INTELLIGENCE_URL ?? 'http://localhost:8010',
  // Python face service (FastAPI). Turns pixels into a 512-D embedding; Node
  // keeps all matching and DB access. Down → the kiosk shows an explicit
  // offline state, never a fabricated match.
  faceServiceUrl: process.env.FACE_SERVICE_URL ?? 'http://localhost:8020',
};
