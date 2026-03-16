import { useEffect, useMemo, useState, FormEvent } from "react"
import { Link } from "react-router-dom"
import {
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"

import { db, functions } from "../services/firebase"
import type { Session } from "../types"

export default function SessionManagementPage() {
  const [title, setTitle] = useState("")
  const [managerEmail, setManagerEmail] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "sessions"),
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Session))
        setLoading(false)
      },
      (err) => { setError(err.message || "Could not load sessions"); setLoading(false) },
    )
    return () => unsub()
  }, [])

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => (a.title || "").localeCompare(b.title || "")),
    [sessions],
  )

  async function handleCreateSession(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!title.trim()) { setError("Session title is required"); return }
    if (!managerEmail.trim()) { setError("Manager email is required"); return }
    if (!startsAt) { setError("Session start time is required"); return }

    setSubmitting(true)
    try {
      const accessCode = Math.random().toString(36).slice(2, 8).toUpperCase()
      await addDoc(collection(db, "sessions"), {
        title: title.trim(),
        managerEmail: managerEmail.trim().toLowerCase(),
        managerId: null,
        managerName: null,
        accessCode,
        startedAt: Timestamp.fromDate(new Date(startsAt)),
        createdAt: serverTimestamp(),
        isActive: true,
        ratingSum: 0,
        totalFeedback: 0,
        avgRating: 0,
      })
      setSuccess(`Session created · Access code: ${accessCode}`)
      setTitle("")
      setManagerEmail("")
      setStartsAt("")
    } catch {
      setError("Unable to create session")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteSession(sessionId: string) {
    setError(null)
    setDeletingId(sessionId)
    try {
      const fn = httpsCallable<{ sessionId: string }, { ok: boolean }>(functions, "deleteSessionCascade")
      await fn({ sessionId })
      setSuccess("Session removed")
    } catch {
      setError("Unable to remove session")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ted mb-1">
            Event Director
          </p>
          <h1 className="text-2xl font-black text-zinc-900">Session Management</h1>
          <p className="text-sm text-zinc-500 mt-1">Create sessions and assign Stage Managers</p>
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
      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {success}
        </div>
      )}

      {/* Create form */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-zinc-900 mb-5">Add Session</h2>

        <form onSubmit={handleCreateSession} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="The Future of AI"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
                Manager Email
              </label>
              <input
                type="email"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                placeholder="manager@example.com"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
                Start Time
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-ted px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition"
          >
            {submitting ? "Creating…" : "Create Session"}
          </button>
        </form>
      </div>

      {/* Sessions list */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-zinc-900">All Sessions</h2>
          <span className="text-xs text-zinc-400">{sessions.length} total</span>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : sortedSessions.length === 0 ? (
          <div className="flex items-center justify-center py-10 rounded-xl border border-dashed border-zinc-200">
            <p className="text-sm text-zinc-400">No sessions yet — create one above</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {sortedSessions.map((session) => (
              <li
                key={session.id}
                className="flex items-start justify-between gap-4 rounded-xl border border-zinc-100 bg-zinc-50 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-900 truncate">{session.title ?? "Untitled"}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {session.managerName ?? session.managerEmail ?? "Pending manager signup"}
                  </p>
                  {session.accessCode && (
                    <p className="text-xs text-zinc-400 mt-1">
                      Code: <span className="font-mono font-bold text-zinc-700">{session.accessCode}</span>
                    </p>
                  )}
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {session.totalFeedback ?? 0} responses
                    {(session.avgRating ?? 0) > 0 && (
                      <> · {(session.avgRating ?? 0).toFixed(2)} avg</>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to={`/session/${session.id}`}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 transition"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => handleDeleteSession(session.id)}
                    disabled={deletingId === session.id}
                    className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50 transition"
                  >
                    {deletingId === session.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  )
}
