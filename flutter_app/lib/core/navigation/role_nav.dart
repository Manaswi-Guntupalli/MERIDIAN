import 'package:flutter/material.dart';

import '../../features/attendance/presentation/attendance_screen.dart';
import '../../features/auth/domain/app_user.dart';
import '../../features/copilot/presentation/copilot_screen.dart';
import '../../features/dashboard/presentation/principal_dashboard.dart';
import '../../features/emergency/presentation/emergency_screen.dart';
import '../../features/kairos/presentation/kairos_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/reports/presentation/reports_screen.dart';
import '../../features/shell/presentation/module_placeholder.dart';
import '../../features/staff/presentation/staff_screen.dart';
import '../../features/students/presentation/students_screen.dart';
import '../../shared/navigation/nav_destination.dart';

/// The per-role navigation map — the app's information architecture, mirroring
/// what each role can reach on the web (only the mobile-appropriate modules).
/// Real screens are wired directly; modules still in progress use a themed
/// placeholder, swapped for the real screen with a one-line change here.
List<MDestination> navForRole(UserRole role) => switch (role) {
      UserRole.principal || UserRole.admin || UserRole.superAdmin => _principal,
      UserRole.teacher => _teacher,
      UserRole.student => _student,
      UserRole.parent => _parent,
      UserRole.unknown => _minimal,
    };

// A real, wired screen.
MDestination _real(
  String label,
  IconData icon,
  WidgetBuilder builder, {
  IconData? selected,
}) =>
    MDestination(
        label: label, icon: icon, selectedIcon: selected, builder: builder);

// A placeholder-backed destination (its real screen arrives in a later phase).
MDestination _todo(
  String label,
  IconData icon, {
  IconData? selected,
  String? overline,
}) =>
    MDestination(
      label: label,
      icon: icon,
      selectedIcon: selected,
      builder: (_) =>
          ModulePlaceholder(title: label, icon: icon, overline: overline),
    );

// Screens that are user-scoped and shared across every role.
MDestination get _notifications => _real('Notifications',
    Icons.notifications_outlined, (_) => const NotificationsScreen(),
    selected: Icons.notifications);
MDestination get _profile => _real(
    'Profile', Icons.person_outline, (_) => const ProfileScreen(),
    selected: Icons.person);

// Principal — the lightweight command center (spec: no generation/config).
final List<MDestination> _principal = [
  _real('Dashboard', Icons.space_dashboard_outlined,
      (_) => const PrincipalDashboard(), selected: Icons.space_dashboard),
  _real('Attendance', Icons.fact_check_outlined,
      (_) => const AttendanceScreen(), selected: Icons.fact_check),
  _real('Timetable', Icons.calendar_month_outlined,
      (_) => const KairosScreen(), selected: Icons.calendar_month),
  _real('Copilot', Icons.auto_awesome_outlined, (_) => const CopilotScreen(),
      selected: Icons.auto_awesome),
  _real('Students', Icons.school_outlined, (_) => const StudentsScreen(),
      selected: Icons.school),
  _real('Staff', Icons.groups_2_outlined, (_) => const StaffScreen(),
      selected: Icons.groups_2),
  _real('Reports', Icons.bar_chart_outlined, (_) => const ReportsScreen(),
      selected: Icons.bar_chart),
  _real('Emergency', Icons.crisis_alert_outlined,
      (_) => const EmergencyScreen(), selected: Icons.crisis_alert),
  _notifications,
  _profile,
];

// Teacher — feature parity where it makes sense on a phone.
final List<MDestination> _teacher = [
  _todo('Dashboard', Icons.space_dashboard_outlined, selected: Icons.space_dashboard),
  _todo('Attendance', Icons.fact_check_outlined, selected: Icons.fact_check, overline: 'Presence'),
  _todo('Timetable', Icons.calendar_month_outlined, selected: Icons.calendar_month, overline: 'Kairos'),
  _todo('My Classes', Icons.class_outlined, selected: Icons.class_),
  _notifications,
  _profile,
];

// Student — timetable, attendance (scan), fees, alerts.
final List<MDestination> _student = [
  _todo('Home', Icons.home_outlined, selected: Icons.home),
  _todo('Timetable', Icons.calendar_month_outlined, selected: Icons.calendar_month),
  _todo('Attendance', Icons.qr_code_scanner_outlined, selected: Icons.qr_code_scanner, overline: 'Scan'),
  _todo('Fees', Icons.account_balance_wallet_outlined, selected: Icons.account_balance_wallet),
  _notifications,
  _profile,
];

// Parent — the child's day, fees, alerts.
final List<MDestination> _parent = [
  _todo('Home', Icons.home_outlined, selected: Icons.home),
  _todo('Attendance', Icons.fact_check_outlined, selected: Icons.fact_check),
  _todo('Fees', Icons.account_balance_wallet_outlined, selected: Icons.account_balance_wallet),
  _notifications,
  _profile,
];

final List<MDestination> _minimal = [
  _todo('Home', Icons.home_outlined, selected: Icons.home),
  _profile,
];
