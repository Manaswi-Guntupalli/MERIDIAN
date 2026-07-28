import 'package:flutter/material.dart';

import '../../features/attendance/presentation/attendance_screen.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/copilot/presentation/copilot_screen.dart';
import '../../features/dashboard/presentation/principal_dashboard.dart';
import '../../features/emergency/presentation/emergency_screen.dart';
import '../../features/family/presentation/family_detail_screens.dart';
import '../../features/family/presentation/family_home_screen.dart';
import '../../features/kairos/presentation/kairos_screen.dart';
import '../../features/notices/presentation/ai_notice_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/reports/presentation/reports_screen.dart';
import '../../features/staff/presentation/staff_screen.dart';
import '../../features/student/presentation/scan_screen.dart';
import '../../features/students/presentation/students_screen.dart';
import '../../features/teacher/presentation/my_classes_screen.dart';
import '../../features/teacher/presentation/teacher_dashboard.dart';
import '../../features/timetable/presentation/weekly_timetable_screen.dart';
import '../../shared/navigation/nav_destination.dart';
import '../../shared/widgets/app_background.dart';

/// The per-role navigation map — the app's information architecture, mirroring
/// what each role can reach on the web (only the mobile-appropriate modules).
/// Every destination is a real screen; each carries the web sidebar group of
/// its route, which drives the ambient page tint.
List<MDestination> navForRole(UserRole role) => switch (role) {
      UserRole.principal || UserRole.admin || UserRole.superAdmin => _principal,
      UserRole.teacher => _teacher,
      UserRole.student => _student,
      UserRole.parent => _parent,
      UserRole.unknown => _minimal,
    };

// A real, wired screen. `group` mirrors the web sidebar group of the same
// route (client/src/constants/nav.ts) and drives the ambient page tint.
MDestination _real(
  String label,
  IconData icon,
  WidgetBuilder builder, {
  IconData? selected,
  NavGroup group = NavGroup.overview,
  String? navLabel,
}) =>
    MDestination(
        label: label,
        icon: icon,
        selectedIcon: selected,
        builder: builder,
        group: group,
        navLabel: navLabel);


// Screens that are user-scoped and shared across every role.
// Notifications sits in Trust Core on the web; Profile has no web route, so it
// takes the System hue the web gives account/settings pages.
MDestination get _notifications => _real('Notifications',
    Icons.notifications_outlined, (_) => const NotificationsScreen(),
    selected: Icons.notifications,
    group: NavGroup.trustCore,
    navLabel: 'Alerts');
MDestination get _profile => _real(
    'Profile', Icons.person_outline, (_) => const ProfileScreen(),
    selected: Icons.person, group: NavGroup.system);

// Principal — the lightweight command center (spec: no generation/config).
final List<MDestination> _principal = [
  // Groups match the web routes: / and /copilot are Overview; /students,
  // /staff and /attendance are Pulse · ERP; /kairos is Engines; /reports and
  // /emergency are Trust Core.
  _real('Dashboard', Icons.space_dashboard_outlined,
      (_) => const PrincipalDashboard(),
      selected: Icons.space_dashboard, group: NavGroup.overview),
  _real('Attendance', Icons.fact_check_outlined,
      (_) => const AttendanceScreen(),
      selected: Icons.fact_check, group: NavGroup.pulse),
  _real('Timetable', Icons.calendar_month_outlined, (_) => const KairosScreen(),
      selected: Icons.calendar_month, group: NavGroup.engines),
  _real('Copilot', Icons.auto_awesome_outlined, (_) => const CopilotScreen(),
      selected: Icons.auto_awesome, group: NavGroup.overview),
  _real('Students', Icons.school_outlined, (_) => const StudentsScreen(),
      selected: Icons.school, group: NavGroup.pulse),
  _real('Staff', Icons.groups_2_outlined, (_) => const StaffScreen(),
      selected: Icons.groups_2, group: NavGroup.pulse),
  _real('Reports', Icons.bar_chart_outlined, (_) => const ReportsScreen(),
      selected: Icons.bar_chart, group: NavGroup.trustCore),
  _real('Emergency', Icons.crisis_alert_outlined, (_) => const EmergencyScreen(),
      selected: Icons.crisis_alert, group: NavGroup.trustCore),
  _real('AI Notice', Icons.campaign_outlined, (_) => const AiNoticeScreen(),
      selected: Icons.campaign, group: NavGroup.trustCore, navLabel: 'Notice'),
  _notifications,
  _profile,
];

// Teacher — their own load and roll-call. No school-wide admin surfaces.
final List<MDestination> _teacher = [
  _real('Dashboard', Icons.space_dashboard_outlined,
      (_) => const TeacherDashboard(),
      selected: Icons.space_dashboard, group: NavGroup.overview),
  _real('My Classes', Icons.class_outlined, (_) => const MyClassesScreen(),
      selected: Icons.class_, group: NavGroup.pulse),
  _real('Timetable', Icons.calendar_month_outlined,
      (_) => const WeeklyTimetableScreen(),
      selected: Icons.calendar_month, group: NavGroup.engines),
  _real('AI Notice', Icons.campaign_outlined, (_) => const AiNoticeScreen(),
      selected: Icons.campaign, group: NavGroup.trustCore, navLabel: 'Notice'),
  _notifications,
  _profile,
];

// Student — their day, their week, self-scan, their fees.
final List<MDestination> _student = [
  _real('Home', Icons.home_outlined, (_) => const FamilyHomeScreen(),
      selected: Icons.home, group: NavGroup.overview),
  _real('Scan', Icons.qr_code_scanner_outlined, (_) => const ScanScreen(),
      selected: Icons.qr_code_scanner, group: NavGroup.pulse),
  _real('Timetable', Icons.calendar_month_outlined,
      (_) => const WeeklyTimetableScreen(),
      selected: Icons.calendar_month, group: NavGroup.engines),
  _real('Fees', Icons.account_balance_wallet_outlined,
      (_) => const FamilyFeesScreen(),
      selected: Icons.account_balance_wallet, group: NavGroup.pulse),
  _notifications,
  _profile,
];

// Parent — the child's day, attendance and fees. Same screens as the student,
// with a child selector, exactly as the web's FamilyDashboard serves both.
final List<MDestination> _parent = [
  _real('Home', Icons.home_outlined, (_) => const FamilyHomeScreen(),
      selected: Icons.home, group: NavGroup.overview),
  _real('Attendance', Icons.fact_check_outlined,
      (_) => const FamilyAttendanceScreen(),
      selected: Icons.fact_check, group: NavGroup.pulse),
  _real('Fees', Icons.account_balance_wallet_outlined,
      (_) => const FamilyFeesScreen(),
      selected: Icons.account_balance_wallet, group: NavGroup.pulse),
  _notifications,
  _profile,
];

// An unrecognised role still gets its own account and alerts, never a blank app.
final List<MDestination> _minimal = [_notifications, _profile];
