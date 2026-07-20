// Emergency Coordination — the Trust Core service that turns one button press
// into a coordinated, audited, event-driven cascade across the ERP.
//
// Reuses the platform's existing machinery — notifications, the event store,
// the immutable audit log, realtime sockets — rather than duplicating any of
// it. Nothing here fabricates status: class safety and acknowledgement counts
// are always derived from real EmergencyAck rows.

import { prisma } from '../lib/prisma.js';
import { badRequest, locked, notFound } from '../lib/errors.js';
import { recordEvent } from './eventStore.js';
import { auditLog } from './trustLedger.js';
import { notify } from './notifications.js';
import { emitToSchool } from '../lib/socket.js';

export type EmergencyKind = 'FIRE' | 'EARTHQUAKE' | 'MEDICAL' | 'LOCKDOWN';

interface EmergencyType {
  title: string;
  description: string;
  instruction: string; // the broadcast evacuation protocol
  severity: 'CRITICAL' | 'WARNING';
  notifyStudents: boolean;
  // Role-specific standing instructions shown on each user's device.
  roleInstructions: { staff: string[]; parent: string[]; student: string[] };
}

// Static, code-defined protocol config — not data, not invented at runtime.
export const EMERGENCY_TYPES: Record<EmergencyKind, EmergencyType> = {
  FIRE: {
    title: 'Fire Emergency',
    description: 'A fire has been reported on campus. Evacuation is in progress.',
    instruction: 'Evacuate via the nearest fire exit to the main assembly ground. Do not use lifts.',
    severity: 'CRITICAL',
    notifyStudents: false,
    roleInstructions: {
      staff: ['Evacuate your students calmly via the nearest exit.', 'Take a headcount at the assembly point.', 'Report your class status below: Safe or Need Assistance.'],
      parent: ['There is a fire emergency at school and students are being evacuated safely.', 'Please do NOT come to campus yet — roads must stay clear for emergency services.', 'Acknowledge below so the school knows you are informed; wait for official updates.'],
      student: ['Follow your teacher to the assembly ground calmly.', 'Do not stop to collect belongings.'],
    },
  },
  EARTHQUAKE: {
    title: 'Earthquake Emergency',
    description: 'Seismic activity detected. Drop, cover, and hold protocol is in effect.',
    instruction: 'Drop, cover, hold. After shaking stops, move to the open field via marked routes.',
    severity: 'CRITICAL',
    notifyStudents: false,
    roleInstructions: {
      staff: ['Instruct students to drop, cover and hold until shaking stops.', 'Then evacuate to the open field along marked routes.', 'Report your class status below once accounted for.'],
      parent: ['An earthquake protocol is active at school. Students are sheltering, then moving to open ground.', 'Please stay away from campus until the all-clear; acknowledge below.'],
      student: ['Drop, cover and hold. Stay away from windows.', 'Move to the open field only when your teacher says so.'],
    },
  },
  MEDICAL: {
    title: 'Medical Emergency',
    description: 'A medical emergency has been reported. The medical team has been dispatched.',
    instruction: 'Medical team dispatched. Clear the corridor; keep the patient still until help arrives.',
    severity: 'WARNING',
    notifyStudents: false,
    roleInstructions: {
      staff: ['Keep your class calm and in place unless told otherwise.', 'Clear corridors so the medical team can move quickly.', 'Confirm your class is accounted for below.'],
      parent: ['A medical situation is being handled at school by staff and the medical team.', 'Normal classes continue; acknowledge below. You will be contacted directly only if your child is involved.'],
      student: ['Stay with your class and remain calm.', 'Keep corridors clear for the medical team.'],
    },
  },
  LOCKDOWN: {
    title: 'Lockdown',
    description: 'A lockdown has been initiated. Secure all rooms and await the all-clear.',
    instruction: 'Lock all doors, move away from windows, stay silent until the all-clear is given.',
    severity: 'CRITICAL',
    notifyStudents: false,
    roleInstructions: {
      staff: ['Lock your door, switch off lights, move students away from windows.', 'Keep everyone silent and out of sight.', 'Report your room status below without leaving the room.'],
      parent: ['A lockdown is in effect at school as a precaution. Students are secured in their rooms with staff.', 'Please do NOT come to campus or call the school — keep lines clear. Acknowledge below and await official updates.'],
      student: ['Stay quiet, away from doors and windows, and follow your teacher.', 'Do not use your phone to make noise.'],
    },
  },
};

