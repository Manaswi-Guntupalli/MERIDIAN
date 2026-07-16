import { prisma } from '../lib/prisma.js';
import { fromJson } from '../lib/json.js';

// Presence · Face Recognition — the matching engine.
// Embeddings are 128-D neural descriptors generated on-device. We never store
// images. Matching is cosine nearest-neighbour over the school's enrolled
// vectors (a linear scan here; FAISS/pgvector is the drop-in scale option).

export const MATCH_THRESHOLD = 0.72; // cosine similarity for a confident match

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface MatchResult {
  matched: boolean;
  subjectType?: 'STUDENT' | 'TEACHER';
  subjectId?: string;
  name?: string;
  confidence: number; // 0..1 (cosine of best match)
  margin: number; // gap to the runner-up — a quality signal
}

// Search all enrolled embeddings for the best match to `query`.
export async function matchFace(schoolId: string, query: number[]): Promise<MatchResult> {
  const rows = await prisma.faceEmbedding.findMany({ where: { schoolId } });
  if (!rows.length) return { matched: false, confidence: 0, margin: 0 };

  // Best cosine similarity per enrolled subject.
  const bestBySubject = new Map<string, { sim: number; name: string; type: string; id: string }>();
  for (const r of rows) {
    const vec = fromJson<number[]>(r.vectorString, []);
    if (vec.length !== query.length) continue;
    const sim = cosine(query, vec);
    const key = `${r.subjectType}:${r.subjectId}`;
    const prev = bestBySubject.get(key);
    if (!prev || sim > prev.sim) bestBySubject.set(key, { sim, name: r.name, type: r.subjectType, id: r.subjectId });
  }

  const ranked = [...bestBySubject.values()].sort((a, b) => b.sim - a.sim);
  const top = ranked[0];
  const second = ranked[1];
  if (!top) return { matched: false, confidence: 0, margin: 0 };

  const margin = second ? top.sim - second.sim : top.sim;
  return {
    matched: top.sim >= MATCH_THRESHOLD,
    subjectType: top.type as 'STUDENT' | 'TEACHER',
    subjectId: top.id,
    name: top.name,
    confidence: Math.round(top.sim * 1000) / 1000,
    margin: Math.round(margin * 1000) / 1000,
  };
}

export interface EnrollInput {
  schoolId: string;
  subjectType: 'STUDENT' | 'TEACHER';
  subjectId: string;
  name: string;
  embeddings: { vector: number[]; label?: string; quality?: number }[];
}

export async function enrollFace(input: EnrollInput) {
  const valid = input.embeddings.filter((e) => Array.isArray(e.vector) && e.vector.length === 128);
  if (!valid.length) throw new Error('No valid 128-D embeddings provided');

  await prisma.faceEmbedding.createMany({
    data: valid.map((e) => ({
      schoolId: input.schoolId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      name: input.name,
      vectorString: JSON.stringify(e.vector),
      label: e.label ?? 'front',
      quality: e.quality ?? 0,
    })),
  });

  const count = await prisma.faceEmbedding.count({ where: { subjectId: input.subjectId } });
  if (input.subjectType === 'STUDENT') {
    await prisma.student.update({ where: { id: input.subjectId }, data: { faceEnrolled: true, faceCount: count } });
  } else {
    await prisma.teacher.update({ where: { id: input.subjectId }, data: { faceEnrolled: true, faceCount: count } });
  }
  return { stored: valid.length, total: count };
}

export async function clearFace(schoolId: string, subjectType: 'STUDENT' | 'TEACHER', subjectId: string) {
  await prisma.faceEmbedding.deleteMany({ where: { schoolId, subjectType, subjectId } });
  if (subjectType === 'STUDENT') await prisma.student.update({ where: { id: subjectId }, data: { faceEnrolled: false, faceCount: 0 } });
  else await prisma.teacher.update({ where: { id: subjectId }, data: { faceEnrolled: false, faceCount: 0 } });
}
