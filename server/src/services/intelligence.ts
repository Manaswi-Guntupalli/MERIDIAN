import { env } from '../config/env.js';

/**
 * Client for the Python intelligence engine. Node performs NO intelligence —
 * it authenticates the caller, forwards the request, and caches the result
 * briefly so a dashboard full of widgets doesn't hammer the engine.
 *
 * When the engine is unreachable the caller receives { engine: 'offline' } —
 * the dashboard renders that state honestly instead of falling back to any
 * locally invented numbers.
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; payload: unknown }>();

export interface IntelligenceResult {
  engine: 'online' | 'offline';
  payload?: unknown;
  error?: string;
}

export async function getDashboardIntelligence(schoolId: string, opts: { fresh?: boolean } = {}): Promise<IntelligenceResult> {
  const hit = cache.get(schoolId);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { engine: 'online', payload: hit.payload };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${env.intelligenceUrl}/intelligence/dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { engine: 'offline', error: `Engine responded ${res.status}` };
    const payload = await res.json();
    cache.set(schoolId, { at: Date.now(), payload });
    return { engine: 'online', payload };
  } catch (e) {
    return { engine: 'offline', error: e instanceof Error ? e.message : 'unreachable' };
  }
}
