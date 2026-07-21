// Lumen — AI post-processing and record intelligence.
//
// This is the layer that separates "an OCR wrapper" from "a document
// intelligence system". OCR tells you what glyphs are on the page. This tells
// you whether the *record* makes sense: whether this student already exists,
// whether "Manaswl" should have been "Manaswi", whether anything mandatory is
// simply missing.
//
// ── On using an LLM here ──
//
// A language model is genuinely good at repairing a mangled read, because it
// knows "Manaswl" isn't a name and "Manaswi" is. It is also, by construction,
// capable of producing a fluent, confident value that was never on the page —
// and a plausible invented name is far more dangerous than an obviously broken
// one, because nobody catches it.
//
// So the model is never trusted on its word. Every suggestion must survive
// `groundedIn()`: the proposed value has to actually resemble text we read off
// the paper. If the model invents something, we drop it and keep the ugly
// honest read. The model gets to *repair* evidence, never to *create* it.
//
// It also only ever touches fields we already doubt. A field that read cleanly
// at 98% is left alone — there is nothing to gain and a hallucination to lose.

import { chatJSON } from '../../lib/openai.js';
import { prisma } from '../../lib/prisma.js';
import { similarity, norm } from './text.js';
import { normalizeField } from './normalize.js';
import { validateField } from './validate.js';
import { scoreField, statusFor, AUTO_ACCEPT } from './confidence.js';
import type { DocTemplate, ExtractedValue, Insight, PageResult } from './types.js';

/** Only fields below this get shown to the model. */
const AI_DOUBT_THRESHOLD = 0.82;

/**
 * Is `candidate` actually supported by what we read off the page?
 *
 * The check is deliberately loose on *form* and strict on *substance*: the
 * model is allowed to fix spacing, case, punctuation and a mangled character or
 * two, but the value must still be recognisably present in the source text. A
 * name that appears nowhere on the page is a hallucination regardless of how
 * reasonable it looks.
 */
function groundedIn(candidate: string, rawText: string, pageText: string): boolean {
  const c = norm(candidate).replace(/\s+/g, '');
  if (!c) return false;
  // Short values (a class, a grade, "B+") can't be meaningfully grounded by
  // substring — too many coincidental matches. Require them to be close to the
  // raw read instead.
  if (c.length <= 3) return similarity(candidate, rawText) >= 0.5;

  const haystack = norm(pageText).replace(/\s+/g, '');
  if (haystack.includes(c)) return true;

  // Allow a couple of repaired characters: slide a window and look for a close
  // match rather than demanding an exact substring.
  const w = c.length;
  const step = Math.max(1, Math.floor(w / 4));
  for (let i = 0; i + w <= haystack.length; i += step) {
    if (similarity(haystack.slice(i, i + w), c) >= 0.8) return true;
  }
  // Last resort: it may be a repair of the raw read itself.
  return similarity(candidate, rawText) >= 0.7;
}

interface AiSuggestion {
  key: string;
  value: string;
  reason?: string;
}

/**
 * Ask the model to repair the fields we already doubt.
 * Returns silently on any failure — the deterministic pipeline is the product,
 * and the AI is an enhancement that must never be a dependency.
 */
