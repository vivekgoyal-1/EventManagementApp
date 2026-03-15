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

export default function RoleManagementPage() {
  const [users, setUsers] = useState<RoleUser[]>([])
  const [loading, setLoading] = useState(true)
  const [savingUid, setSavingUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadUsers() {
    setLoading(true)
    setError(null)

    try {
      const listUsersCallable = httpsCallable<
        Record<string, never>,
        { users: RoleUser[] }
      >(functions, "listUsersForRoleManagement")

      const result = await listUsersCallable({})
      setUsers(result.data.users)

    } catch (err) {
      console.error(err)
      setError("Could not load users. You must be signed in as Event Director.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  async function updateRole(uid: string, role: UserRole) {
    setSavingUid(uid)
    setError(null)

    try {
      const setRoleCallable = httpsCallable<
        { uid: string; role: UserRole },
        { ok: boolean }
      >(functions, "setUserRole")

      await setRoleCallable({ uid, role })

      setUsers((current) =>
        current.map((user) =>
          user.uid === uid ? { ...user, role } : user
        )
      )

    } catch (err) {
      console.error(err)
      setError("Failed to update role.")
    } finally {
      setSavingUid(null)
    }
  }

  return (
    <section className="space-y-6">

      <div className="flex items-start justify-between">

        <div>
          <p className="text-xs uppercase tracking-wider text-indigo-600">
            Admin
          </p>

          <h2 className="text-2xl font-semibold text-slate-900">
            Role Management
          </h2>

          <p className="text-sm text-slate-600">
            Assign attendee, stage manager, or event director roles.
          </p>
        </div>

        <Link
          to="/director"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Back to Dashboard
        </Link>

      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

        {loading ? (
          <p className="text-slate-600">Loading users...</p>

        ) : users.length === 0 ? (
          <p className="text-slate-500">No users found</p>

        ) : (
          <ul className="space-y-3">

            {users.map((user) => (

              <li
                key={user.uid}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >

                <div>
                  <p className="font-medium text-slate-900">
                    {user.displayName || user.email || user.uid}
                  </p>

                  <p className="text-xs text-slate-500">
                    {user.email || user.uid}
                  </p>
                </div>

                <div className="flex items-center gap-3">

                  <select
                    value={user.role}
                    onChange={(e) =>
                      void updateRole(
                        user.uid,
                        e.target.value as UserRole
                      )
                    }
                    disabled={savingUid === user.uid}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:opacity-60"
                  >
                    <option value="attendee">Attendee</option>
                    <option value="stageManager">Stage Manager</option>
                    <option value="eventDirector">Event Director</option>
                  </select>

                  {savingUid === user.uid && (
                    <span className="text-xs text-slate-400">
                      Saving...
                    </span>
                  )}

                </div>

              </li>

            ))}

          </ul>
        )}

      </div>

    </section>
  )
}