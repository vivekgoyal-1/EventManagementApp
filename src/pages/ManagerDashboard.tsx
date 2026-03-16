import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore"

import { db } from "../services/firebase"
import { ManagerDailyStats, Session } from "../types"
import { useAuth } from "../hooks/useAuth"

type CriticalFeedback = {
  id: string
  sessionId: string
  sessionTitle: string
  comment: string
  rating: number
  createdAt?: Timestamp
}

function PageHeader({ name }: { name: string }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-ted mb-1">
        Stage Manager
      </p>
      <h1 className="text-3xl font-black text-zinc-900 tracking-tight">{name}</h1>
      <p className="text-sm text-zinc-500 mt-1">Live session monitoring</p>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
      <p className="mt-3 text-4xl font-black text-zinc-900 tabular-nums leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

function SessionCard({ session, onCopy, copied }: {
  session: Session
  onCopy: (s: Session) => void
  copied: boolean
}) {
  const avg = session.avgRating ?? 0
  const count = session.totalFeedback ?? 0
  const isLow = avg > 0 && avg < 3
  const isGood = avg >= 4

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-4 transition-shadow hover:shadow-md ${
      isLow ? "border-red-200" : "border-zinc-100"
    }`}>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-zinc-900 leading-snug line-clamp-2">
            {session.title ?? "Untitled Session"}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {count} {count === 1 ? "response" : "responses"}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-bold ${
            count === 0
              ? "bg-zinc-100 text-zinc-400"
              : isLow
              ? "bg-red-100 text-red-700"
              : isGood
              ? "bg-green-100 text-green-700"
              : "bg-amber-100 text-amber-700"
          }`}>
            {count === 0 ? "—" : avg.toFixed(2)} ★
          </span>

          <p className={`text-xs font-semibold mt-1 ${
            count === 0 ? "text-zinc-400" : isLow ? "text-red-600" : "text-green-600"
          }`}>
            {count === 0 ? "No data" : isLow ? "⚠ At risk" : "On track"}
          </p>
        </div>
      </div>

      {session.accessCode && (
        <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-3 py-2 flex items-center justify-between">
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-widest font-semibold">Access Code</p>
            <p className="font-mono font-bold text-zinc-800 text-sm mt-0.5">{session.accessCode}</p>
          </div>
          <button
            onClick={() => onCopy(session)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
              copied
                ? "bg-green-100 text-green-700"
                : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
            }`}
          >
            {copied ? "Copied!" : "Share"}
          </button>
        </div>
      )}

      <Link
        to={`/session/${session.id}`}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ted transition-colors"
      >
        View Details →
      </Link>

    </div>
  )
}

function DailyAverageGraph({ data }: { data: ManagerDailyStats[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-zinc-400">
        No daily stats yet
      </div>
    )
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))

  const points = sorted.map((d, idx) => {
    const x = (idx / Math.max(sorted.length - 1, 1)) * 100
    const y = 100 - Math.max(0, Math.min(5, d.averageRating)) * 20
    return `${x},${y}`
  })

  const areaPoints = `0,100 ${points.join(" ")} 100,100`

  return (
    <svg viewBox="0 0 100 100" className="h-40 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="graphGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E62B1E" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#E62B1E" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[20, 40, 60, 80].map((y) => (
        <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#f4f4f5" strokeWidth="0.8" />
      ))}

      <polygon fill="url(#graphGrad)" points={areaPoints} />

      <polyline
        fill="none"
        stroke="#E62B1E"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points.join(" ")}
      />
    </svg>
  )
}

function CriticalFeed({ feedback }: { feedback: CriticalFeedback[] }) {
  if (feedback.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-zinc-400">
        No critical feedback — all responses are above 2 stars
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {feedback.map((item) => (
        <li
          key={`${item.sessionId}-${item.id}`}
          className="rounded-xl border border-red-100 bg-red-50 p-4"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {item.sessionTitle}
            </p>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
              {item.rating}★
            </span>
          </div>
          <p className="text-sm text-zinc-700 leading-snug">
            {item.comment || "No comment"}
          </p>
        </li>
      ))}
    </ul>
  )
}

export default function ManagerDashboard() {
  const { user, loading: authLoading } = useAuth()

  const [sessions, setSessions] = useState<Session[]>([])
  const [dailyStats, setDailyStats] = useState<ManagerDailyStats[]>([])
  const [criticalFeedback, setCriticalFeedback] = useState<CriticalFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) { setLoading(false); return }

    const q = query(
      collection(db, "sessions"),
      where("managerId", "==", user.uid),
      limit(4),
    )

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setSessions(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Session))
        setLoading(false)
      },
      (err) => { setError(err.message || "Unable to fetch sessions"); setLoading(false) },
    )

    return () => unsub()
  }, [user])

  useEffect(() => {
    if (!user) return

    const unsub = onSnapshot(
      query(
        collection(db, "managerDailyStats"),
        where("managerId", "==", user.uid),
        orderBy("date", "desc"),
        limit(365),
      ),
      (snap) => setDailyStats(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ManagerDailyStats)),
      (err) => setError(err.message),
    )

    return () => unsub()
  }, [user])

  useEffect(() => {
    if (sessions.length === 0) { setCriticalFeedback([]); return }

    const unsubs = sessions.slice(0, 4).map((session) => {
      return onSnapshot(
        query(
          collection(db, "sessions", session.id, "feedback"),
          where("rating", "<=", 2),
          limit(5),
        ),
        (snap) => {
          const items = snap.docs.map((d) => ({
            id: d.id,
            sessionId: session.id,
            sessionTitle: session.title ?? "Untitled",
            comment: String(d.data().comment ?? ""),
            rating: Number(d.data().rating ?? 0),
            createdAt: d.data().createdAt as Timestamp | undefined,
          }))

          setCriticalFeedback((cur) => {
            const filtered = cur.filter((f) => f.sessionId !== session.id)
            return [...filtered, ...items].sort((a, b) => a.rating - b.rating).slice(0, 10)
          })
        },
      )
    })

    return () => unsubs.forEach((u) => u())
  }, [sessions])

  function copyLink(session: Session) {
    const url = `${window.location.origin}/home?session=${session.id}&code=${session.accessCode ?? ""}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(session.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const liveResponseCount = useMemo(
    () => sessions.reduce((s, sess) => s + (sess.totalFeedback ?? 0), 0),
    [sessions],
  )

  const liveAvgRating = useMemo(() => {
    const valid = sessions.filter((s) => (s.totalFeedback ?? 0) > 0)
    if (!valid.length) return 0
    const totalSum = valid.reduce((s, sess) => s + (sess.ratingSum ?? 0), 0)
    const totalCount = valid.reduce((s, sess) => s + (sess.totalFeedback ?? 0), 0)
    return totalCount > 0 ? totalSum / totalCount : 0
  }, [sessions])

  if (authLoading) return null

  if (!user) return <p className="text-zinc-500">Please sign in.</p>

  return (
    <div className="space-y-8">

      <PageHeader name={user.displayName || user.email || "Manager"} />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sessions" value={sessions.length} sub="assigned to you" />
        <StatCard label="Total Responses" value={liveResponseCount} sub="across all sessions" />
        <StatCard
          label="Average Rating"
          value={liveResponseCount === 0 ? "—" : liveAvgRating.toFixed(2)}
          sub="weighted across sessions"
        />
      </div>

      {/* Sessions grid */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
          Your Sessions
        </h2>

        {loading ? (
          <p className="text-sm text-zinc-400">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center">
            <p className="text-sm text-zinc-400">No sessions assigned yet</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                onCopy={copyLink}
                copied={copiedId === s.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Performance graph */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-zinc-900">Daily Average Rating</h2>
          <span className="text-xs text-zinc-400">365-day history</span>
        </div>
        <p className="text-xs text-zinc-400 mb-4">1.0 – 5.0 scale</p>
        <DailyAverageGraph data={dailyStats} />
        <div className="flex justify-between mt-2">
          <span className="text-xs text-zinc-400">365 days ago</span>
          <span className="text-xs text-zinc-400">Today</span>
        </div>
      </div>

      {/* Critical feedback */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Critical Feedback</h2>
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
            ≤ 2★
          </span>
        </div>
        <CriticalFeed feedback={criticalFeedback} />
      </div>

    </div>
  )
}
