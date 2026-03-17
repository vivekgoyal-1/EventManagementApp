import { ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { useAuth } from "./hooks/useAuth"

import EventDirectorDashboard from "./pages/EventDirectorDashboard"
import HomePage from "./pages/Home"
import ManagerDashboard from "./pages/ManagerDashboard"
import AuthPage from "./pages/Auth"
import ProfilePage from "./pages/Profile"
import RoleManagementPage from "./pages/RoleManagement"
import SessionManagementPage from "./pages/SessionManagement"
import SessionDetail from "./pages/SessionDetail"

import Sidebar from "./components/Sidebar"

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-100">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}

function ProtectedRoute({
  user,
  requiredRole,
  children,
}: {
  user: any
  requiredRole?: string
  children: ReactNode
}) {
  if (!user) return <Navigate to="/" replace />

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-950">
        <div className="text-center">
          <p className="text-ted text-3xl font-black tracking-tight">EFP</p>
          <p className="text-zinc-500 text-sm mt-1">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) return <AuthPage />

  return (
    <AppShell>
      <Routes>

        <Route
          path="/"
          element={
            <Navigate
              to={
                user.role === "eventDirector"
                  ? "/director"
                  : user.role === "stageManager"
                  ? "/manager"
                  : "/home"
              }
              replace
            />
          }
        />

        <Route
          path="/home"
          element={
            <ProtectedRoute user={user} requiredRole="attendee">
              <HomePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/manager"
          element={
            <ProtectedRoute user={user} requiredRole="stageManager">
              <ManagerDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/director"
          element={
            <ProtectedRoute user={user} requiredRole="eventDirector">
              <EventDirectorDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/director/roles"
          element={
            <ProtectedRoute user={user} requiredRole="eventDirector">
              <RoleManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/director/sessions"
          element={
            <ProtectedRoute user={user} requiredRole="eventDirector">
              <SessionManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/session/:sessionId"
          element={
            <ProtectedRoute user={user} >
              <SessionDetail />
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <ProtectedRoute user={user} >
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </AppShell>
  )
}
