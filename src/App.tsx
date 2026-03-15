
import { ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { useAuth } from "./hooks/useAuth"

import EventDirectorDashboard from "./pages/EventDirectorDashboard"
import HomePage from "./pages/Home"
import ManagerDashboard from "./pages/ManagerDashboard"
import AuthPage from "./pages/Auth"
import RoleManagementPage from "./pages/RoleManagement"
import SessionManagementPage from "./pages/SessionManagement"

import Sidebar from "./components/Sidebar"

function AppShell({
  children,
  showSidebar,
}: {
  children: ReactNode
  showSidebar: boolean
}) {
  return (
    <div className="min-h-screen bg-slate-100 flex">
      {showSidebar && <Sidebar />}

      <main className={showSidebar ? "flex-1 p-6" : "w-full p-6"}>
        <div className="mx-auto max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  )
}

function ProtectedRoute({
  user,
  loading,
  requiredRole,
  children,
}: {
  user: any
  loading: boolean
  requiredRole?: string
  children: ReactNode
}) {

  if (loading) {
    return (
      <div className="text-center py-6 text-slate-600">
        Loading...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {

  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="text-center py-10 text-slate-600">
        Loading...
      </div>
    )
  }

  return (
    <AppShell showSidebar={Boolean(user)}>

      <Routes>

        <Route
          path="/"
          element={
            user
              ? <Navigate
                  to={
                    user.role === "eventDirector"
                      ? "/director"
                      : user.role === "stageManager"
                      ? "/manager"
                      : "/home"
                  }
                  replace
                />
              : <AuthPage />
          }
        />

        <Route
          path="/home"
          element={
            <ProtectedRoute
              user={user}
              loading={loading}
              requiredRole="attendee"
            >
              <HomePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/manager"
          element={
            <ProtectedRoute
              user={user}
              loading={loading}
              requiredRole="stageManager"
            >
              <ManagerDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/director"
          element={
            <ProtectedRoute
              user={user}
              loading={loading}
              requiredRole="eventDirector"
            >
              <EventDirectorDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/director/roles"
          element={
            <ProtectedRoute
              user={user}
              loading={loading}
              requiredRole="eventDirector"
            >
              <RoleManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/director/sessions"
          element={
            <ProtectedRoute
              user={user}
              loading={loading}
              requiredRole="eventDirector"
            >
              <SessionManagementPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>

    </AppShell>
  )
}