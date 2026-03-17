import { FormEvent, useEffect, useState } from "react"
import { updateProfile } from "firebase/auth"
import { doc, updateDoc } from "firebase/firestore"
import { useNavigate } from "react-router-dom"

import { auth, db } from "../services/firebase"
import { useAuth } from "../hooks/useAuth"

export default function ProfilePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (user?.displayName) setDisplayName(user.displayName)
  }, [user?.displayName])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    const name = displayName.trim()
    if (!name) { setError("Display name cannot be empty"); return }

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const currentUser = auth.currentUser
      if (currentUser) {
        await updateProfile(currentUser, { displayName: name })
      }
      await updateDoc(doc(db, "users", user.uid), { displayName: name })
      setSuccess(true)
    } catch {
      setError("Failed to update profile. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const initials = (user?.displayName || user?.email || "?")
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()

  return (
    <div className="max-w-lg">

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Profile</h1>
        <p className="text-zinc-500 text-sm mt-1">Update your display name</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 text-xl font-bold flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div>
          <p className="text-zinc-900 font-semibold">{user?.displayName || "No name set"}</p>
          <p className="text-zinc-500 text-sm">{user?.email}</p>
          <span className="inline-block mt-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            {user?.role === "stageManager" ? "Stage Manager" : user?.role === "eventDirector" ? "Event Director" : "Attendee"}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); setSuccess(false) }}
            placeholder="Your full name"
            maxLength={60}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/10 transition"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
            Email
          </label>
          <input
            type="email"
            value={user?.email ?? ""}
            disabled
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-400 cursor-not-allowed"
          />
          <p className="text-xs text-zinc-400 mt-1">Email cannot be changed</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm font-semibold text-green-700">Profile updated successfully!</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition"
          >
            Cancel
          </button>
        </div>
      </form>

    </div>
  )
}
