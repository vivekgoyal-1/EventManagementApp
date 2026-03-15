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

  useEffect(() => {

    const sessionsRef = collection(db, "sessions")

    const unsub = onSnapshot(
      sessionsRef,
      (snapshot) => {

        setSessions(
          snapshot.docs.map(
            (doc) =>
              ({
                id: doc.id,
                ...doc.data()
              }) as Session
          )
        )

        setLoading(false)

      },
      (err) => {
        setError(err.message || "Could not load sessions")
        setLoading(false)
      }
    )

    return () => unsub()

  }, [])

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) =>
      (a.title || "").localeCompare(b.title || "")
    )
  }, [sessions])

  async function handleCreateSession(e: FormEvent<HTMLFormElement>) {

    e.preventDefault()

    setError(null)
    setSuccess(null)

    if (!title.trim()) {
      setError("Session title is required")
      return
    }

    if (!managerEmail.trim()) {
      setError("Manager email is required")
      return
    }

    if (!startsAt) {
      setError("Session start time is required")
      return
    }

    setSubmitting(true)

    try {

      const startDate = new Date(startsAt)

      await addDoc(collection(db, "sessions"), {
        title: title.trim(),
        managerEmail: managerEmail.trim().toLowerCase(),
        managerId: null,
        managerName: null,
        startedAt: Timestamp.fromDate(startDate),
        createdAt: serverTimestamp(),
        isActive: true,
        ratingSum: 0,
        totalFeedback: 0,
        avgRating: 0
      })

      setSuccess("Session created successfully")

      setTitle("")
      setManagerEmail("")
      setStartsAt("")

    } catch (err) {

      console.error(err)
      setError("Unable to create session")

    } finally {

      setSubmitting(false)

    }
  }

  async function handleDeleteSession(sessionId: string) {

    setError(null)

    try {

      const callable = httpsCallable<
        { sessionId: string },
        { ok: boolean }
      >(functions, "deleteSessionCascade")

      await callable({ sessionId })

      setSuccess("Session removed")

    } catch (err) {

      console.error(err)
      setError("Unable to remove session")

    }
  }

  return (

    <section className="space-y-6">

      <div className="flex items-start justify-between">

        <div>

          <p className="text-xs uppercase tracking-wider text-indigo-600">
            Event Director
          </p>

          <h2 className="text-2xl font-semibold text-slate-900">
            Session Management
          </h2>

          <p className="text-sm text-slate-600">
            Create and assign sessions to Stage Managers
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

      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-green-700">
          {success}
        </div>
      )}

      <form
        onSubmit={handleCreateSession}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >

        <h3 className="text-lg font-semibold text-slate-900">
          Add Session
        </h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">

          <div>

            <label className="text-xs uppercase text-slate-500">
              Title
            </label>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Future of AI"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

          </div>

          <div>

            <label className="text-xs uppercase text-slate-500">
              Manager Email
            </label>

            <input
              type="email"
              value={managerEmail}
              onChange={(e) => setManagerEmail(e.target.value)}
              placeholder="manager@example.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

          </div>

          <div>

            <label className="text-xs uppercase text-slate-500">
              Start Time
            </label>

            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

          </div>

        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          {submitting ? "Creating..." : "Create Session"}
        </button>

      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

        <h3 className="text-lg font-semibold text-slate-900">
          Current Sessions
        </h3>

        {loading ? (
          <p className="mt-3 text-slate-600">
            Loading sessions...
          </p>

        ) : sortedSessions.length === 0 ? (

          <p className="mt-3 text-slate-500">
            No sessions available
          </p>

        ) : (

          <ul className="mt-4 space-y-3">

            {sortedSessions.map((session) => (

              <li
                key={session.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              >

                <div className="flex items-center justify-between">

                  <div>

                    <p className="font-medium text-slate-900">
                      {session.title ?? "Untitled Session"}
                    </p>

                    <p className="text-xs text-slate-500">
                      Manager: {session.managerName ??
                        session.managerEmail ??
                        "Pending manager signup"}
                    </p>

                  </div>

                  <button
                    onClick={() => handleDeleteSession(session.id)}
                    className="rounded-md bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-400"
                  >
                    Remove
                  </button>

                </div>

              </li>

            ))}

          </ul>

        )}

      </div>

    </section>
  )
}