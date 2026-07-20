import { chatJSON, chatText } from '../lib/openai.js';
import { INTENTS, keywordClassify, extractParams, type IntentDef, type CopilotAction } from './copilot-intents.js';

/**
 * Meridian Copilot — LLM-as-parser, never LLM-as-source-of-truth.
 *
 *   question ─▶ (1) CLASSIFY   OpenAI picks an intent + params (keyword fallback)
 *            ─▶ (2) RESOLVE    Node fetches FACTS from the DB / Python engine
 *            ─▶ (3) FORMAT     OpenAI phrases an answer from those FACTS ONLY
 *
 * OpenAI never invents statistics, balances, predictions or student data. If no
 * OPENAI_API_KEY is configured, both LLM steps degrade to deterministic paths
 * (keyword classification + a templated answer) so the product always works.
 */

export interface CopilotResult {
  answer: string;
  grounded: boolean;
  data?: unknown;
  source: 'openai' | 'rules';
  confidence: number;
  intent: string;
  category?: string;
  actions: CopilotAction[];
}

const CLASSIFY_SYSTEM =
  'You are the intent router for Meridian Copilot, a school-operations assistant. ' +
  'Map the user question to exactly one intent id from the provided list, and extract any ' +
  'numeric parameters. Respond ONLY as JSON: {"intent": "<id>", "params": {"percent"?: number, ' +
  '"threshold"?: number, "className"?: string, "month"?: string, "day"?: number, "period"?: number}}. ' +
  'Use "unknown" if no intent fits. Do not answer the question — only classify it.';

const FORMAT_SYSTEM =
  'You are Meridian Copilot, an assistant for school administrators. ' +
  'You NEVER invent facts. You only explain the structured FACTS you are given, which come ' +
  'from Meridian’s database and Python intelligence engine. If the FACTS are empty or say the ' +
  'engine is offline, state that plainly and do not guess. Be concise (1–3 sentences), ' +
  'professional and actionable. Use the real names and numbers from FACTS; never fabricate ' +
  'statistics, balances, predictions or students. Do not output raw JSON or code.';

async function classify(question: string): Promise<{ intent: string; params: Record<string, unknown> }> {
  const catalog = INTENTS.map((i) => `- ${i.id} (${i.category}): ${i.description}`).join('\n');
  const ai = await chatJSON<{ intent?: string; params?: Record<string, unknown> }>(
    CLASSIFY_SYSTEM,
    `INTENTS:\n${catalog}\n\nQUESTION: ${question}`,
  );
  if (ai?.intent && INTENTS.some((i) => i.id === ai.intent)) {
    // Merge LLM params with regex-extracted ones as a safety net.
    return { intent: ai.intent, params: { ...extractParams(question.toLowerCase()), ...(ai.params ?? {}) } };
  }
  // No key, failure, or unknown → deterministic keyword classifier.
  return keywordClassify(question);
}

async function formatAnswer(question: string, facts: unknown, fallbackText: string): Promise<{ text: string; source: 'openai' | 'rules' }> {
  const ai = await chatText(FORMAT_SYSTEM, `QUESTION: ${question}\n\nFACTS (the ONLY source of truth):\n${JSON.stringify(facts)}`);
  if (ai && ai.trim()) return { text: ai.trim(), source: 'openai' };
  return { text: fallbackText, source: 'rules' };
}

function helpResult(): CopilotResult {
  return {
    answer:
      'I answer from live school data — never guesses. Try: “Which students are below 75% attendance?”, ' +
      '“Who has overdue fees above ₹10,000?”, “Which teachers are absent today?”, “Show pending document reviews”, ' +
      '“Why did attendance drop?”, or “What needs my attention today?”.',
    grounded: true,
    source: 'rules',
    confidence: 0.5,
    intent: 'unknown',
    actions: [
      { label: 'Open dashboard', to: '/' },
      { label: 'Open attendance', to: '/attendance' },
    ],
  };
}

export async function askCopilot(schoolId: string, question: string): Promise<CopilotResult> {
  const { intent, params } = await classify(question);
  const def: IntentDef | undefined = INTENTS.find((i) => i.id === intent);
  if (!def) return helpResult();

  const resolved = await def.resolve({ schoolId, params, question });
  const { text, source } = await formatAnswer(question, resolved.facts, resolved.fallbackText);

  return {
    answer: text,
    grounded: true,
    data: resolved.facts,
    source,
    confidence: resolved.confidence,
    intent: def.id,
    category: def.category,
    actions: resolved.actions,
  };
}
