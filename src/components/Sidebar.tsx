import { NavLink } from "react-router-dom"
import { useAuth } from "../hooks/useAuth"

export default function Sidebar() {
  const { user } = useAuth()

  const linkStyle = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm ${
      isActive
        ? "bg-indigo-100 text-indigo-700 font-medium"
        : "text-slate-700 hover:bg-slate-100"
    }`

  return (
    <aside className="w-64 bg-white border-r border-slate-200 p-5 hidden md:flex flex-col">

      <h1 className="text-xl font-bold text-slate-900 mb-6">
        Event Feedback Application
      </h1>

      <nav className="flex flex-col gap-2">

        {/* Attendee */}

        {user?.role === "attendee" && (
          <>
            <NavLink to="/home" className={linkStyle}>
              Feedback
            </NavLink>
          </>
        )}

        {/* Stage Manager */}

        {user?.role === "stageManager" && (
          <>
            <NavLink to="/manager" className={linkStyle}>
              Manager Dashboard
            </NavLink>
          </>
        )}

        {/* Event Director */}

        {user?.role === "eventDirector" && (
          <>
            <NavLink to="/director" end className={linkStyle}>
              Director Dashboard
            </NavLink>

            <NavLink to="/director/sessions" className={linkStyle}>
              Sessions
            </NavLink>

            <NavLink to="/director/roles" className={linkStyle}>
              User Roles
            </NavLink>
          </>
        )}

      </nav>

    </aside>
  )
}