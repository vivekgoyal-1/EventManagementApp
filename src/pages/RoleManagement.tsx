import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { httpsCallable } from "firebase/functions"

import { functions } from "../services/firebase"

type UserRole = "attendee" | "stageManager" | "eventDirector"

type RoleUser = {
  uid: string
  email: string
  displayName: string
  role: UserRole
}

const ROLE_LABELS: Record<UserRole, string> = {
  attendee: "Attendee",
  stageManager: "Stage Manager",
  eventDirector: "Event Director",
}

const ROLE_COLORS: Record<UserRole, string> = {
  attendee: "bg-zinc-100 text-zinc-600",
  stageManager: "bg-indigo-100 text-indigo-700",
  eventDirector: "bg-ted/10 text-ted",
}

export default function RoleManagementPage() {
  const [users, setUsers] = useState<RoleUser[]>([])
  const [loading, setLoading] = useState(true)
  const [savingUid, setSavingUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadUsers() {
    setLoading(true)
    setError(null)
    try {
      const fn = httpsCallable<Record<string, never>, { users: RoleUser[] }>(
        functions,
        "listUsersForRoleManagement",
      )
      const result = await fn({})
      setUsers(result.data.users)
    } catch {
      setError("Could not load users. You must be signed in as Event Director.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadUsers() }, [])

  async function updateRole(uid: string, role: UserRole) {
    setSavingUid(uid)
    setError(null)
    try {
      const fn = httpsCallable<{ uid: string; role: UserRole }, { ok: boolean }>(
        functions,
        "setUserRole",
      )
      await fn({ uid, role })
      setUsers((cur) => cur.map((u) => (u.uid === uid ? { ...u, role } : u)))
    } catch {
      setError("Failed to update role.")
    } finally {
      setSavingUid(null)
    }
  }

  const initials = (u: RoleUser) =>
    (u.displayName || u.email || "?")
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase()

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ted mb-1">
            Event Director
          </p>
          <h1 className="text-2xl font-black text-zinc-900">User Roles</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Assign attendee, stage manager, or event director roles
          </p>
        </div>
        <Link
          to="/director"
          className="shrink-0 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition"
        >
          ← Back
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-zinc-900">All Users</h2>
          <span className="text-xs text-zinc-400">{users.length} total</span>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-400">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-zinc-400">No users found</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {users.map((u) => (
              <li key={u.uid} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">

                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-zinc-100 text-zinc-500 text-xs font-bold flex items-center justify-center shrink-0">
                  {initials(u)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-zinc-900 text-sm truncate">
                    {u.displayName || u.email || u.uid}
                  </p>
                  <p className="text-xs text-zinc-400 truncate">{u.email || u.uid}</p>
                </div>

                {/* Current role badge */}
                <span className={`hidden sm:inline-block shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_COLORS[u.role]}`}>
                  {ROLE_LABELS[u.role]}
                </span>

                {/* Role selector */}
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={u.role}
                    onChange={(e) => void updateRole(u.uid, e.target.value as UserRole)}
                    disabled={savingUid === u.uid}
                    className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-700 focus:border-ted focus:outline-none disabled:opacity-50 transition"
                  >
                    <option value="attendee">Attendee</option>
                    <option value="stageManager">Stage Manager</option>
                    <option value="eventDirector">Event Director</option>
                  </select>
                  {savingUid === u.uid && (
                    <span className="text-xs text-zinc-400">Saving…</span>
                  )}
                </div>

              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  )
}