export async function aiRefine(
  template: DocTemplate,
  fields: ExtractedValue[],
  pages: PageResult[],
): Promise<{ fields: ExtractedValue[]; insights: Insight[] }> {
  const insights: Insight[] = [];
  const doubtful = fields.filter(
    (f) => f.rawValue && (f.confidence < AI_DOUBT_THRESHOLD || !f.valid),
  );
  if (!doubtful.length) return { fields, insights };

  const pageText = pages.map((p) => p.text).join('\n');
  // Keep the prompt bounded — a 20-page PDF would blow the context and the bill.
  const excerpt = pageText.slice(0, 6000);

  const system = [
    'You repair OCR output for Indian school documents.',
    'You will be given the raw text of a scanned form and a list of fields that were read with low confidence.',
    'For each field, return the corrected value EXACTLY as it appears on the form.',
    'Rules:',
    '- Only use text that is actually present in the provided document text.',
    '- NEVER invent a value. If the document does not contain the field, return an empty string.',
    '- Fix obvious OCR damage: 0/O, 1/l/I, 5/S, 8/B, rn/m, and spurious spaces.',
    '- Do not translate, expand, summarise, or "improve" values. Return what is written.',
    '- Dates: return exactly as printed; do not reformat.',
    'Respond as JSON: {"fields":[{"key":"...","value":"...","reason":"..."}]}',
  ].join('\n');

  const user = JSON.stringify({
    documentType: template.label,
    documentText: excerpt,
    fieldsToRepair: doubtful.map((f) => ({
      key: f.key,
      label: f.label,
      expectedType: template.fields.find((s) => s.key === f.key)?.type,
      currentRawRead: f.rawValue,
      problem: f.validationMessage ?? 'low confidence',
    })),
  });

  const reply = await chatJSON<{ fields?: AiSuggestion[] }>(system, user, { temperature: 0 });
  if (!reply?.fields?.length) return { fields, insights };

  const byKey = new Map(fields.map((f) => [f.key, f]));
  let applied = 0;
  let rejected = 0;

  for (const suggestion of reply.fields) {
    const field = byKey.get(suggestion.key);
    if (!field) continue;
    const spec = template.fields.find((s) => s.key === suggestion.key);
    if (!spec) continue;

    const proposed = (suggestion.value ?? '').trim();
    if (!proposed) continue;

    const normalised = normalizeField(proposed, spec);
    if (norm(normalised.value) === norm(field.value)) continue; // nothing to change

    // ── The hallucination gate. ──
    if (!groundedIn(proposed, field.rawValue, pageText)) {
      rejected++;
      insights.push({
        kind: 'CORRECTION',
        severity: 'INFO',
        message: `AI suggested "${proposed}" for ${field.label}, but that text is not on the page — suggestion discarded.`,
        detail: { key: field.key, proposed, kept: field.value },
      });
      continue;
    }

    const validation = validateField(normalised.value, spec);
    // A repair that is still invalid is not a repair.
    if (!validation.valid && field.valid) {
      rejected++;
      continue;
    }

    const page = pages.find((p) => p.index === field.page) ?? pages[0];
    const confidence = scoreField({
      ocrConfidence: Math.max(field.ocrConfidence, 0.7),
      labelScore: 0.85,
      source: 'AI',
      valid: validation.valid,
      corrected: true,
      ambiguous: normalised.ambiguous,
      quality: page.quality,
    });

    // Never let an AI repair *lower* a field's standing; if our own read scored
    // better, keep ours.
    if (confidence <= field.confidence) continue;

    insights.push({
      kind: 'CORRECTION',
      severity: 'INFO',
      message: `${field.label}: repaired "${field.rawValue}" → "${normalised.value}"${suggestion.reason ? ` (${suggestion.reason})` : ''}`,
      detail: { key: field.key, from: field.value, to: normalised.value },
    });

    field.value = normalised.value;
    field.confidence = confidence;
    field.source = 'AI';
    field.corrected = true;
    field.valid = validation.valid;
    field.validationMessage = validation.message;
    field.status = statusFor(confidence, validation.valid, normalised.value, field.expected);
    applied++;
  }

  if (applied || rejected) {
    console.log(`[lumen/ai] ${applied} repair(s) applied, ${rejected} rejected as ungrounded`);
  }
  return { fields, insights };
}

// ───────────────────────  duplicate detection  ───────────────────────

const NAME_MATCH = 0.88;

/**
 * Has this person already been entered?
 *
 * This is the check that saves a school from three copies of the same child
 * across three years of paperwork. We compare on identifiers first (exact and
 * decisive), then fall back to fuzzy name + date-of-birth, which is what
 * actually catches re-typed admissions.
 */
