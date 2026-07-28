import { Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider } from "./contexts/auth-context"
import AppShell from "./components/layout/app-shell"
import LoginPage from "./pages/login"
import RegisterPage from "./pages/register"
import PendingApprovalPage from "./pages/pending-approval"
import LandingPage from "./pages/landing"
import AdminDashboard from "./pages/admin/dashboard"
import ApprovalsPage from "./pages/admin/approvals"
import UsersPage from "./pages/admin/users"
import BranchesPage from "./pages/admin/branches"
import GroupsPage from "./pages/admin/groups"
import CalendarPage from "./pages/admin/calendar"
import ContentPage from "./pages/admin/content"
import TeacherDashboard from "./pages/teacher/dashboard"
import TeacherGroups from "./pages/teacher/groups"
import TeacherQuran from "./pages/teacher/quran"
import TeacherExams from "./pages/teacher/exams"
import TeacherContent from "./pages/teacher/content"
import ParentDashboard from "./pages/parent/dashboard"
import StudentDashboard from "./pages/student/dashboard"
import SettingsPage from "./pages/admin/settings"

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/pending-approval" element={<PendingApprovalPage />} />

        {/* App shell */}
        <Route element={<AppShell />}>
          {/* Admin */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/approvals" element={<ApprovalsPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/branches" element={<BranchesPage />} />
          <Route path="/admin/groups" element={<GroupsPage />} />
          <Route path="/admin/calendar" element={<CalendarPage />} />
          <Route path="/admin/content" element={<ContentPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />

          {/* Teacher */}
          <Route path="/teacher" element={<TeacherDashboard />} />
          <Route path="/teacher/groups" element={<TeacherGroups />} />
          <Route path="/teacher/quran" element={<TeacherQuran />} />
          <Route path="/teacher/exams" element={<TeacherExams />} />
          <Route path="/teacher/content" element={<TeacherContent />} />

          {/* Parent & Student */}
          <Route path="/parent" element={<ParentDashboard />} />
          <Route path="/student" element={<StudentDashboard />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
