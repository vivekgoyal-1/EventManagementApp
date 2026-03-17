import { FormEvent, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore"

import { db } from "../services/firebase"
import type { Session } from "../types"
import { useAuth } from "../hooks/useAuth"

interface FeedbackFormProps {
  sessionId?: string
  onSubmitted?: () => void
}

const STAR_LABELS = ["", "Poor", "Below average", "Average", "Good", "Excellent"]

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0)
  const active = hovered || value

  return (
    <div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            className="text-3xl leading-none focus:outline-none transition-transform hover:scale-110 active:scale-95"
            aria-label={`${star} star`}
          >
            <span className={star <= active ? "text-yellow-400" : "text-zinc-300"}>
              ★
            </span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-sm font-medium text-zinc-500 h-5">
        {STAR_LABELS[active] ?? ""}
      </p>
    </div>
  )
}

export default function FeedbackForm({ sessionId: propSessionId, onSubmitted }: FeedbackFormProps) {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()

  const paramSessionId = searchParams.get("session") ?? ""
  const paramCode = searchParams.get("code") ?? ""

  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState(propSessionId ?? paramSessionId)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")
  const [accessCode, setAccessCode] = useState(paramCode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "sessions"), where("isActive", "==", true)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Session[]
        setSessions(list)
        if (!selectedSessionId && list.length > 0) setSelectedSessionId(list[0].id)
      },
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    if (paramCode) setAccessCode(paramCode)
  }, [paramCode])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!user) { setError("You must be signed in"); return }
    if (!selectedSessionId) { setError("Please choose a session"); return }
    if (comment.trim().length < 5) { setError("Comment must be at least 5 characters"); return }
    if (!accessCode.trim()) {
      setError("Access code required — ask your Stage Manager for the code")
      return
    }

    setLoading(true)

    try {
      const sessionData = sessions.find((s) => s.id === selectedSessionId)
      if (!sessionData) throw new Error("Session is not active")

      const batch = writeBatch(db)

      const feedbackRef = doc(collection(db, "sessions", selectedSessionId, "feedback"))
      batch.set(feedbackRef, {
        sessionId: selectedSessionId,
        sessionTitle: sessionData.title ?? "Untitled Session",
        managerId: sessionData.managerId ?? null,
        userId: user.uid,
        rating,
        comment: comment.trim(),
        accessCode: accessCode.trim().toUpperCase(),
        createdAt: serverTimestamp(),
      })

      const submittedByRef = doc(db, "sessions", selectedSessionId, "submittedBy", user.uid)
      batch.set(submittedByRef, { userId: user.uid, submittedAt: serverTimestamp() })

      await batch.commit()

      setSuccess(true)
      setComment("")
      setRating(5)
      setAccessCode(paramCode)
      onSubmitted?.()

    } catch (err: any) {
      if (err?.message === "Session is not active") {
        setError("This session is not currently active. Feedback can only be submitted during an active session.")
      } else if (err?.code === "permission-denied") {
        setError("Submission failed. Invalid access code, or you have already submitted for this session.")
      } else {
        setError("Could not submit feedback. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Session selector */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
          Session
        </label>
        <select
          value={selectedSessionId}
          onChange={(e) => setSelectedSessionId(e.target.value)}
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
          required
        >
          {sessions.length === 0 && <option value="">No active sessions available</option>}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.title ?? s.id}</option>
          ))}
        </select>
      </div>

      {/* Access code */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
          Access Code
        </label>
        <p className="text-xs text-zinc-400 mb-2">
          Enter the code your Stage Manager shared for this session
        </p>
        <input
          type="text"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
          placeholder="e.g. AH2025"
          maxLength={10}
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 font-mono text-sm font-semibold uppercase tracking-widest text-zinc-900 placeholder-zinc-300 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
          required
        />
      </div>

      {/* Star rating */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
          Rating
        </label>
        <StarPicker value={rating} onChange={setRating} />
      </div>

      {/* Comment */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
          Comment
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="What did you think about this session? Be specific — your feedback goes directly to the Stage Manager."
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition resize-none"
          required
        />
        <p className="text-xs text-zinc-400 mt-1 text-right">
          {comment.length} chars {comment.trim().length < 5 && comment.length > 0 && "(min 5)"}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-semibold text-green-700">Thank you — your feedback was submitted!</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition"
      >
        {loading ? "Submitting…" : "Submit Feedback"}
      </button>

    </form>
  )
}
