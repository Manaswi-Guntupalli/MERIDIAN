import type { Role } from '@/types';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  School,
  CalendarCheck,
  CalendarClock,
  FileScan,
  Wallet,
  Radar,
  ScanFace,
  Map,
  ShieldAlert,
  History,
  Bot,
  FileBarChart,
  Bell,
  SlidersHorizontal,
  Nfc,
  UserCog,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  group: string;
  engine?: string;
}

const ALL: Role[] = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT'];
const STAFF: Role[] = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER'];
const ADMIN: Role[] = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'];
const SUPER: Role[] = ['SUPER_ADMIN'];

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL, group: 'Overview' },
  { to: '/twin', label: 'Digital Twin', icon: Map, roles: STAFF, group: 'Overview' },
  { to: '/copilot', label: 'Copilot', icon: Bot, roles: ADMIN, group: 'Overview' },

  { to: '/students', label: 'Students', icon: GraduationCap, roles: STAFF, group: 'Pulse · ERP' },
  { to: '/staff', label: 'Staff', icon: Users, roles: ADMIN, group: 'Pulse · ERP' },
  { to: '/classes', label: 'Classes', icon: School, roles: STAFF, group: 'Pulse · ERP' },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck, roles: STAFF, group: 'Pulse · ERP' },
  { to: '/fees', label: 'Fees', icon: Wallet, roles: ADMIN, group: 'Pulse · ERP' },

  { to: '/lumen', label: 'Lumen · Docs', icon: FileScan, roles: ADMIN, group: 'Engines', engine: 'LUMEN' },
  { to: '/kairos', label: 'Kairos · Timetable', icon: CalendarClock, roles: STAFF, group: 'Engines', engine: 'KAIROS' },
  { to: '/foresight', label: 'Foresight', icon: Radar, roles: ADMIN, group: 'Engines', engine: 'FORESIGHT' },
  { to: '/presence', label: 'Presence · Face', icon: Nfc, roles: STAFF, group: 'Engines', engine: 'PRESENCE' },
  { to: '/face-recognition', label: 'Face Recognition', icon: ScanFace, roles: STAFF, group: 'Engines', engine: 'PRESENCE' },

  { to: '/trust', label: 'Time Machine', icon: History, roles: ADMIN, group: 'Trust Core' },
  { to: '/users', label: 'Users & Access', icon: UserCog, roles: ADMIN, group: 'Trust Core' },
  { to: '/reports', label: 'AI Reports', icon: FileBarChart, roles: ADMIN, group: 'Trust Core' },
  { to: '/emergency', label: 'Emergency', icon: ShieldAlert, roles: STAFF, group: 'Trust Core' },
  { to: '/notifications', label: 'Notifications', icon: Bell, roles: ALL, group: 'Trust Core' },

  { to: '/settings', label: 'System Settings', icon: SlidersHorizontal, roles: SUPER, group: 'System' },
];

// Central source of truth for per-route access (used by the router guard).
export const ROUTE_ROLES: Record<string, Role[]> = {
  '/': ALL,
  '/twin': STAFF,
  '/copilot': ADMIN,
  '/students': STAFF,
  '/staff': ADMIN,
  '/classes': STAFF,
  '/attendance': STAFF,
  '/fees': ADMIN,
  '/lumen': ADMIN,
  '/kairos': STAFF,
  '/foresight': ADMIN,
  '/presence': STAFF,
  '/face-recognition': STAFF,
  '/trust': ADMIN,
  '/reports': ADMIN,
  '/emergency': STAFF,
  '/notifications': ALL,
  '/settings': SUPER,
};

export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}
