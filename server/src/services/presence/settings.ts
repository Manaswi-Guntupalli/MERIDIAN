import { prisma } from '../../lib/prisma.js';

// Presence configuration, stored on the existing per-school Setting table
// under a `presence.*` namespace — no dedicated config table needed.
export interface PresenceSettings {
  schoolStartTime: string; // "HH:mm", 24h — after start+grace, entries are LATE
  lateGraceMinutes: number;
  sessionDurationMinutes: number; // an attendance session auto-expires after this
}

export const PRESENCE_SETTING_DEFAULTS: PresenceSettings = {
  schoolStartTime: '08:00',
  lateGraceMinutes: 5,
  sessionDurationMinutes: 5,
};

const KEYS: Record<keyof PresenceSettings, string> = {
  schoolStartTime: 'presence.schoolStartTime',
  lateGraceMinutes: 'presence.lateGraceMinutes',
  sessionDurationMinutes: 'presence.sessionDurationMinutes',
};

export async function getPresenceSettings(schoolId: string): Promise<PresenceSettings> {
  const rows = await prisma.setting.findMany({ where: { schoolId, key: { in: Object.values(KEYS) } } });
  const byKey = new Map(rows.map((r) => [r.key, r.valueString]));
  return {
    schoolStartTime: byKey.get(KEYS.schoolStartTime) ?? PRESENCE_SETTING_DEFAULTS.schoolStartTime,
    lateGraceMinutes: Number(byKey.get(KEYS.lateGraceMinutes) ?? PRESENCE_SETTING_DEFAULTS.lateGraceMinutes),
    sessionDurationMinutes: Number(byKey.get(KEYS.sessionDurationMinutes) ?? PRESENCE_SETTING_DEFAULTS.sessionDurationMinutes),
  };
}

export async function updatePresenceSettings(schoolId: string, patch: Partial<PresenceSettings>): Promise<PresenceSettings> {
  const entries = Object.entries(patch) as [keyof PresenceSettings, string | number][];
  for (const [field, value] of entries) {
    if (value === undefined) continue;
    const key = KEYS[field];
    await prisma.setting.upsert({
      where: { schoolId_key: { schoolId, key } },
      create: { schoolId, key, valueString: String(value) },
      update: { valueString: String(value) },
    });
  }
  return getPresenceSettings(schoolId);
}

// Minutes since local midnight for "HH:mm".
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
