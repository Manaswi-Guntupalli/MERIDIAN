/// The six Meridian roles, exactly as the backend's JWT `role` claim encodes
/// them. The Flutter app reads this from the authenticated user and loads the
/// correct navigation — one app, four (six) role experiences.
enum UserRole {
  superAdmin,
  admin,
  principal,
  teacher,
  student,
  parent,
  unknown;

  static UserRole fromApi(String? v) => switch (v) {
        'SUPER_ADMIN' => UserRole.superAdmin,
        'ADMIN' => UserRole.admin,
        'PRINCIPAL' => UserRole.principal,
        'TEACHER' => UserRole.teacher,
        'STUDENT' => UserRole.student,
        'PARENT' => UserRole.parent,
        _ => UserRole.unknown,
      };

  String get label => switch (this) {
        UserRole.superAdmin => 'Super Admin',
        UserRole.admin => 'Admin',
        UserRole.principal => 'Principal',
        UserRole.teacher => 'Teacher',
        UserRole.student => 'Student',
        UserRole.parent => 'Parent',
        UserRole.unknown => 'Member',
      };

  bool get isStaff =>
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.principal ||
      this == UserRole.teacher;

  bool get isAdmin =>
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.principal;

  bool get isPrincipal =>
      this == UserRole.superAdmin || this == UserRole.principal;
}

/// The authenticated user. A pure, immutable domain model — JSON mapping lives
/// in the data layer (`AuthRepository`), keeping serialization out of the
/// domain. Mirrors the backend's `publicUser`.
///
/// (Hand-written rather than Freezed: the Dart 3.10 + build_runner "build
/// hooks" toolchain conflict blocks codegen in this environment. The shape and
/// ergonomics are identical.)
class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    required this.schoolId,
    this.avatarUrl,
    this.phone,
    this.mustChangePassword = false,
    this.schoolName,
    this.className,
    this.studentId,
  });

  final String id;
  final String name;
  final String email;
  final UserRole role;
  final String schoolId;
  final String? avatarUrl;
  final String? phone;
  final bool mustChangePassword;
  final String? schoolName;
  final String? className;
  final String? studentId;

  AppUser copyWith({
    String? name,
    String? email,
    UserRole? role,
    bool? mustChangePassword,
    String? schoolName,
    String? className,
  }) =>
      AppUser(
        id: id,
        name: name ?? this.name,
        email: email ?? this.email,
        role: role ?? this.role,
        schoolId: schoolId,
        avatarUrl: avatarUrl,
        phone: phone,
        mustChangePassword: mustChangePassword ?? this.mustChangePassword,
        schoolName: schoolName ?? this.schoolName,
        className: className ?? this.className,
        studentId: studentId,
      );

  @override
  bool operator ==(Object other) =>
      other is AppUser && other.id == id && other.role == role;

  @override
  int get hashCode => Object.hash(id, role);
}
