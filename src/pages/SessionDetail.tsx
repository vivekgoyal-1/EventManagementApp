import { useEffect, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore"

import { db } from "../services/firebase"
import type { Feedback, Session } from "../types"
import { useAuth } from "../hooks/useAuth"

function RatingBar({ star, count, total }: { star: number; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const color =
    star >= 4 ? "bg-green-500" :
    star === 3 ? "bg-amber-400" :
    "bg-red-500"

  return (
    <div className="flex items-center gap-3">
      <span className="w-4 shrink-0 text-right text-xs font-semibold text-zinc-500">{star}</span>
      <div className="flex-1 rounded-full bg-zinc-100 h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-xs text-zinc-400">
        {pct}% <span className="text-zinc-500">({count})</span>
      </span>
    </div>
  )
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { user, loading: authLoading } = useAuth()

  const [session, setSession] = useState<Session | null>(null)
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    getDoc(doc(db, "sessions", sessionId))
      .then((snap) => {
        if (snap.exists()) setSession({ id: snap.id, ...snap.data() } as Session)
        else setError("Session not found")
      })
      .catch((err) => setError(err.message || "Unable to load session"))
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(
      query(collection(db, "sessions", sessionId, "feedback"), orderBy("createdAt", "desc")),
      (snap) => {
        setFeedback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Feedback))
        setLoading(false)
      },
      (err) => { setError(err.message || "Unable to load feedback"); setLoading(false) },
    )
    return () => unsub()
  }, [sessionId])

  if (authLoading) return null
  if (!user) return <Navigate to="/" replace />
  if (user.role === "attendee") return <Navigate to="/home" replace />

  const backTo = user.role === "eventDirector" ? "/director" : "/manager"

  const ratingCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: feedback.filter((f) => f.rating === star).length,
  }))

  const startedAt = session
    ? (session.startedAt as unknown as Timestamp)?.toDate?.()
    : null

  const avg = session?.avgRating ?? 0
  const count = session?.totalFeedback ?? 0
  const isLow = avg > 0 && avg < 3

  return (
    <div className="space-y-6">

      {/* Breadcrumb + back */}
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Link to={backTo} className="hover:text-zinc-700 transition-colors">
          {user.role === "eventDirector" ? "Overview" : "Dashboard"}
        </Link>
        <span>/</span>
        <span className="text-zinc-600 font-medium truncate">{session?.title ?? "Session"}</span>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 leading-tight">
              {session?.title ?? "Loading…"}
            </h1>
            {session && (
              <p className="text-sm text-zinc-400 mt-1">
                {session.managerName ?? session.managerEmail ?? "—"}
                {startedAt && (
                  <>
                    {" · "}
                    {startedAt.toLocaleDateString("en-GB", {
                      day: "numeric", month: "long", year: "numeric",
                    })}
                  </>
                )}
              </p>
            )}
          </div>

          {session && count > 0 && (
            <div className={`shrink-0 rounded-2xl px-4 py-2 text-center ${
              isLow ? "bg-red-50 border border-red-200" : "bg-green-50 border border-green-200"
            }`}>
              <p className={`text-2xl font-black ${isLow ? "text-red-700" : "text-green-700"}`}>
                {avg.toFixed(2)}
              </p>
              <p className={`text-xs font-semibold uppercase tracking-widest mt-0.5 ${
                isLow ? "text-red-500" : "text-green-500"
              }`}>
                {isLow ? "At risk" : "On track"}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stat cards */}
      {session && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total Responses", value: count },
            { label: "Average Rating", value: count > 0 ? avg.toFixed(2) + " ★" : "—" },
            {
              label: "1-Star Responses",
              value: ratingCounts.find((r) => r.star === 1)?.count ?? 0,
            },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{c.label}</p>
              <p className="mt-2 text-3xl font-black text-zinc-900 tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Rating distribution */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-5">
          Rating Distribution
        </h2>
        {feedback.length === 0 ? (
          <p className="text-sm text-zinc-400">No feedback submitted yet</p>
        ) : (
          <div className="space-y-3">
            {ratingCounts.map(({ star, count: c }) => (
              <RatingBar key={star} star={star} count={c} total={feedback.length} />
            ))}
          </div>
        )}
      </div>

      {/* All feedback */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            All Comments
          </h2>
          {feedback.length > 0 && (
            <span className="text-xs text-zinc-400">{feedback.length} total</span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : feedback.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-zinc-400">
            No feedback submitted yet
          </div>
        ) : (
          <ul className="space-y-3">
            {feedback.map((item) => {
              const ts = (item.createdAt as unknown as Timestamp)?.toDate?.()
              const low = item.rating <= 2
              const high = item.rating >= 4

              return (
                <li
                  key={item.id}
                  className={`rounded-xl border p-4 ${
                    low
                      ? "border-red-100 bg-red-50"
                      : high
                      ? "border-green-100 bg-green-50"
                      : "border-zinc-100 bg-zinc-50"
                  }`}
                >
                  <div className="flex items-start gap-3">

                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-black mt-0.5 ${
                      low
                        ? "bg-red-200 text-red-800"
                        : high
                        ? "bg-green-200 text-green-800"
                        : "bg-amber-200 text-amber-800"
                    }`}>
                      {item.rating}★
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-800 leading-relaxed">{item.comment}</p>
                      {ts && (
                        <p className="text-xs text-zinc-400 mt-1.5">
                          {ts.toLocaleString("en-GB", {
                            day: "numeric", month: "short",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>

                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

    </div>
  )
}
