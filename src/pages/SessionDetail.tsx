import { useEffect, useMemo, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore"

import { db } from "../services/firebase"
import type { Feedback, Session } from "../types"
import { useAuth } from "../hooks/useAuth"
import { toDate } from "../lib/utils"

type RatingFilter = "all" | 5 | 4 | 3 | 2 | 1

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

// ─── submission integrity panel ───────────────────────────────────────────────
// Shows the director when feedback arrived so suspicious patterns are visible.

function SubmissionIntegrity({
  feedback,
  uniqueSubmitters,
}: {
  feedback: Feedback[]
  uniqueSubmitters: number | null
}) {
  // Build an hourly histogram from submission timestamps
  const { buckets, firstTs, lastTs, windowMinutes, isSuspicious } = useMemo(() => {
    const timestamps: Date[] = feedback
      .map((f) => toDate(f.createdAt))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())

    if (timestamps.length === 0) {
      return { buckets: [], firstTs: null, lastTs: null, windowMinutes: 0, isSuspicious: false }
    }

    const firstTs = timestamps[0]
    const lastTs = timestamps[timestamps.length - 1]
    const windowMinutes = Math.ceil((lastTs.getTime() - firstTs.getTime()) / 60000)

    // Group into 10-minute buckets from the first submission
    const BUCKET_MINUTES = 10
    const numBuckets = Math.max(1, Math.ceil(windowMinutes / BUCKET_MINUTES) + 1)
    const counts = new Array(numBuckets).fill(0)

    timestamps.forEach((ts) => {
      const minOffset = (ts.getTime() - firstTs.getTime()) / 60000
      const idx = Math.min(Math.floor(minOffset / BUCKET_MINUTES), numBuckets - 1)
      counts[idx]++
    })

    const maxCount = Math.max(...counts, 1)

    const isSuspicious =
      feedback.length >= 5 &&
      windowMinutes < 5 &&
      (uniqueSubmitters === null || uniqueSubmitters < feedback.length * 0.8)

    return {
      buckets: counts.map((c, i) => ({
        label: `+${i * BUCKET_MINUTES}m`,
        count: c,
        pct: Math.round((c / maxCount) * 100),
      })),
      firstTs,
      lastTs,
      windowMinutes,
      isSuspicious,
    }
  }, [feedback, uniqueSubmitters])

  if (feedback.length === 0) return null

  const fmtTime = (d: Date) =>
    d.toLocaleString("en-GB", {
      day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    })

  return (
    <div className={`rounded-2xl border shadow-sm p-6 ${isSuspicious ? "bg-amber-50 border-amber-200" : "bg-white border-zinc-100"}`}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Submission Integrity
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            When feedback arrived — useful for detecting unusual submission patterns
          </p>
        </div>
        {isSuspicious && (
          <span className="shrink-0 rounded-full bg-amber-100 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-700">
            ⚠ Review recommended
          </span>
        )}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Total Submissions", value: String(feedback.length) },
          {
            label: "Unique Attendees",
            value: uniqueSubmitters !== null ? String(uniqueSubmitters) : "—",
          },
          {
            label: "Submission Window",
            value: windowMinutes < 1 ? "< 1 min" : windowMinutes < 60
              ? `${windowMinutes} min`
              : `${Math.round(windowMinutes / 60 * 10) / 10} hr`,
          },
          {
            label: "First → Last",
            value: firstTs && lastTs
              ? `${firstTs.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} → ${lastTs.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
              : "—",
          },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
            <p className="mt-1 text-lg font-black text-zinc-900 tabular-nums leading-tight">{value}</p>
          </div>
        ))}
      </div>

      {/* Integrity flags */}
      {isSuspicious && (
        <div className="rounded-xl border border-amber-200 bg-amber-100/60 px-4 py-3 mb-5 text-sm text-amber-800">
          <span className="font-semibold">Flag: </span>
          All {feedback.length} submissions arrived within {windowMinutes} minute{windowMinutes !== 1 ? "s" : ""}.
          This may indicate bulk submission. Cross-check attendee sign-in records.
        </div>
      )}

      {/* Timeline histogram */}
      {buckets.length > 1 && (
        <div>
          <p className="text-xs text-zinc-400 mb-2">Submissions over time (10-min intervals from first submission)</p>
          <div className="flex items-end gap-1 h-16">
            {buckets.map((b, i) => (
              <div key={i} className="flex-1 flex flex-col justify-end h-full group relative">
                <div
                  className="w-full rounded-t bg-ted/70 transition-all"
                  style={{ height: `${Math.max(b.pct, b.count > 0 ? 8 : 0)}%` }}
                />
                {b.count > 0 && (
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                    <div className="bg-zinc-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {b.label}: {b.count}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {firstTs && <span className="text-xs text-zinc-400">{fmtTime(firstTs)}</span>}
            {lastTs && firstTs && lastTs.getTime() !== firstTs.getTime() && (
              <span className="text-xs text-zinc-400">{fmtTime(lastTs)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { user, loading: authLoading } = useAuth()

  const [session, setSession] = useState<Session | null>(null)
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [uniqueSubmitters, setUniqueSubmitters] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all")

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
      collection(db, "sessions", sessionId, "feedback"),
      (snap) => {
        setFeedback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Feedback))
        setLoading(false)
      },
      (err) => { setError(err.message || "Unable to load feedback"); setLoading(false) },
    )
    return () => unsub()
  }, [sessionId])

  // Count unique submitters from the submittedBy subcollection
  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(
      collection(db, "sessions", sessionId, "submittedBy"),
      (snap) => setUniqueSubmitters(snap.size),
      () => setUniqueSubmitters(null),
    )
    return () => unsub()
  }, [sessionId])

  // ── All hooks must be called unconditionally before any early return ──────────

  // Single source of truth for per-star counts — reused in distribution chart and filter pills.
  const ratingCounts = useMemo(
    () => [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: feedback.filter((f) => f.rating === star).length,
    })),
    [feedback],
  )

  // Pre-parse timestamps and sort newest-first (no Firestore orderBy needed).
  const filteredFeedback = useMemo(
    () => (ratingFilter === "all" ? feedback : feedback.filter((f) => f.rating === ratingFilter))
      .map((f) => ({
        ...f,
        ts: toDate(f.createdAt),
      }))
      .sort((a, b) => (b.ts?.getTime() ?? 0) - (a.ts?.getTime() ?? 0)),
    [feedback, ratingFilter],
  )

  // ── Early auth guards (after all hooks) ───────────────────────────────────────

  if (authLoading) return null
  if (!user) return <Navigate to="/" replace />
  if (user.role === "attendee") return <Navigate to="/home" replace />

  const backTo = user.role === "eventDirector" ? "/director" : "/manager"

  const startedAt = session ? toDate(session.startedAt) : null

  const count = feedback.length
  const avg = count > 0 ? feedback.reduce((sum, f) => sum + f.rating, 0) / count : 0
  const isLow = avg > 0 && avg < 3

  const filterOptions: { label: string; value: RatingFilter; count: number }[] = [
    { label: "All", value: "all", count: feedback.length },
    ...ratingCounts.map(({ star, count: c }) => ({
      label: `${star}★`,
      value: star as RatingFilter,
      count: c,
    })),
  ]

  return (
    <div className="space-y-6">

      {/* Breadcrumb */}
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
              <p className={`text-2xl font-black tabular-nums ${isLow ? "text-red-700" : "text-green-700"}`}>
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
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "Total Responses", value: count },
            { label: "Average Rating", value: count > 0 ? avg.toFixed(2) + " ★" : "—" },
            { label: "1-Star Responses", value: ratingCounts.find((r) => r.star === 1)?.count ?? 0 },
            { label: "Unique Attendees", value: uniqueSubmitters !== null ? uniqueSubmitters : "—" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{stat.label}</p>
              <p className="mt-2 text-3xl font-black text-zinc-900 tabular-nums">{stat.value}</p>
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
              <button
                key={star}
                onClick={() => setRatingFilter(ratingFilter === star ? "all" : (star as RatingFilter))}
                className={`w-full text-left rounded-lg px-2 py-1 transition-colors ${
                  ratingFilter === star ? "bg-zinc-100" : "hover:bg-zinc-50"
                }`}
              >
                <RatingBar star={star} count={c} total={feedback.length} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Submission integrity — only visible to event director */}
      {user.role === "eventDirector" && (
        <SubmissionIntegrity feedback={feedback} uniqueSubmitters={uniqueSubmitters} />
      )}

      {/* All feedback with filter */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Comments
          </h2>
          {feedback.length > 0 && (
            <span className="text-xs text-zinc-400">
              {filteredFeedback.length} of {feedback.length}
            </span>
          )}
        </div>

        {/* Rating filter pills */}
        {feedback.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {filterOptions.map(({ label, value, count: c }) => (
              <button
                key={value}
                onClick={() => setRatingFilter(value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  ratingFilter === value
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {label} {c > 0 && <span className="opacity-60">({c})</span>}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : feedback.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-zinc-400">
            No feedback submitted yet
          </div>
        ) : filteredFeedback.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-zinc-400">
            No feedback matching this filter
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredFeedback.map((item) => {
              const { ts } = item  // pre-parsed in useMemo above
              const low = item.rating <= 2
              const high = item.rating >= 4

              return (
                <li
                  key={item.id}
                  className={`rounded-xl border p-4 ${
                    low ? "border-red-100 bg-red-50" :
                    high ? "border-green-100 bg-green-50" :
                    "border-zinc-100 bg-zinc-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-black mt-0.5 ${
                      low ? "bg-red-200 text-red-800" :
                      high ? "bg-green-200 text-green-800" :
                      "bg-amber-200 text-amber-800"
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