export function isValidKind(kind: string): kind is EmergencyKind {
  return kind in EMERGENCY_TYPES;
}

interface Actor {
  id: string;
  name: string;
  schoolId: string;
}

async function timeline(incidentId: string, type: string, message: string, actorName?: string) {
  return prisma.emergencyEvent.create({ data: { incidentId, type, message, actorName } });
}

// ── Activation: create the incident, then fan the cascade out ──
export async function activateEmergency(actor: Actor, kind: EmergencyKind, note?: string) {
  const schoolId = actor.schoolId;

  // One active incident per school at a time — a second FIRE button press
  // during an active incident must not spawn a parallel incident.
  const existing = await prisma.emergencyIncident.findFirst({ where: { schoolId, status: 'ACTIVE' } });
  if (existing) throw badRequest(`A ${existing.kind} emergency is already active. Resolve it before triggering another.`);

  const type = EMERGENCY_TYPES[kind];
  const incident = await prisma.emergencyIncident.create({
    data: { schoolId, kind, severity: type.severity, status: 'ACTIVE', triggeredBy: actor.name, triggeredById: actor.id, note },
  });

  // 6. Immutable audit + event-store record of the trigger.
  await auditLog({ schoolId, actorId: actor.id, action: 'EMERGENCY_ACTIVATED', entity: 'EmergencyIncident', entityId: incident.id, meta: { kind, note } });
  // recordEvent (no tx) emits 'event:new' itself — no manual emit needed.
  await recordEvent({
    schoolId,
    type: 'EMERGENCY_TRIGGERED',
    aggregate: 'Emergency',
    aggregateId: incident.id,
    payload: { kind, severity: type.severity, note },
    actorId: actor.id,
    actorName: actor.name,
    reversible: false,
  });

  // Timeline: activation, then each coordinated step (locks + notifications).
  await timeline(incident.id, 'ACTIVATED', `${type.title} activated`, actor.name);

  // 1. Broadcast notifications, role-appropriately. Students only when the
  //    protocol calls for it. Uses the existing notification system.
  const roles: string[] = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER', 'PARENT'];
  if (type.notifyStudents) roles.push('STUDENT');
  const recipients = await prisma.user.findMany({ where: { schoolId, role: { in: roles }, active: true }, select: { id: true, role: true } });
  for (const u of recipients) {
    const audience = u.role === 'PARENT' ? 'parent' : u.role === 'STUDENT' ? 'student' : 'staff';
    await notify({
      schoolId,
      userId: u.id,
      title: `🚨 ${type.title}`,
      body: `${type.instruction} ${type.roleInstructions[audience][0]}`,
      severity: 'CRITICAL',
      category: 'EMERGENCY',
      action: { href: '/emergency' },
    });
  }
  await timeline(incident.id, 'NOTIFIED', `Notified ${recipients.length} people (teachers, parents, administrators)`);
  await auditLog({ schoolId, actorId: actor.id, action: 'EMERGENCY_NOTIFICATIONS_SENT', entity: 'EmergencyIncident', entityId: incident.id, meta: { count: recipients.length } });

  // 2 + 4 + 5. Banner, attendance lock, timetable pause — all derived from the
  //    incident being ACTIVE. Recorded on the timeline so the freeze is auditable.
  await timeline(incident.id, 'BANNER', 'Emergency banner displayed on every device');
  await timeline(incident.id, 'ATTENDANCE_LOCKED', 'Attendance editing frozen (history stays readable)');
  await timeline(incident.id, 'TIMETABLE_PAUSED', 'Timetable modifications paused');

  emitToSchool(schoolId, 'emergency:trigger', { kind, protocol: type.instruction, incidentId: incident.id });

  return { incident, type };
}

