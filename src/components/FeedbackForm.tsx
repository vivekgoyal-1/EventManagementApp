import { FormEvent, useEffect, useState } from "react"
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore"

import { db } from "../services/firebase"
import type { Session } from "../types"
import { useAuth } from "../hooks/useAuth"

interface FeedbackFormProps {
  sessionId?: string
  onSubmitted?: () => void
}

export default function FeedbackForm({ sessionId, onSubmitted }: FeedbackFormProps) {
  const { user } = useAuth()

  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState(sessionId ?? "")
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const sessionsRef = collection(db, "sessions")

    const unsubscribe = onSnapshot(sessionsRef, (snapshot) => {
      const list: Session[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Session[]

      setSessions(list)

      if (!selectedSessionId && list.length > 0) {
        setSelectedSessionId(list[0].id)
      }
    })

    return () => unsubscribe()
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!selectedSessionId) {
      setError("Please choose a session")
      return
    }

    if (comment.trim().length < 5) {
      setError("Comment must be at least 5 characters")
      return
    }

    setLoading(true)

    try {
      const sessionRef = doc(db, "sessions", selectedSessionId)
      const sessionSnapshot = await getDoc(sessionRef)

      if (!sessionSnapshot.exists()) {
        throw new Error("Session not found")
      }

      const sessionData = sessionSnapshot.data() as Session

      const feedbackRef = collection(db, "sessions", selectedSessionId, "feedback")

      await addDoc(feedbackRef, {
        sessionId: selectedSessionId,
        sessionTitle: sessionData.title ?? "Untitled Session",
        managerId: sessionData.managerId ?? null,
        userId: user?.uid ?? null,
        rating,
        comment: comment.trim(),
        createdAt: serverTimestamp(),
      })

      setSuccess(true)
      setComment("")
      setRating(5)

      onSubmitted?.()

    } catch (err) {
      console.error("Unable to submit feedback:", err)
      setError("Could not submit feedback. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >

      <h3 className="text-xl font-semibold text-slate-900">
        Submit Feedback
      </h3>

      <div className="mt-4">

        <label className="text-sm font-medium text-slate-700">
          Session
        </label>

        <select
          value={selectedSessionId}
          onChange={(e) => setSelectedSessionId(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          required
        >
          {sessions.length === 0 && (
            <option value="">No sessions available</option>
          )}

          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title ?? session.id}
            </option>
          ))}
        </select>

      </div>

      <div className="mt-4">

        <label className="text-sm font-medium text-slate-700">
          Rating
        </label>

        <select
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value} Star{value > 1 ? "s" : ""}
            </option>
          ))}
        </select>

      </div>

      <div className="mt-4">

        <label className="text-sm font-medium text-slate-700">
          Comment
        </label>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="Tell us what you liked..."
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          required
        />

      </div>

      {error && (
        <p className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {success && (
        <p className="mt-3 text-sm text-green-600">
          Feedback submitted successfully
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-4 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
      >
        {loading ? "Submitting..." : "Submit Feedback"}
      </button>

    </form>
  )
}