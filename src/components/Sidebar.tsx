import { NavLink } from "react-router-dom"
import { useAuth } from "../hooks/useAuth"
import { SignOutButton } from "./SignOutButton"

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  )
}

const ICONS = {
  home:     "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  dashboard:"M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  sessions: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  roles:    "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0",
  feedback: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z",
}

const ROLE_LABELS: Record<string, string> = {
  attendee: "Attendee",
  stageManager: "Stage Manager",
  eventDirector: "Event Director",
}

export default function Sidebar() {
  const { user } = useAuth()

  const navItem = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-ted/10 text-ted border-l-2 border-ted"
        : "text-zinc-400 hover:text-white hover:bg-white/5"
    }`

  const initials = (user?.displayName || user?.email || "?")
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()

  return (
    <aside className="w-60 bg-zinc-950 flex flex-col min-h-screen shrink-0 hidden md:flex">

      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-baseline gap-2">
          <span className="text-ted font-black text-2xl tracking-tighter">EFP</span>
          <span className="text-zinc-400 text-xs font-medium">Event Feedback</span>
        </div>
        <p className="text-zinc-400 text-xs mt-0.5">Live Session Analytics</p>
      </div>

      {/* Role badge */}
      {user?.role && (
        <div className="px-5 pt-4 pb-1">
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            {ROLE_LABELS[user.role] ?? user.role}
          </span>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 text-zinc-400">

        {user?.role === "attendee" && (
          <NavLink to="/home" className={navItem}>
            <NavIcon path={ICONS.feedback} />
            Submit Feedback
          </NavLink>
        )}

        {user?.role === "stageManager" && (
          <NavLink to="/manager" className={navItem}>
            <NavIcon path={ICONS.dashboard} />
            My Dashboard
          </NavLink>
        )}

        {user?.role === "eventDirector" && (
          <>
            <NavLink to="/director" end className={navItem}>
              <NavIcon path={ICONS.dashboard} />
              Overview
            </NavLink>

            <NavLink to="/director/sessions" className={navItem}>
              <NavIcon path={ICONS.sessions} />
              Sessions
            </NavLink>

            <NavLink to="/director/roles" className={navItem}>
              <NavIcon path={ICONS.roles} />
              User Roles
            </NavLink>
          </>
        )}

      </nav>

      {/* User footer */}
      <div className="border-t border-white/5 px-4 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-ted/20 text-ted text-xs font-bold flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">
              {user?.displayName || "User"}
            </p>
            <p className="text-zinc-500 text-xs truncate">
              {user?.email}
            </p>
          </div>
        </div>
        <SignOutButton />
      </div>

    </aside>
  )
}