// ── Resolution: lift the freeze, broadcast all-clear ──
export async function resolveEmergency(actor: Actor, incidentId: string) {
  const schoolId = actor.schoolId;
  const incident = await prisma.emergencyIncident.findFirst({ where: { id: incidentId, schoolId } });
  if (!incident) throw notFound('Incident not found');
  if (incident.status === 'RESOLVED') throw badRequest('This incident is already resolved.');

  const updated = await prisma.emergencyIncident.update({
    where: { id: incident.id },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actor.name, resolvedById: actor.id },
  });

  await auditLog({ schoolId, actorId: actor.id, action: 'EMERGENCY_RESOLVED', entity: 'EmergencyIncident', entityId: incident.id });
  await recordEvent({
    schoolId,
    type: 'EMERGENCY_RESOLVED',
    aggregate: 'Emergency',
    aggregateId: incident.id,
    payload: { kind: incident.kind },
    actorId: actor.id,
    actorName: actor.name,
    reversible: false,
  });
  await timeline(incident.id, 'RESOLVED', `${EMERGENCY_TYPES[incident.kind as EmergencyKind]?.title ?? incident.kind} marked resolved`, actor.name);

  // All-clear broadcast — attendance and timetable unlock automatically since
  // no incident is ACTIVE any more.
  const recipients = await prisma.user.findMany({ where: { schoolId, active: true }, select: { id: true } });
  for (const u of recipients) {
    await notify({ schoolId, userId: u.id, title: '✅ All clear', body: `The ${incident.kind.toLowerCase()} emergency is resolved. Normal operations have resumed.`, severity: 'SUCCESS', category: 'EMERGENCY' });
  }

  emitToSchool(schoolId, 'emergency:resolve', { incidentId: incident.id });
  return updated;
}

// ── Acknowledgement: a teacher reports class status, or a parent acknowledges ──
export async function acknowledge(actor: Actor, incidentId: string, role: 'TEACHER' | 'PARENT', status: string, note?: string) {
  const schoolId = actor.schoolId;
  const incident = await prisma.emergencyIncident.findFirst({ where: { id: incidentId, schoolId } });
  if (!incident) throw notFound('Incident not found');
  if (incident.status !== 'ACTIVE') throw badRequest('This incident is already resolved.');

  const allowed = role === 'TEACHER' ? ['SAFE', 'NEED_ASSISTANCE'] : ['ACKNOWLEDGED', 'NEED_INFO'];
  if (!allowed.includes(status)) throw badRequest(`Invalid status "${status}" for a ${role.toLowerCase()}.`);

  // A teacher's class is the class they are class-teacher of (derived, not typed).
  let classId: string | undefined;
  let className: string | undefined;
  if (role === 'TEACHER') {
    const teacher = await prisma.teacher.findFirst({ where: { schoolId, userId: actor.id }, include: { classesLed: { select: { id: true, name: true } } } });
    const cls = teacher?.classesLed[0];
    classId = cls?.id;
    className = cls?.name;
  }

  const ack = await prisma.emergencyAck.upsert({
    where: { incidentId_userId: { incidentId, userId: actor.id } },
    create: { incidentId, userId: actor.id, userName: actor.name, role, classId, className, status, note },
    update: { status, note, className, classId },
  });

  await auditLog({ schoolId, actorId: actor.id, action: role === 'TEACHER' ? 'EMERGENCY_TEACHER_ACK' : 'EMERGENCY_PARENT_ACK', entity: 'EmergencyIncident', entityId: incident.id, meta: { status, className } });

  const label =
    role === 'TEACHER'
      ? `${actor.name} reported ${className ?? 'their class'} ${status === 'SAFE' ? 'Safe' : 'Need Assistance'}`
      : `${actor.name} ${status === 'ACKNOWLEDGED' ? 'acknowledged' : 'requested information'}`;
  await timeline(incident.id, role === 'TEACHER' ? 'TEACHER_ACK' : 'PARENT_ACK', label, actor.name);

  emitToSchool(schoolId, 'emergency:ack', { incidentId, role, status });
  return ack;
}

