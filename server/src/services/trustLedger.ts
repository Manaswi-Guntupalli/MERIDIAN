import { prisma } from '../lib/prisma.js';
import { toJson, fromJson } from '../lib/json.js';
import { emitToSchool } from '../lib/socket.js';

export interface AILogInput {
  schoolId: string;
  engine: 'LUMEN' | 'KAIROS' | 'FORESIGHT' | 'COPILOT' | 'PRESENCE';
  action: string;
  reason?: string;
  confidence?: number;
  input?: unknown;
  output?: unknown;
  actorId?: string;
  reversible?: boolean;
}

// Trust Ledger — every AI action recorded with who/what/why/confidence.
export async function logAI(entry: AILogInput) {
  const log = await prisma.aILog.create({
    data: {
      schoolId: entry.schoolId,
      engine: entry.engine,
      action: entry.action,
      reason: entry.reason,
      confidence: entry.confidence,
      inputString: toJson(entry.input ?? null),
      outputString: toJson(entry.output ?? null),
      actorId: entry.actorId,
      reversible: entry.reversible ?? true,
    },
  });
  emitToSchool(entry.schoolId, 'ai:log', serializeAILog(log));
  return log;
}

export function serializeAILog(l: any) {
  return {
    id: l.id,
    engine: l.engine,
    action: l.action,
    reason: l.reason,
    confidence: l.confidence,
    input: fromJson(l.inputString, null),
    output: fromJson(l.outputString, null),
    reversible: l.reversible,
    createdAt: l.createdAt,
  };
}

export async function auditLog(entry: {
  schoolId: string;
  actorId?: string;
  action: string;
  entity: string;
  entityId?: string;
  meta?: unknown;
}) {
  return prisma.auditLog.create({
    data: {
      schoolId: entry.schoolId,
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      metaString: toJson(entry.meta ?? null),
    },
  });
}
