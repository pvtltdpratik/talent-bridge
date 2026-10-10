import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { AppShell } from './layouts/AppShell.jsx';
import { PublicLayout } from './layouts/PublicLayout.jsx';
import { adminNav, placementNav, placementNavForAdmin, studentNav } from './layouts/navs.jsx';
import { FullPageLoading, HomeRedirect, PublicOnly, RequireRole } from './routes/guards.jsx';
import { EmptyState } from './components/feedback.jsx';
import {
  AcceptInvitePage, AccountStatusPage, ForgotPasswordPage, LoginPage, PrivacyPage, RegisterPage, ResetPasswordPage,
} from './pages/public/auth.jsx';

// Role areas are code-split so a student never downloads the admin bundle.
const StudentDashboard = lazy(() => import('./pages/student/Dashboard.jsx'));
const StudentProfile = lazy(() => import('./pages/student/Profile.jsx'));
const StudentResume = lazy(() => import('./pages/student/Resume.jsx'));
const StudentDrives = lazy(() => import('./pages/student/Drives.jsx'));
const StudentDriveDetail = lazy(() => import('./pages/student/DriveDetail.jsx'));
const StudentApplications = lazy(() => import('./pages/student/Applications.jsx'));
const StudentInterviews = lazy(() => import('./pages/student/Interviews.jsx'));
const StudentRoadmap = lazy(() => import('./pages/student/Roadmap.jsx'));
const StudentSettings = lazy(() => import('./pages/student/Settings.jsx'));
const Notifications = lazy(() => import('./pages/shared/Notifications.jsx'));

const PlacementDashboard = lazy(() => import('./pages/placement/Dashboard.jsx'));
const PlacementStudents = lazy(() => import('./pages/placement/Students.jsx'));
const PlacementStudentDetail = lazy(() => import('./pages/placement/StudentDetail.jsx'));
const PlacementCompanies = lazy(() => import('./pages/placement/Companies.jsx'));
const PlacementCompanyWorkspace = lazy(() => import('./pages/placement/CompanyWorkspace.jsx'));
const PlacementDrives = lazy(() => import('./pages/placement/Drives.jsx'));
const PlacementDriveForm = lazy(() => import('./pages/placement/DriveForm.jsx'));
const PlacementDriveDetail = lazy(() => import('./pages/placement/DriveDetail.jsx'));
const PlacementApplications = lazy(() => import('./pages/placement/Applications.jsx'));
const PlacementExceptions = lazy(() => import('./pages/placement/Exceptions.jsx'));
const PlacementInterviews = lazy(() => import('./pages/placement/Interviews.jsx'));
const PlacementAnalytics = lazy(() => import('./pages/placement/Analytics.jsx'));

const AdminDashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/Users.jsx'));
const AdminApprovals = lazy(() => import('./pages/admin/Approvals.jsx'));
const AdminColleges = lazy(() => import('./pages/admin/Colleges.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/AuditLog.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/Settings.jsx'));

function PlacementShell() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  return (
    <AppShell
      nav={admin ? placementNavForAdmin : placementNav}
      roleLabel={admin ? 'Administrator · placement area' : 'Placement cell'}
      notificationsPath={admin ? '/admin/notifications' : '/placement/notifications'}
      adminScope={admin}
    />
  );
}

export default function App() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route element={<PublicLayout />}>
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/account-status" element={<AccountStatusPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Route>

        <Route element={<RequireRole roles={['student']} />}>
          <Route path="/student" element={<AppShell nav={studentNav} roleLabel="Student" notificationsPath="/student/notifications" />}>
            <Route index element={<StudentDashboard />} />
            <Route path="profile" element={<StudentProfile />} />
            <Route path="resume" element={<StudentResume />} />
            <Route path="drives" element={<StudentDrives />} />
            <Route path="drives/:id" element={<StudentDriveDetail />} />
            <Route path="applications" element={<StudentApplications />} />
            <Route path="interviews" element={<StudentInterviews />} />
            <Route path="roadmap" element={<StudentRoadmap />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<StudentSettings />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['placement_cell', 'admin']} />}>
          <Route path="/placement" element={<PlacementShell />}>
            <Route index element={<PlacementDashboard />} />
            <Route path="students" element={<PlacementStudents />} />
            <Route path="students/:id" element={<PlacementStudentDetail />} />
            <Route path="companies" element={<PlacementCompanies />} />
            <Route path="companies/:id" element={<PlacementCompanyWorkspace />} />
            <Route path="drives" element={<PlacementDrives />} />
            <Route path="drives/new" element={<PlacementDriveForm />} />
            <Route path="drives/:id" element={<PlacementDriveDetail />} />
            <Route path="drives/:id/edit" element={<PlacementDriveForm />} />
            <Route path="applications" element={<PlacementApplications />} />
            <Route path="exceptions" element={<PlacementExceptions />} />
            <Route path="interviews" element={<PlacementInterviews />} />
            <Route path="analytics" element={<PlacementAnalytics />} />
            <Route path="notifications" element={<Notifications />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['admin']} />}>
          <Route path="/admin" element={<AppShell nav={adminNav} roleLabel="Administrator" notificationsPath="/admin/notifications" adminScope />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="approvals" element={<AdminApprovals />} />
            <Route path="colleges" element={<AdminColleges />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="notifications" element={<Notifications />} />
          </Route>
        </Route>

        <Route path="*" element={<EmptyState title="Page not found" description="The page you are looking for does not exist." />} />
      </Routes>
    </Suspense>
  );
}

// kept for tests / future redirects
export const Fallback = () => <Navigate to="/" replace />;
