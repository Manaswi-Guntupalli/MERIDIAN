import OpenAI from 'openai';
import { env } from '../config/env.js';

// Lazily-constructed OpenAI client. When no key is configured every AI call
// falls back to a deterministic, data-grounded simulation (see services/*),
// so the product is always fully functional — a demo can never "die" on stage.
let client: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
  if (!env.aiEnabled) return null;
  if (!client) client = new OpenAI({ apiKey: env.openaiKey });
  return client;
}

/**
 * Ask the model for strict JSON. Returns null on any failure so callers can
 * transparently fall back to their deterministic implementation.
 */
export async function chatJSON<T = unknown>(
  system: string,
  user: string,
  opts: { temperature?: number } = {},
): Promise<T | null> {
  const ai = getOpenAI();
  if (!ai) return null;
  try {
    const res = await ai.chat.completions.create({
      model: env.openaiModel,
      temperature: opts.temperature ?? 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const text = res.choices[0]?.message?.content;
    return text ? (JSON.parse(text) as T) : null;
  } catch (err) {
    console.warn('[openai] falling back to simulation:', (err as Error).message);
    return null;
  }
}

export async function chatText(system: string, user: string): Promise<string | null> {
  const ai = getOpenAI();
  if (!ai) return null;
  try {
    const res = await ai.chat.completions.create({
      model: env.openaiModel,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.choices[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}
