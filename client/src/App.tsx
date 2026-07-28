import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { LoadingScreen } from '@/components/ui';
import AppLayout from '@/components/layout/AppLayout';
import type { Role } from '@/types';

const Login = lazy(() => import('@/pages/Login'));
const ScanAttendance = lazy(() => import('@/pages/ScanAttendance'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Students = lazy(() => import('@/pages/Students'));
const StudentDetail = lazy(() => import('@/pages/StudentDetail'));
const Staff = lazy(() => import('@/pages/Staff'));
const Classes = lazy(() => import('@/pages/Classes'));
const Attendance = lazy(() => import('@/pages/Attendance'));
const Fees = lazy(() => import('@/pages/Fees'));
const Lumen = lazy(() => import('@/pages/Lumen'));
const Kairos = lazy(() => import('@/pages/Kairos'));
const Foresight = lazy(() => import('@/pages/Foresight'));
const PresenceLayout = lazy(() => import('@/pages/presence/PresenceLayout'));
const PresenceSessions = lazy(() => import('@/pages/presence/Sessions'));
const AttendanceSessionLive = lazy(() => import('@/pages/presence/AttendanceSessionLive'));
const AttendanceSummary = lazy(() => import('@/pages/presence/AttendanceSummary'));
const PresenceActivity = lazy(() => import('@/pages/presence/Activity'));
const PresenceAnalytics = lazy(() => import('@/pages/presence/Analytics'));
const PresenceSimulator = lazy(() => import('@/pages/presence/Simulator'));
// Face recognition is the camera half of Presence — mounted as Presence tabs.
const PresenceKiosk = lazy(() => import('@/pages/FaceRecognition').then((m) => ({ default: m.LiveKiosk })));
const PresenceEnrollment = lazy(() => import('@/pages/FaceRecognition').then((m) => ({ default: m.Enrollment })));
const PresenceInsights = lazy(() => import('@/pages/FaceRecognition').then((m) => ({ default: m.Insights })));
const Twin = lazy(() => import('@/pages/Twin'));
const Trust = lazy(() => import('@/pages/Trust'));
const Reports = lazy(() => import('@/pages/Reports'));
const Emergency = lazy(() => import('@/pages/Emergency'));
const Copilot = lazy(() => import('@/pages/Copilot'));
const AiNotice = lazy(() => import('@/pages/AiNotice'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const Settings = lazy(() => import('@/pages/Settings'));
const Forbidden = lazy(() => import('@/pages/Forbidden'));
const Users = lazy(() => import('@/pages/Users'));
const ChangePassword = lazy(() => import('@/pages/ChangePassword'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid h-screen place-items-center"><LoadingScreen label="Restoring session…" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // Temp-credential holders see exactly one screen until they set their own
  // password. The server enforces the same rule (428 on everything else) —
  // this is the friendly face of it, not the security.
  if (user.mustChangePassword) return <ChangePassword />;
  return <>{children}</>;
}

// Old Presence tab URLs (pre-consolidation) — forwards bookmarks and stored
// notification links, carrying the query string across (e.g. ?studentId=…).
function LegacyRedirect({ to, extra }: { to: string; extra?: Record<string, string> }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const qs = params.toString();
  return <Navigate to={qs ? `${to}?${qs}` : to} replace />;
}

// Per-route role guard — blocks direct URL access to pages a role can't use.
function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user) return null;
  if (!roles.includes(user.role)) return <Forbidden />;
  return <>{children}</>;
}

const STAFF: Role[] = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER'];
const ADMIN: Role[] = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'];
const SUPER: Role[] = ['SUPER_ADMIN'];
const g = (roles: Role[], el: React.ReactNode) => <RequireRole roles={roles}>{el}</RequireRole>;

export default function App() {
  const fetchMe = useAuth((s) => s.fetchMe);
  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return (
    <Suspense fallback={<div className="grid h-screen place-items-center"><LoadingScreen /></div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Student QR landing — a phone-camera scan of the session QR opens this.
            Standalone (no app shell); it gates its own auth and returns here
            after login. */}
        <Route path="/scan" element={<ScanAttendance />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/students" element={g(STAFF, <Students />)} />
          <Route path="/students/:id" element={g(STAFF, <StudentDetail />)} />
          <Route path="/staff" element={g(ADMIN, <Staff />)} />
          <Route path="/classes" element={g(STAFF, <Classes />)} />
          <Route path="/attendance" element={g(STAFF, <Attendance />)} />
          <Route path="/fees" element={g(ADMIN, <Fees />)} />
          <Route path="/lumen" element={g(ADMIN, <Lumen />)} />
          <Route path="/kairos" element={g(STAFF, <Kairos />)} />
          <Route path="/notices" element={g(STAFF, <AiNotice />)} />
          <Route path="/foresight" element={g(ADMIN, <Foresight />)} />
          {/* The dedicated, projector-ready session screen lives OUTSIDE the
              Presence tab layout so it can go fullscreen cleanly. */}
          <Route path="/presence/live/:sessionId" element={g(STAFF, <AttendanceSessionLive />)} />
          {/* The post-session summary + PDF/Excel export, shown after "End attendance". */}
          <Route path="/presence/summary/:sessionId" element={g(STAFF, <AttendanceSummary />)} />
          <Route path="/presence" element={g(STAFF, <PresenceLayout />)}>
            <Route index element={<PresenceSessions />} />
            <Route path="kiosk" element={<PresenceKiosk />} />
            <Route path="enrollment" element={g(ADMIN, <PresenceEnrollment />)} />
            <Route path="activity" element={<PresenceActivity />} />
            <Route path="analytics" element={<PresenceAnalytics />} />
            <Route path="insights" element={<PresenceInsights />} />
            <Route path="simulator" element={g(ADMIN, <PresenceSimulator />)} />
            {/* Old standalone Face Recognition tab → now lives here. */}
            <Route path="face" element={<LegacyRedirect to="/presence/kiosk" />} />
            {/* Legacy Presence URLs forward to the consolidated tabs. */}
            <Route path="attendance" element={<LegacyRedirect to="/presence/activity" />} />
            <Route path="history" element={<LegacyRedirect to="/presence/activity" />} />
            <Route path="readers" element={<LegacyRedirect to="/presence" />} />
            <Route path="cards" element={<LegacyRedirect to="/presence" />} />
            <Route path="manage" element={<LegacyRedirect to="/presence" />} />
            <Route path="settings" element={<LegacyRedirect to="/presence" />} />
          </Route>
          {/* Face Recognition consolidated into Presence — forward old links. */}
          <Route path="/face-recognition" element={<LegacyRedirect to="/presence/kiosk" />} />
          <Route path="/twin" element={g(STAFF, <Twin />)} />
          <Route path="/trust" element={g(ADMIN, <Trust />)} />
          <Route path="/reports" element={g(ADMIN, <Reports />)} />
          <Route path="/emergency" element={g(STAFF, <Emergency />)} />
          <Route path="/copilot" element={g(ADMIN, <Copilot />)} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/users" element={g(ADMIN, <Users />)} />
          <Route path="/settings" element={g(SUPER, <Settings />)} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
