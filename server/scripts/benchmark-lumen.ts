// Measure Lumen's real accuracy against ground truth.
//
//   npm --prefix server run lumen:bench          # deterministic engine only
//   npm --prefix server run lumen:bench -- --ai  # with the LLM repair pass
//
// This exists because "our OCR is 92% accurate" is not a claim anyone can make
// by looking at their own code. It is a measurement or it is marketing.
//
// The number that matters most here is not the headline accuracy — it's
// **auto-accept precision**: of the fields Lumen was confident enough to pass
// through without human review, how many were actually right? That is the only
// number a school is really trusting. A system can hit 95% accuracy and still
// be dangerous if its mistakes are the ones it feels most sure about.
//
// Clean and scanned documents are reported separately on purpose. Averaging
// them produces a single flattering number that hides which path is weak.

import fs from 'node:fs/promises';
import path from 'node:path';
import { processDocument } from '../src/services/lumen/index.js';
import { shutdownOcr } from '../src/services/lumen/ocr.js';
import { purgeDocument } from '../src/services/lumen/storage.js';
import { similarity } from '../src/services/lumen/text.js';
import { prisma } from '../src/lib/prisma.js';

const DIR = path.resolve(process.cwd(), 'fixtures', 'lumen');
const USE_AI = process.argv.includes('--ai');
const VERBOSE = process.argv.includes('--verbose');

interface Manifest {
  documents: {
    file: string;
    kind: 'clean' | 'challenge';
    challenge?: string;
    expectedType: string;
    truth: Record<string, string>;
  }[];
}

interface FieldOutcome {
  key: string;
  expected: string;
  got: string;
  exact: boolean;
  near: boolean;
  confidence: number;
  autoAccepted: boolean;
}

interface DocOutcome {
  file: string;
  kind: 'clean' | 'challenge';
  challenge?: string;
  typeCorrect: boolean;
  gotType: string;
  ms: number;
  fields: FieldOutcome[];
}

/** Whitespace and case are presentation, not accuracy. */
function eq(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
}

