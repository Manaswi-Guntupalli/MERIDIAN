import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { hashPassword, comparePassword } from '../../lib/auth.js';
import { recordEvent } from '../eventStore.js';
import { auditLog } from '../trustLedger.js';
import { emitToSchool } from '../../lib/socket.js';
import { getPresenceSettings } from './settings.js';

export interface ReaderActor {
  id: string;
  name: string;
}

function generateReaderKey(): string {
  // Device secret — shown once at creation/rotation, never again.
  return `rdr_${crypto.randomBytes(24).toString('base64url')}`;
}

export async function createReader(
  input: { schoolId: string; name: string; location: string; building?: string; direction?: 'ENTRY' | 'EXIT' | 'BOTH' },
  actor?: ReaderActor,
) {
  const plainKey = generateReaderKey();
  const apiKeyHash = await hashPassword(plainKey);
  const reader = await prisma.rFIDReader.create({
    data: {
      schoolId: input.schoolId,
      name: input.name,
      location: input.location,
      building: input.building,
      direction: input.direction ?? 'BOTH',
      apiKeyHash,
    },
  });

  await recordEvent({
    schoolId: input.schoolId,
    type: 'RFID_READER_CREATED',
    aggregate: 'RFIDReader',
    aggregateId: reader.id,
    payload: { readerId: reader.id, name: reader.name, location: reader.location },
    actorId: actor?.id,
    actorName: actor?.name,
    reversible: false,
  });
  await auditLog({ schoolId: input.schoolId, actorId: actor?.id, action: 'RFID_READER_CREATED', entity: 'RFIDReader', entityId: reader.id });

  return { reader, apiKey: plainKey };
}

export async function rotateReaderKey(schoolId: string, readerId: string, actor?: ReaderActor) {
  const reader = await prisma.rFIDReader.findFirst({ where: { id: readerId, schoolId } });
  if (!reader) throw notFound('Reader not found in your school');
  const plainKey = generateReaderKey();
  const apiKeyHash = await hashPassword(plainKey);
  const updated = await prisma.rFIDReader.update({ where: { id: reader.id }, data: { apiKeyHash } });
  await auditLog({ schoolId, actorId: actor?.id, action: 'RFID_READER_KEY_ROTATED', entity: 'RFIDReader', entityId: reader.id });
  return { reader: updated, apiKey: plainKey };
}

export async function updateReader(
  schoolId: string,
  readerId: string,
  patch: Partial<{ name: string; location: string; building: string; direction: string; firmwareVersion: string }>,
  actor?: ReaderActor,
) {
  const reader = await prisma.rFIDReader.findFirst({ where: { id: readerId, schoolId } });
  if (!reader) throw notFound('Reader not found in your school');
  const updated = await prisma.rFIDReader.update({ where: { id: reader.id }, data: patch });
  await auditLog({ schoolId, actorId: actor?.id, action: 'RFID_READER_UPDATED', entity: 'RFIDReader', entityId: reader.id, meta: patch });
  return updated;
}

export async function deleteReader(schoolId: string, readerId: string, actor?: ReaderActor) {
  const reader = await prisma.rFIDReader.findFirst({ where: { id: readerId, schoolId } });
  if (!reader) throw notFound('Reader not found in your school');
  await prisma.rFIDReader.delete({ where: { id: reader.id } });
  await auditLog({ schoolId, actorId: actor?.id, action: 'RFID_READER_DELETED', entity: 'RFIDReader', entityId: reader.id, meta: { name: reader.name } });
}

export async function listReaders(schoolId: string) {
  await sweepOffline(schoolId);
  return prisma.rFIDReader.findMany({ where: { schoolId }, orderBy: { name: 'asc' } });
}

export async function getReader(schoolId: string, readerId: string) {
  const reader = await prisma.rFIDReader.findFirst({ where: { id: readerId, schoolId } });
  if (!reader) throw notFound('Reader not found in your school');
  return reader;
}

// Verifies a device-presented key against the stored hash. Used by
// authenticateReader middleware — the seam a real hardware gateway
// authenticates against instead of a user JWT.
export async function verifyReaderKey(readerId: string, plainKey: string) {
  const reader = await prisma.rFIDReader.findUnique({ where: { id: readerId } });
  if (!reader) return null;
  const ok = await comparePassword(plainKey, reader.apiKeyHash);
  return ok ? reader : null;
}

export async function recordHeartbeat(readerId: string, opts: { signal?: number; firmwareVersion?: string } = {}) {
  const reader = await prisma.rFIDReader.findUnique({ where: { id: readerId } });
  if (!reader) throw notFound('Reader not found');

  const wasOffline = !reader.online;
  const now = new Date();
  await prisma.readerHeartbeat.create({ data: { readerId, signal: opts.signal, firmwareVersion: opts.firmwareVersion } });
  const updated = await prisma.rFIDReader.update({
    where: { id: readerId },
    data: { online: true, lastHeartbeat: now, firmwareVersion: opts.firmwareVersion ?? reader.firmwareVersion },
  });

  if (wasOffline) {
    emitToSchool(reader.schoolId, 'presence:reader-status', { readerId, name: reader.name, online: true });
  }
  return updated;
}

// Flip any reader whose last heartbeat is older than the configured
// threshold to offline. Cheap (indexed, school-scoped) — called on every
// reader-list read and from a light interval in index.ts.
export async function sweepOffline(schoolId: string) {
  const settings = await getPresenceSettings(schoolId);
  const cutoff = new Date(Date.now() - settings.heartbeatOfflineThresholdSeconds * 1000);
  const stale = await prisma.rFIDReader.findMany({
    where: { schoolId, online: true, OR: [{ lastHeartbeat: null }, { lastHeartbeat: { lt: cutoff } }] },
  });
  if (!stale.length) return;
  await prisma.rFIDReader.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { online: false } });
  for (const r of stale) {
    emitToSchool(schoolId, 'presence:reader-status', { readerId: r.id, name: r.name, online: false });
  }
}

export async function sweepAllSchools() {
  const schools = await prisma.school.findMany({ select: { id: true } });
  for (const s of schools) await sweepOffline(s.id).catch(() => {});
}

// Simulator-only affordance: force a reader offline/online without waiting
// for a heartbeat timeout — never exposed on the device-facing endpoints.
export async function forceReaderOnline(schoolId: string, readerId: string, online: boolean) {
  const reader = await prisma.rFIDReader.findFirst({ where: { id: readerId, schoolId } });
  if (!reader) throw notFound('Reader not found in your school');
  const updated = await prisma.rFIDReader.update({
    where: { id: readerId },
    data: { online, lastHeartbeat: online ? new Date() : reader.lastHeartbeat },
  });
  emitToSchool(schoolId, 'presence:reader-status', { readerId, name: reader.name, online });
  return updated;
}

export function assertDirectionAllowed(readerDirection: string, requested: 'ENTRY' | 'EXIT') {
  if (readerDirection === 'BOTH') return;
  if (readerDirection !== requested) {
    throw badRequest(`This reader is configured for ${readerDirection} only.`);
  }
}