// ── Live coordination state for the principal dashboard (all derived) ──
export async function getIncidentState(schoolId: string, incidentId: string) {
  const incident = await prisma.emergencyIncident.findFirst({
    where: { id: incidentId, schoolId },
    include: { acks: true, events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!incident) throw notFound('Incident not found');

  const [teachers, parents, classes] = await Promise.all([
    prisma.teacher.findMany({ where: { schoolId }, include: { user: { select: { name: true } }, classesLed: { select: { id: true, name: true } } } }),
    prisma.parent.count({ where: { schoolId } }),
    prisma.class.findMany({ where: { schoolId }, select: { id: true, name: true, classTeacherId: true }, orderBy: { name: 'asc' } }),
  ]);

  const teacherAcks = incident.acks.filter((a) => a.role === 'TEACHER');
  const parentAcks = incident.acks.filter((a) => a.role === 'PARENT');
  const ackByUser = new Map(teacherAcks.map((a) => [a.userId, a]));

  const safe = teacherAcks.filter((a) => a.status === 'SAFE').length;
  const needAssistance = teacherAcks.filter((a) => a.status === 'NEED_ASSISTANCE').length;
  const pendingTeachers = teachers
    .filter((t) => !ackByUser.has(t.userId))
    .map((t) => ({ name: t.user.name, className: t.classesLed[0]?.name ?? null }));

  // Class status derived strictly from the class-teacher's acknowledgement.
  const ackByClass = new Map(teacherAcks.filter((a) => a.classId).map((a) => [a.classId!, a]));
  const classStatuses = classes.map((c) => {
    const a = ackByClass.get(c.id);
    return { classId: c.id, name: c.name, status: a ? (a.status === 'SAFE' ? 'SAFE' : 'NEED_ASSISTANCE') : 'PENDING' };
  });

  const ackedParents = parentAcks.filter((a) => a.status === 'ACKNOWLEDGED').length;
  const needInfoParents = parentAcks.filter((a) => a.status === 'NEED_INFO').length;

  return {
    incident: {
      id: incident.id,
      kind: incident.kind,
      severity: incident.severity,
      status: incident.status,
      triggeredBy: incident.triggeredBy,
      note: incident.note,
      createdAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
      resolvedBy: incident.resolvedBy,
      title: EMERGENCY_TYPES[incident.kind as EmergencyKind]?.title ?? incident.kind,
      instruction: EMERGENCY_TYPES[incident.kind as EmergencyKind]?.instruction ?? '',
    },
    teachers: {
      total: teachers.length,
      safe,
      needAssistance,
      pending: teachers.length - teacherAcks.length,
      pendingList: pendingTeachers,
    },
    parents: {
      total: parents,
      acknowledged: ackedParents,
      needInfo: needInfoParents,
      waiting: Math.max(parents - parentAcks.length, 0),
      acknowledgedPct: parents ? Math.round((ackedParents / parents) * 100) : 0,
    },
    classStatuses,
    needAssistanceList: teacherAcks.filter((a) => a.status === 'NEED_ASSISTANCE').map((a) => ({ teacher: a.userName, className: a.className, note: a.note, at: a.createdAt })),
    timeline: incident.events.map((e) => ({ id: e.id, type: e.type, message: e.message, actorName: e.actorName, at: e.createdAt })),
    locks: { attendance: incident.status === 'ACTIVE', timetable: incident.status === 'ACTIVE' },
  };
}

export async function getActiveIncident(schoolId: string) {
  return prisma.emergencyIncident.findFirst({ where: { schoolId, status: 'ACTIVE' } });
}

// Guard used by attendance/timetable mutation routes.
export async function assertNotLocked(schoolId: string, feature: 'Attendance' | 'Timetable') {
  const active = await getActiveIncident(schoolId);
  if (active) {
    throw locked(
      `${feature} changes are frozen during the active ${active.kind} emergency. History stays readable; changes resume when the incident is resolved.`,
    );
  }
}