function pct(n: number, d: number): string {
  if (!d) return '  n/a';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function bar(value: number, width = 28): string {
  const filled = Math.round(value * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function run(): Promise<void> {
  const manifest: Manifest = JSON.parse(await fs.readFile(path.join(DIR, 'ground-truth.json'), 'utf8'));

  // findDuplicates() queries the school roster. Use a real school if the DB is
  // seeded so the duplicate path is genuinely exercised; fall back to a
  // throwaway id if not, rather than failing the whole benchmark.
  const school = await prisma.school.findFirst({ select: { id: true } }).catch(() => null);
  const schoolId = school?.id ?? 'bench-school';

  console.log(`\n  LUMEN ACCURACY BENCHMARK`);
  console.log(`  ${manifest.documents.length} documents · AI repair ${USE_AI ? 'ON' : 'OFF'} · school ${schoolId}\n`);

  const outcomes: DocOutcome[] = [];

  for (const doc of manifest.documents) {
    const buffer = await fs.readFile(path.join(DIR, doc.file));
    const documentId = `bench-${doc.file.replace(/[^a-z0-9]/gi, '-')}`;
    const t0 = Date.now();

    let result;
    try {
      result = await processDocument(
        { buffer, mimeType: 'application/pdf', fileName: doc.file },
        { schoolId, documentId, useAI: USE_AI },
      );
    } catch (err) {
      console.log(`  ✗ ${doc.file} — FAILED: ${(err as Error).message}`);
      continue;
    }
    const ms = Date.now() - t0;

    const byKey = new Map(result.fields.map((f) => [f.key, f]));
    const fields: FieldOutcome[] = Object.entries(doc.truth).map(([key, expected]) => {
      const got = byKey.get(key);
      const value = got?.value ?? '';
      return {
        key,
        expected,
        got: value,
        exact: eq(value, expected),
        near: !eq(value, expected) && similarity(value, expected) >= 0.9,
        confidence: got?.confidence ?? 0,
        autoAccepted: got?.status === 'AUTO',
      };
    });

    outcomes.push({
      file: doc.file,
      kind: doc.kind,
      challenge: doc.challenge,
      typeCorrect: result.type === doc.expectedType,
      gotType: result.type,
      ms,
      fields,
    });

    const exact = fields.filter((f) => f.exact).length;
    const source = result.pages.map((p) => p.source === 'TEXT_LAYER' ? 'txt' : 'ocr').join('+');
    const flag = doc.kind === 'challenge' ? '⚠' : ' ';
    console.log(
      `  ${flag} ${doc.file.padEnd(30)} ${String(exact).padStart(2)}/${String(fields.length).padEnd(2)} ` +
        `${pct(exact, fields.length).padStart(6)}  ${result.type === doc.expectedType ? 'type ✓' : `type ✗ (${result.type})`}` +
        `  [${source}]  ${String(ms).padStart(5)}ms`,
    );

    if (VERBOSE || doc.kind === 'challenge') {
      for (const f of fields.filter((x) => !x.exact)) {
        const tag = f.near ? 'near' : f.got ? 'WRONG' : 'MISS';
        console.log(
          `        ${tag.padEnd(5)} ${f.key.padEnd(20)} want "${f.expected}"  got "${f.got}"  (${Math.round(f.confidence * 100)}%${f.autoAccepted ? ', AUTO' : ''})`,
        );
      }
    }

    await purgeDocument(documentId);
  }

  // ─────────────────────────────  summary  ─────────────────────────────

  const summarise = (list: DocOutcome[]) => {
    const all = list.flatMap((o) => o.fields);
    const exact = all.filter((f) => f.exact).length;
    const near = all.filter((f) => f.near).length;
    const auto = all.filter((f) => f.autoAccepted);
    const autoCorrect = auto.filter((f) => f.exact).length;
    const typeOk = list.filter((o) => o.typeCorrect).length;
    const avgMs = list.length ? Math.round(list.reduce((a, o) => a + o.ms, 0) / list.length) : 0;
    return { docs: list.length, total: all.length, exact, near, auto: auto.length, autoCorrect, typeOk, avgMs };
  };

  const clean = summarise(outcomes.filter((o) => o.kind === 'clean'));
  const challenge = summarise(outcomes.filter((o) => o.kind === 'challenge'));
  const overall = summarise(outcomes);

  const line = (label: string, s: ReturnType<typeof summarise>) => {
    if (!s.docs) return;
    const acc = s.total ? s.exact / s.total : 0;
    console.log(
      `  ${label.padEnd(22)} ${bar(acc)} ${pct(s.exact, s.total).padStart(6)}   ` +
        `(${s.exact}/${s.total} exact, +${s.near} near)   type ${pct(s.typeOk, s.docs)}   ${s.avgMs}ms/doc`,
    );
  };

  console.log(`\n  ─────────────────────────────────────────────────────────────────────────────`);
  console.log(`  FIELD-LEVEL ACCURACY (exact match against ground truth)\n`);
  line('Digital PDFs', clean);
  line('Scanned / degraded', challenge);
  line('OVERALL', overall);

  console.log(`\n  ─────────────────────────────────────────────────────────────────────────────`);
  console.log(`  AUTO-ACCEPT PRECISION — the number that actually matters\n`);
  console.log(
    `  Of ${overall.auto} fields Lumen passed WITHOUT review, ${overall.autoCorrect} were correct  →  ` +
      `${pct(overall.autoCorrect, overall.auto)} precision`,
  );
  const reviewRate = overall.total ? 1 - overall.auto / overall.total : 0;
  console.log(`  ${(reviewRate * 100).toFixed(1)}% of fields were routed to a human for review.`);

  const silentErrors = outcomes.flatMap((o) => o.fields).filter((f) => f.autoAccepted && !f.exact);
  if (!overall.auto) {
    // Guard against the empty run reading like a triumph.
    console.log(`\n  (No fields were auto-accepted — nothing to check for silent errors.)`);
  } else if (silentErrors.length) {
    console.log(`\n  ⚠  ${silentErrors.length} field(s) were auto-accepted but WRONG — these are the dangerous ones:`);
    for (const f of silentErrors.slice(0, 12)) {
      console.log(`       ${f.key.padEnd(20)} want "${f.expected}"  got "${f.got}"  (${Math.round(f.confidence * 100)}%)`);
    }
  } else {
    console.log(`\n  ✓  Zero silent errors: every auto-accepted field was correct.`);
  }

  console.log(`\n  ─────────────────────────────────────────────────────────────────────────────\n`);

  await shutdownOcr();
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await shutdownOcr().catch(() => {});
  process.exit(1);
});
