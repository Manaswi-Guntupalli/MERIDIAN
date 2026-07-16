export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  PRINCIPAL: 'PRINCIPAL',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES = Object.values(ROLES);

// Roles with school-wide administrative reach.
export const STAFF_ADMIN: Role[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PRINCIPAL];

// All staff (admins + teachers) — operational school access.
export const STAFF: Role[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.TEACHER];

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

export const ATTENDANCE_STATUS = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const;
export const EMERGENCY_KINDS = ['FIRE', 'EARTHQUAKE', 'MEDICAL', 'LOCKDOWN'] as const;
