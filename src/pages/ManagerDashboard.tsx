import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
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

type LiveStats = { count: number; ratingSum: number; avg: number }

function SessionCard({ session, live, onCopy, copied }: {
  session: Session
  live?: LiveStats
  onCopy: (s: Session) => void
  copied: boolean
}) {
  const avg   = live ? live.avg   : (session.avgRating    ?? 0)
  const count = live ? live.count : (session.totalFeedback ?? 0)
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

const WINDOW = 30

function DailyAverageGraph({ data }: { data: ManagerDailyStats[] }) {
  // Build a lookup of the last WINDOW days regardless of what data exists
  const days = Array.from({ length: WINDOW }, (_, i) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - (WINDOW - 1 - i))
    return d.toISOString().slice(0, 10)
  })

  const byDate = Object.fromEntries(data.map((d) => [d.date, d.averageRating]))

  const hasAny = days.some((d) => byDate[d] !== undefined)

  if (!hasAny) {
    return (
      <div className="flex items-center justify-center h-36 rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400">
        No data in the last {WINDOW} days — submit feedback to see results here
      </div>
    )
  }

  const barColor = (r: number) =>
    r >= 4 ? "bg-green-400" : r >= 3 ? "bg-amber-400" : "bg-red-500"

  // Date labels: first, middle, last
  const labelIdxs = [0, Math.floor(WINDOW / 2), WINDOW - 1]

  return (
    <div>
      {/* Bars */}
      <div className="flex items-end gap-px h-32">
        {days.map((date) => {
          const rating = byDate[date]
          const heightPct = rating ? (rating / 5) * 100 : 0
          return (
            <div key={date} className="flex-1 flex flex-col justify-end h-full group relative">
              {rating !== undefined ? (
                <>
                  <div
                    className={`w-full rounded-t transition-all ${barColor(rating)}`}
                    style={{ height: `${heightPct}%` }}
                  />
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                    <div className="bg-zinc-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {date}<br />{rating.toFixed(2)} ★
                    </div>
                    <div className="w-1.5 h-1.5 bg-zinc-900 rotate-45 -mt-1" />
                  </div>
                </>
              ) : (
                <div className="w-full h-px bg-zinc-100" style={{ marginBottom: "0px" }} />
              )}
            </div>
          )
        })}
      </div>

      {/* X-axis date labels */}
      <div className="flex justify-between mt-1.5">
        {labelIdxs.map((i) => (
          <span key={i} className="text-xs text-zinc-400">
            {days[i].slice(5)}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {[
          { color: "bg-green-400", label: "≥ 4.0 Good" },
          { color: "bg-amber-400", label: "3.0 – 3.9 Average" },
          { color: "bg-red-500",   label: "< 3.0 At risk" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
            <span className="text-xs text-zinc-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
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
  const [liveStats, setLiveStats] = useState<Record<string, LiveStats>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const hasLoadedCriticalRef = useRef(false)
  const criticalIdsRef = useRef<Set<string>>(new Set())

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
        limit(365),
      ),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ManagerDailyStats)
        // Sort client-side so no composite index is required
        docs.sort((a, b) => b.date.localeCompare(a.date))
        setDailyStats(docs)
      },
      (err: any) => {
        const msg = String(err?.message ?? "")
        setError(msg || "Unable to fetch manager daily stats")
      },
    )

    return () => unsub()
  }, [user])

  useEffect(() => {
    setCriticalFeedback([])
    hasLoadedCriticalRef.current = false
    criticalIdsRef.current = new Set()

    if (!user || sessions.length === 0) return

    const armTimer = setTimeout(() => {
      hasLoadedCriticalRef.current = true
    }, 800)

    const unsubs = sessions.slice(0, 4).map((session) =>
      onSnapshot(
        query(
          collection(db, "sessions", session.id, "feedback"),
          where("rating", "<=", 2),
          limit(10),
        ),
        (snap) => {
          const items = snap.docs.map((d) => ({
            id: d.id,
            sessionId: session.id,
            sessionTitle: session.title ?? "Untitled",
            comment: String(d.data().comment ?? ""),
            rating: Number(d.data().rating ?? 0),
          }))

          const newItem = items.find((i) => !criticalIdsRef.current.has(i.id))
          items.forEach((i) => criticalIdsRef.current.add(i.id))

          setCriticalFeedback((cur) => {
            const filtered = cur.filter((f) => f.sessionId !== session.id)
            return [...filtered, ...items]
              .sort((a, b) => a.rating - b.rating)
              .slice(0, 10)
          })

          if (hasLoadedCriticalRef.current && newItem) {
            setToast(`New critical feedback: ${newItem.sessionTitle} (${newItem.rating}★)`)
            setTimeout(() => setToast(null), 4000)
          }
        },
        (err: any) => {
          // A deleted session can briefly trigger permission-denied before listeners cleanup.
          if (err?.code === "permission-denied") return
          setError(String(err?.message ?? "Unable to fetch critical feedback"))
        },
      )
    )

    return () => {
      clearTimeout(armTimer)
      unsubs.forEach((u) => u())
    }
  }, [user, sessions])

  // Subscribe to all feedback per session to get live counts & averages
  useEffect(() => {
    setLiveStats({})
    if (sessions.length === 0) return
    const unsubs = sessions.map((session) =>
      onSnapshot(
        collection(db, "sessions", session.id, "feedback"),
        (snap) => {
          const count = snap.size
          const ratingSum = snap.docs.reduce((s, d) => s + Number(d.data().rating ?? 0), 0)
          setLiveStats((prev) => ({
            ...prev,
            [session.id]: { count, ratingSum, avg: count > 0 ? ratingSum / count : 0 },
          }))
        },
        (err: any) => {
          if (err?.code === "permission-denied") return
          setError(String(err?.message ?? "Unable to fetch live feedback"))
        },
      )
    )
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
    () => Object.values(liveStats).reduce((s, st) => s + st.count, 0),
    [liveStats],
  )

  const liveAvgRating = useMemo(() => {
    const totalSum = Object.values(liveStats).reduce((s, st) => s + st.ratingSum, 0)
    return liveResponseCount > 0 ? totalSum / liveResponseCount : 0
  }, [liveStats, liveResponseCount])

  // Use managerDailyStats when available; otherwise derive daily data directly
  // from live session stats so the graph works without CF or seed data.
  const graphData = useMemo((): ManagerDailyStats[] => {
    if (dailyStats.length > 0) return dailyStats

    const byDay = new Map<string, { ratingSum: number; count: number }>()
    sessions.forEach((session) => {
      const raw = (session as any).startedAt
      if (!raw) return
      const d = raw?.toDate ? raw.toDate() : new Date(raw)
      const dateStr = d.toISOString().slice(0, 10)
      const count = session.totalFeedback ?? 0
      const ratingSum = session.ratingSum ?? 0
      if (count === 0) return
      const prev = byDay.get(dateStr) ?? { ratingSum: 0, count: 0 }
      byDay.set(dateStr, { ratingSum: prev.ratingSum + ratingSum, count: prev.count + count })
    })

    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { ratingSum, count }]) => ({
        id: date,
        managerId: user?.uid ?? "",
        date,
        sessionsHosted: 1,
        feedbackReceived: count,
        averageRating: count > 0 ? Number((ratingSum / count).toFixed(2)) : 0,
      }))
  }, [dailyStats, sessions, user])

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => (a.avgRating ?? 0) - (b.avgRating ?? 0)),
    [sessions],
  )

  if (authLoading) return null

  if (!user) return <p className="text-zinc-500">Please sign in.</p>

  return (
    <div className="space-y-8">

      <PageHeader name={user.displayName || user.email || "Manager"} />

      {toast && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {toast}
        </div>
      )}

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
            {sortedSessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                live={liveStats[s.id]}
                onCopy={copyLink}
                copied={copiedId === s.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Performance graph */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Daily Average Rating</h2>
          <span className="text-xs text-zinc-400">Last 30 days</span>
        </div>
        <DailyAverageGraph data={graphData} />
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
