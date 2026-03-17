import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore"

import { db } from "../services/firebase"
import { StatCard } from "../components/StatCard"
import { ManagerDailyStats, Session } from "../types"
import { useAuth } from "../hooks/useAuth"
import { toDate } from "../lib/utils"

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
      <p className="text-xs font-semibold uppercase tracking-widest text-ted mb-1">Stage Manager</p>
      <h1 className="text-3xl font-black text-zinc-900 tracking-tight">{name}</h1>
      <p className="text-sm text-zinc-500 mt-1">Live session monitoring</p>
    </div>
  )
}

type LiveStats = { count: number; ratingSum: number; avg: number }

function SessionCard({
  session,
  live,
  onCopy,
  copied,
}: {
  session: Session
  live?: LiveStats
  onCopy: (s: Session) => void
  copied: boolean
}) {
  const [showLink, setShowLink] = useState(false)
  const [toggling, setToggling] = useState(false)
  const avg = live ? live.avg : (session.avgRating ?? 0)
  const count = live ? live.count : (session.totalFeedback ?? 0)
  const isLow = avg > 0 && avg < 3
  const isGood = avg >= 4

  const sessionStarted = (() => {
    const d = toDate(session.startedAt)
    return d ? d <= new Date() : false
  })()

  const canOpenFeedback = session.isActive || sessionStarted

  async function handleToggleActive() {
    setToggling(true)
    try {
      await updateDoc(doc(db, "sessions", session.id), { isActive: !session.isActive })
    } finally {
      setToggling(false)
    }
  }

  const shareUrl = `${window.location.origin}/home?session=${session.id}&code=${session.accessCode ?? ""}`

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-4 transition-shadow hover:shadow-md ${
      isLow ? "border-red-200" : "border-zinc-100"
    }`}>

      {/* Title + rating badge */}
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
            count === 0 ? "bg-zinc-100 text-zinc-400" :
            isLow ? "bg-red-100 text-red-700" :
            isGood ? "bg-green-100 text-green-700" :
            "bg-amber-100 text-amber-700"
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

      {/* Access code + share */}
      {session.accessCode && (
        <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-zinc-400 uppercase tracking-widest font-semibold">Access Code</p>
              <p className="font-mono font-bold text-zinc-800 text-lg tracking-widest mt-0.5">
                {session.accessCode}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLink((v) => !v)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-zinc-200 text-zinc-600 hover:bg-zinc-300 transition-colors"
              >
                {showLink ? "Hide link" : "Share link"}
              </button>
              <button
                onClick={() => onCopy(session)}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                  copied ? "bg-green-100 text-green-700" : "bg-zinc-900 text-white hover:bg-zinc-700"
                }`}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {showLink && (
            <div className="space-y-1">
              <p className="text-xs text-zinc-400">
                Share this link with attendees — the access code is pre-filled.
                Only share it in-room during or immediately after your session.
              </p>
              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-600 break-all select-all">
                {shareUrl}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active toggle + View details */}
      <div className="flex gap-2">
        <button
          onClick={handleToggleActive}
          disabled={toggling || !canOpenFeedback}
          title={!canOpenFeedback ? "Session has not started yet" : undefined}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            session.isActive
              ? "bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700"
              : "bg-zinc-100 text-zinc-500 hover:bg-green-100 hover:text-green-700"
          }`}
        >
          {session.isActive ? "● Feedback Open" : "○ Open Feedback"}
        </button>
        <Link
          to={`/session/${session.id}`}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ted transition-colors"
        >
          Details →
        </Link>
      </div>
    </div>
  )
}

// ─── 365-day performance graph ───────────────────────────────────────────────

const WINDOW = 365

function DailyAverageGraph({ data }: { data: ManagerDailyStats[] }) {
  const days = useMemo(
    () =>
      Array.from({ length: WINDOW }, (_, i) => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - (WINDOW - 1 - i))
        return d.toISOString().slice(0, 10)
      }),
    [],
  )

  const byDate = useMemo(
    () => Object.fromEntries(data.map((d) => [d.date, d.averageRating])),
    [data],
  )

  const hasAny = days.some((d) => byDate[d] !== undefined)

  if (!hasAny) {
    return (
      <div className="flex items-center justify-center h-36 rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400">
        No data in the last 365 days — run the seed or submit feedback to populate this graph
      </div>
    )
  }

  const barColor = (r: number) =>
    r >= 4 ? "bg-green-400" : r >= 3 ? "bg-amber-400" : "bg-red-500"

  // Month boundary labels (first day of each month visible in window)
  const monthLabels: { idx: number; label: string }[] = []
  days.forEach((date, idx) => {
    if (date.endsWith("-01") || idx === 0 || idx === WINDOW - 1) {
      monthLabels.push({ idx, label: date.slice(0, 7) })
    }
  })

  return (
    <div>
      {/* Bars */}
      <div className="flex items-end h-28" style={{ gap: "0px" }}>
        {days.map((date) => {
          const rating = byDate[date]
          const heightPct = rating ? (rating / 5) * 100 : 0
          return (
            <div
              key={date}
              className="flex-1 flex flex-col justify-end h-full group relative"
              style={{ minWidth: 0 }}
            >
              {rating !== undefined ? (
                <>
                  <div
                    className={`w-full transition-all ${barColor(rating)}`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                    <div className="bg-zinc-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {date}<br />{rating.toFixed(2)} ★
                    </div>
                    <div className="w-1.5 h-1.5 bg-zinc-900 rotate-45 -mt-1" />
                  </div>
                </>
              ) : (
                <div className="w-full h-px bg-zinc-100" />
              )}
            </div>
          )
        })}
      </div>

      {/* X-axis month labels */}
      <div className="relative h-5 mt-1.5">
        {monthLabels.slice(0, 13).map(({ idx, label }) => (
          <span
            key={label}
            className="absolute text-xs text-zinc-400 -translate-x-1/2"
            style={{ left: `${(idx / (WINDOW - 1)) * 100}%` }}
          >
            {label.slice(5)}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {[
          { color: "bg-green-400", label: "≥ 4.0 Good" },
          { color: "bg-amber-400", label: "3.0 – 3.9 Average" },
          { color: "bg-red-500", label: "< 3.0 At risk" },
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

// ─── critical feedback feed ───────────────────────────────────────────────────

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
          <p className="text-sm text-zinc-700 leading-snug">{item.comment || "No comment"}</p>
        </li>
      ))}
    </ul>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

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
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionsRef = useRef<Session[]>([])

  // Stable string of session IDs — used as effect dependency to avoid
  // re-subscribing all listeners every time onSnapshot returns a new array
  // reference with the same underlying data.
  const sessionIdKey = useMemo(
    () => sessions.map((s) => s.id).sort().join(","),
    [sessions],
  )

  // Fetch assigned sessions — keep sessionsRef in sync so child effects can
  // read current session metadata without adding sessions to their dep arrays.
  useEffect(() => {
    if (!user) { setLoading(false); return }

    const q = query(
      collection(db, "sessions"),
      where("managerId", "==", user.uid),
      limit(10),
    )

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Session)
        sessionsRef.current = next
        setSessions(next)
        setLoading(false)
      },
      (err) => { setError(err.message || "Unable to fetch sessions"); setLoading(false) },
    )

    return () => unsub()
  }, [user])

  // 365-day daily stats for graph
  useEffect(() => {
    if (!user) return

    const unsub = onSnapshot(
      query(
        collection(db, "managerDailyStats"),
        where("managerId", "==", user.uid),
        limit(365),
      ),
      (snap) => {
        // Sort newest-first client-side — no composite index needed.
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ManagerDailyStats)
        docs.sort((a, b) => b.date.localeCompare(a.date))
        setDailyStats(docs)
      },
      (err: any) => {
        const msg = String(err?.message ?? "")
        if (msg) setError(msg)
      },
    )

    return () => unsub()
  }, [user])

  // Single listener per session — computes live stats AND critical feedback together,
  // halving the number of open Firestore connections vs two separate effects.
  useEffect(() => {
    setCriticalFeedback([])
    setLiveStats({})
    hasLoadedCriticalRef.current = false
    criticalIdsRef.current = new Set()

    const current = sessionsRef.current
    if (!user || current.length === 0) return

    const armTimer = setTimeout(() => {
      hasLoadedCriticalRef.current = true
    }, 800)

    const unsubs = current.slice(0, 10).map((session) =>
      onSnapshot(
        collection(db, "sessions", session.id, "feedback"),
        (snap) => {
          // Live stats
          const count = snap.size
          const ratingSum = snap.docs.reduce((s, d) => s + Number(d.data().rating ?? 0), 0)
          setLiveStats((prev) => ({
            ...prev,
            [session.id]: { count, ratingSum, avg: count > 0 ? ratingSum / count : 0 },
          }))

          // Critical feedback (≤2 stars)
          const items = snap.docs
            .filter((d) => Number(d.data().rating ?? 0) <= 2)
            .slice(0, 10)
            .map((d) => ({
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
            return [...filtered, ...items].sort((a, b) => a.rating - b.rating).slice(0, 10)
          })

          if (hasLoadedCriticalRef.current && newItem) {
            setToast(`New critical feedback: ${newItem.sessionTitle} (${newItem.rating}★)`)
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
            toastTimeoutRef.current = setTimeout(() => setToast(null), 4000)
          }
        },
        (err: any) => {
          if (err?.code === "permission-denied") return
          setError(String(err?.message ?? "Unable to fetch feedback"))
        },
      )
    )

    return () => {
      clearTimeout(armTimer)
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      unsubs.forEach((u) => u())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionIdKey])

  function copyLink(session: Session) {
    const url = `${window.location.origin}/home?session=${session.id}&code=${session.accessCode ?? ""}`
    const done = () => { setCopiedId(session.id); setTimeout(() => setCopiedId(null), 2000) }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done))
    } else {
      fallbackCopy(url, done)
    }
  }

  function fallbackCopy(text: string, done: () => void) {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try { document.execCommand("copy"); done() } finally { document.body.removeChild(ta) }
  }

  const liveResponseCount = useMemo(
    () => Object.values(liveStats).reduce((s, st) => s + st.count, 0),
    [liveStats],
  )

  const liveAvgRating = useMemo(() => {
    const totalSum = Object.values(liveStats).reduce((s, st) => s + st.ratingSum, 0)
    return liveResponseCount > 0 ? totalSum / liveResponseCount : 0
  }, [liveStats, liveResponseCount])

  // Use managerDailyStats for graph; derive from session data when unavailable
  const graphData = useMemo((): ManagerDailyStats[] => {
    if (dailyStats.length > 0) return dailyStats

    const byDay = new Map<string, { ratingSum: number; count: number }>()
    sessions.forEach((session) => {
      const d = toDate((session as any).startedAt)
      if (!d) return
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

  // Sort sessions: at-risk first, then by avg rating descending
  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const aAvg = liveStats[a.id]?.avg ?? a.avgRating ?? 0
        const bAvg = liveStats[b.id]?.avg ?? b.avgRating ?? 0
        const aRisk = aAvg > 0 && aAvg < 3 ? 0 : 1
        const bRisk = bAvg > 0 && bAvg < 3 ? 0 : 1
        if (aRisk !== bRisk) return aRisk - bRisk
        return bAvg - aAvg
      }),
    [sessions, liveStats],
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

      {/* Stats summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sessions" value={sessions.length} sub="assigned to you" />
        <StatCard label="Total Responses" value={liveResponseCount} sub="across all sessions" />
        <StatCard
          label="Average Rating"
          value={liveResponseCount === 0 ? "—" : liveAvgRating.toFixed(2)}
          sub="weighted across sessions"
        />
      </div>

      {/* Sessions grid — at-risk shown first */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Your Sessions
          </h2>
          <p className="text-xs text-zinc-400">At-risk sessions sorted to top</p>
        </div>

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

      {/* 365-day performance graph */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Daily Average Rating</h2>
          <span className="text-xs text-zinc-400">Past 365 days</span>
        </div>
        <DailyAverageGraph data={graphData} />
      </div>

      {/* How to distribute feedback forms — brief guidance */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-zinc-900 mb-1">Distributing Feedback Securely</h2>
        <p className="text-xs text-zinc-500 mb-4">
          The access code gates your session's feedback form — only attendees you share it with can submit.
        </p>
        <ul className="space-y-2 text-sm text-zinc-600">
          {[
            "Share the code or link verbally or on screen only inside the venue during or immediately after your session.",
            "Do not post the code publicly or share it in advance — this lets the director verify that submissions came from genuine attendees.",
            "Each attendee can submit only once per session. If you see fewer unique submitters than responses, contact the Event Director.",
          ].map((tip, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-100 text-zinc-500 text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Critical feedback feed */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Critical Feedback</h2>
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">≤ 2★</span>
        </div>
        <CriticalFeed feedback={criticalFeedback} />
      </div>

    </div>
  )
}