export async function findDuplicates(
  schoolId: string,
  template: DocTemplate,
  fields: ExtractedValue[],
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const get = (key: string) => fields.find((f) => f.key === key && f.value.trim())?.value;

  if (template.commits === 'STUDENT') {
    const name = get('studentName');
    const admissionNo = get('admissionNo');
    const dob = get('dob');

    if (admissionNo) {
      const clash = await prisma.student.findFirst({
        where: { schoolId, admissionNo },
        select: { id: true, name: true, admissionNo: true },
      });
      if (clash) {
        insights.push({
          kind: 'DUPLICATE',
          severity: 'CRITICAL',
          message: `Admission number ${admissionNo} already belongs to ${clash.name}.`,
          detail: { existingId: clash.id, field: 'admissionNo' },
        });
      }
    }

    if (name) {
      // Fetch candidates cheaply, then compare properly in memory. SQLite has
      // no trigram index, and a school roll is small enough that this is fine.
      const roster = await prisma.student.findMany({
        where: { schoolId },
        select: { id: true, name: true, dob: true, admissionNo: true },
      });
      for (const s of roster) {
        const sim = similarity(name, s.name);
        if (sim < NAME_MATCH) continue;
        const sameDob = dob && s.dob ? s.dob.toISOString().slice(0, 10) === dob : false;
        // An exact-ish name AND matching birth date is as close to certain as
        // school data gets. A name alone is a genuine coincidence risk —
        // plenty of schools have two children with the same name.
        insights.push({
          kind: 'DUPLICATE',
          severity: sameDob ? 'CRITICAL' : 'WARNING',
          message: sameDob
            ? `${s.name} (${s.admissionNo}) already exists with the same name and date of birth.`
            : `A student named ${s.name} (${s.admissionNo}) already exists — ${Math.round(sim * 100)}% name match. Verify this is a different child.`,
          detail: { existingId: s.id, similarity: Number(sim.toFixed(3)), sameDob },
        });
        if (insights.length >= 4) break;
      }
    }
  }

  if (template.commits === 'TEACHER') {
    const employeeId = get('employeeId');
    const email = get('email');
    const name = get('teacherName');

    if (employeeId) {
      const clash = await prisma.teacher.findFirst({
        where: { schoolId, employeeId },
        select: { id: true, employeeId: true, user: { select: { name: true } } },
      });
      if (clash) {
        insights.push({
          kind: 'DUPLICATE',
          severity: 'CRITICAL',
          message: `Employee ID ${employeeId} already belongs to ${clash.user.name}.`,
          detail: { existingId: clash.id, field: 'employeeId' },
        });
      }
    }
    if (email) {
      const clash = await prisma.user.findFirst({ where: { email: email.toLowerCase() }, select: { id: true, name: true } });
      if (clash) {
        insights.push({
          kind: 'DUPLICATE',
          severity: 'CRITICAL',
          message: `${email} is already registered to ${clash.name}.`,
          detail: { existingId: clash.id, field: 'email' },
        });
      }
    }
    if (name && !employeeId) {
      const staff = await prisma.teacher.findMany({
        where: { schoolId },
        select: { id: true, employeeId: true, user: { select: { name: true } } },
      });
      for (const t of staff) {
        const sim = similarity(name, t.user.name);
        if (sim >= NAME_MATCH) {
          insights.push({
            kind: 'DUPLICATE',
            severity: 'WARNING',
            message: `Staff member ${t.user.name} (${t.employeeId}) already exists — ${Math.round(sim * 100)}% name match.`,
            detail: { existingId: t.id, similarity: Number(sim.toFixed(3)) },
          });
          break;
        }
      }
    }
  }

  return insights;
}

/** Mandatory fields we failed to find — stated plainly, not buried. */
export function missingFieldInsights(fields: ExtractedValue[]): Insight[] {
  const missing = fields.filter((f) => f.expected && !f.value.trim());
  if (!missing.length) return [];
  return [
    {
      kind: 'MISSING',
      severity: 'CRITICAL',
      message: `${missing.length} mandatory field${missing.length > 1 ? 's' : ''} could not be read: ${missing
        .map((f) => f.label)
        .join(', ')}.`,
      detail: { keys: missing.map((f) => f.key) },
    },
  ];
}

/** Surface scan-quality problems as first-class findings, not silent penalties. */
export function qualityInsights(pages: PageResult[]): Insight[] {
  const out: Insight[] = [];
  for (const p of pages) {
    if (p.quality.verdict === 'POOR') {
      out.push({
        kind: 'QUALITY',
        severity: 'WARNING',
        message: `Page ${p.index + 1} is hard to read: ${p.quality.notes.join(' ') || 'low sharpness and contrast.'} Confidence has been capped accordingly.`,
        detail: p.quality,
      });
    }
    if (p.rotation) {
      out.push({
        kind: 'QUALITY',
        severity: 'INFO',
        message: `Page ${p.index + 1} was rotated ${p.rotation}° to correct its orientation.`,
      });
    }
    if (Math.abs(p.skewDeg) >= 0.25) {
      out.push({
        kind: 'QUALITY',
        severity: 'INFO',
        message: `Page ${p.index + 1} was deskewed by ${(-p.skewDeg).toFixed(1)}°.`,
      });
    }
  }
  return out;
}

export { AUTO_ACCEPT };
