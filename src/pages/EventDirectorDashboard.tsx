import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { collection, doc, onSnapshot } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"

import { db, functions } from "../services/firebase"
import { RatingBadge } from "../components/RatingBadge"
import { StatCard } from "../components/StatCard"
import type { DayReportSummary, Session } from "../types"
import { useAuth } from "../hooks/useAuth"

type DayReportResult = {
  date: string
  totalFeedback: number
  summary: DayReportSummary & { sampleComments?: string[] }
  feedback: Array<{ id: string; sessionId: string; sessionTitle: string; rating: number; comment: string }>
}

// ─── per-manager summary ──────────────────────────────────────────────────────

type ManagerRow = {
  managerId: string
  managerName: string
  sessions: Session[]
  totalFeedback: number
  ratingSum: number
  avgRating: number
}

function ManagerSummaryTable({ rows }: { rows: ManagerRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-400 py-4">No manager data yet</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100">
            {["Manager", "Sessions", "Responses", "Avg ★"].map((h, i) => (
              <th
                key={h}
                className={`py-2 text-xs font-semibold uppercase tracking-widest text-zinc-400 font-normal ${i === 0 ? "text-left pr-4" : "text-right px-4"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-50">
          {rows.map((row) => (
            <tr key={row.managerId} className="hover:bg-zinc-50 transition-colors">
              <td className="py-3 pr-4 font-medium text-zinc-900">{row.managerName}</td>
              <td className="py-3 px-4 text-right tabular-nums text-zinc-600">{row.sessions.length}</td>
              <td className="py-3 px-4 text-right tabular-nums text-zinc-600">{row.totalFeedback}</td>
              <td className="py-3 pl-4 text-right">
                <RatingBadge avg={row.avgRating} count={row.totalFeedback} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── all-sessions table ───────────────────────────────────────────────────────

type SortKey = "title" | "manager" | "responses" | "avg"

function AllSessionsTable({ sessions }: { sessions: Session[] }) {
  const [sort, setSort] = useState<SortKey>("avg")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [filterManager, setFilterManager] = useState("")
  const [search, setSearch] = useState("")

  const managers = useMemo(() => {
    const names = new Set(sessions.map((s) => s.managerName ?? s.managerEmail ?? "Unknown"))
    return Array.from(names).sort()
  }, [sessions])

  const sorted = useMemo(() => {
    let list = [...sessions]
    if (filterManager) list = list.filter((s) => (s.managerName ?? s.managerEmail) === filterManager)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((s) => (s.title ?? "").toLowerCase().includes(q))
    }

    list.sort((a, b) => {
      let diff = 0
      if (sort === "title") diff = (a.title ?? "").localeCompare(b.title ?? "")
      else if (sort === "manager") diff = (a.managerName ?? "").localeCompare(b.managerName ?? "")
      else if (sort === "responses") diff = (a.totalFeedback ?? 0) - (b.totalFeedback ?? 0)
      else diff = (a.avgRating ?? 0) - (b.avgRating ?? 0)
      return sortDir === "asc" ? diff : -diff
    })

    return list
  }, [sessions, sort, sortDir, filterManager, search])

  function toggleSort(key: SortKey) {
    if (sort === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSort(key); setSortDir("desc") }
  }

  if (sessions.length === 0) return <p className="text-sm text-zinc-400 py-4">No sessions yet</p>

  const sortIcon = (key: SortKey) => sort === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions…"
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
        />
        <select
          value={filterManager}
          onChange={(e) => setFilterManager(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
        >
          <option value="">All managers</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="ml-auto self-center text-xs text-zinc-400">
          {sorted.length} session{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-100">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-100">
            <tr>
              {(
                [
                  { label: "Session", key: "title" as SortKey, align: "left", extra: "pl-4 pr-2" },
                  { label: "", key: null, align: "left", extra: "pr-4" },
                  { label: "Manager", key: "manager" as SortKey, align: "left", extra: "px-4" },
                  { label: "Responses", key: "responses" as SortKey, align: "right", extra: "px-4" },
                  { label: "Avg ★", key: "avg" as SortKey, align: "right", extra: "px-4" },
                  { label: "", key: null, align: "right", extra: "pl-4 pr-4" },
                ] as const
              ).map(({ label, key, align, extra }) => (
                <th
                  key={label + extra}
                  className={`py-2 ${extra} text-${align} text-xs font-semibold uppercase tracking-widest text-zinc-400 font-normal ${key ? "cursor-pointer select-none hover:text-zinc-600 transition-colors" : ""}`}
                  onClick={key ? () => toggleSort(key) : undefined}
                >
                  {label}{key ? sortIcon(key) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {sorted.map((s) => {
              const avg = s.avgRating ?? 0
              const count = s.totalFeedback ?? 0
              const isLow = avg > 0 && avg < 3
              return (
                <tr key={s.id} className={`hover:bg-zinc-50 transition-colors ${isLow ? "bg-red-50/40" : ""}`}>
                  <td className="py-3 pl-4 pr-2 font-medium text-zinc-900">
                    <Link to={`/session/${s.id}`} className="hover:text-ted transition-colors">
                      {s.title ?? "Untitled"}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    {isLow && (
                      <span className="text-xs text-red-600 font-semibold bg-red-100 rounded-full px-2 py-0.5">
                        ⚠ At risk
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-zinc-500">{s.managerName ?? s.managerEmail ?? "—"}</td>
                  <td className="py-3 px-4 text-right tabular-nums text-zinc-600">{count}</td>
                  <td className="py-3 px-4 text-right">
                    <RatingBadge avg={avg} count={count} />
                  </td>
                  <td className="py-3 pl-4 pr-4 text-right">
                    <Link to={`/session/${s.id}`} className="text-xs font-semibold text-zinc-500 hover:text-ted transition-colors">
                      View →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── leaderboard + at-risk ────────────────────────────────────────────────────

function Leaderboard({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) return <p className="text-sm text-zinc-400 py-4">No sessions with feedback yet</p>

  const rankStyle = (i: number) =>
    i === 0 ? "bg-yellow-100 text-yellow-700" :
    i === 1 ? "bg-zinc-200 text-zinc-600" :
    i === 2 ? "bg-orange-100 text-orange-700" :
    "bg-zinc-100 text-zinc-500"

  return (
    <ul className="divide-y divide-zinc-100">
      {sessions.map((s, i) => (
        <li key={s.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${rankStyle(i)}`}>
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <Link to={`/session/${s.id}`} className="font-semibold text-zinc-900 hover:text-ted transition-colors text-sm truncate block">
              {s.title ?? "Untitled"}
            </Link>
            <p className="text-xs text-zinc-400">{s.managerName ?? "—"} · {s.totalFeedback ?? 0} responses</p>
          </div>
          <span className="shrink-0 font-bold text-zinc-900 text-sm tabular-nums">
            {(s.avgRating ?? 0).toFixed(2)} ★
          </span>
        </li>
      ))}
    </ul>
  )
}

function AtRiskList({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-green-600 font-medium gap-2">
        <span>✓</span> All sessions above threshold
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <span className="text-red-500 text-lg shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <Link to={`/session/${s.id}`} className="font-semibold text-red-900 hover:text-ted transition-colors text-sm truncate block">
              {s.title ?? "Untitled"}
            </Link>
            <p className="text-xs text-red-600">{s.managerName ?? "—"} · {s.totalFeedback ?? 0} responses</p>
          </div>
          <span className="shrink-0 font-bold text-red-700 text-sm tabular-nums">
            {(s.avgRating ?? 0).toFixed(2)} ★
          </span>
        </li>
      ))}
    </ul>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function EventDirectorDashboard() {
  const { user, loading: authLoading } = useAuth()

  const [allSessions, setAllSessions] = useState<Session[]>([])
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reportData, setReportData] = useState<DayReportResult | null>(null)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [isSeeding, setIsSeeding] = useState(false)
  const [seedMessage, setSeedMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [oneStarAlert, setOneStarAlert] = useState<string | null>(null)
  const [liveFeedbackStats, setLiveFeedbackStats] = useState<
    Record<string, { count: number; ratingSum: number; oneStarCount: number }>
  >({})

  // Track alert timeout so it can be cleared on unmount
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep a ref so the live-feedback effect can read current sessions without
  // adding the array itself to deps (which would thrash all listeners on every snapshot).
  const allSessionsRef = useRef<Session[]>([])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    setLoading(true)

    const unsubSessions = onSnapshot(
      collection(db, "sessions"),
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Session)
        allSessionsRef.current = next
        setAllSessions(next)
        setLoading(false)
      },
      (err) => { setError(err.message || "Unable to load sessions"); setLoading(false) },
    )

    let prevOneStarCount = 0
    let hasInit = false
    const unsubStats = onSnapshot(
      doc(db, "eventStats", "global"),
      (snap) => {
        if (!snap.data()) return
        const next = Number(snap.data()!.oneStarCount ?? 0)
        if (hasInit && next > prevOneStarCount) {
          const delta = next - prevOneStarCount
          setOneStarAlert(`${delta} new 1-star rating${delta > 1 ? "s" : ""} just arrived`)
          if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
          alertTimeoutRef.current = setTimeout(() => setOneStarAlert(null), 8000)
        }
        hasInit = true
        prevOneStarCount = next
      },
      (err) => console.error("eventStats listener failed", err),
    )

    return () => {
      unsubSessions()
      unsubStats()
      if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
    }
  }, [user])

  // Stable string of session IDs — prevents re-subscribing all per-session listeners
  // just because onSnapshot returned a new array reference with the same contents.
  const sessionIdKey = useMemo(
    () => allSessions.map((s) => s.id).sort().join(","),
    [allSessions],
  )

  // Live per-session feedback counts — one listener per session.
  // Depends on sessionIdKey (stable string) rather than the allSessions array so
  // listeners are only torn down/recreated when the actual set of session IDs changes.
  useEffect(() => {
    const current = allSessionsRef.current
    if (current.length === 0) { setLiveFeedbackStats({}); return }

    const unsubs = current.map((session) =>
      onSnapshot(
        collection(db, "sessions", session.id, "feedback"),
        (snap) => {
          const count = snap.size
          const ratingSum = snap.docs.reduce((s, d) => s + Number(d.data().rating ?? 0), 0)
          const oneStarCount = snap.docs.filter((d) => Number(d.data().rating) === 1).length
          setLiveFeedbackStats((prev) => ({ ...prev, [session.id]: { count, ratingSum, oneStarCount } }))
        },
        (err) => console.error("feedback listener failed for", session.id, err),
      )
    )

    return () => unsubs.forEach((u) => u())
  
  }, [sessionIdKey])

  // Merge live feedback stats into session objects
  const allSessionsWithLive = useMemo(() =>
    allSessions.map((s) => {
      const live = liveFeedbackStats[s.id]
      if (!live) return s
      const liveAvg = live.count > 0 ? Number((live.ratingSum / live.count).toFixed(2)) : 0
      return { ...s, totalFeedback: live.count, ratingSum: live.ratingSum, avgRating: liveAvg }
    }),
    [allSessions, liveFeedbackStats],
  )

  const topSessions = useMemo(
    () => [...allSessionsWithLive]
      .filter((s) => (s.totalFeedback ?? 0) > 0)
      .sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))
      .slice(0, 5),
    [allSessionsWithLive],
  )

  const atRiskSessions = useMemo(
    () => [...allSessionsWithLive]
      .filter((s) => (s.avgRating ?? 0) > 0 && (s.avgRating ?? 0) < 3)
      .sort((a, b) => (a.avgRating ?? 0) - (b.avgRating ?? 0))
      .slice(0, 5),
    [allSessionsWithLive],
  )

  const managerRows = useMemo((): ManagerRow[] => {
    const map = new Map<string, ManagerRow>()
    for (const s of allSessionsWithLive) {
      const mId = s.managerId ?? "unknown"
      const existing = map.get(mId) ?? {
        managerId: mId,
        managerName: s.managerName ?? s.managerEmail ?? "Unknown",
        sessions: [],
        totalFeedback: 0,
        ratingSum: 0,
        avgRating: 0,
      }
      existing.sessions.push(s)
      existing.totalFeedback += s.totalFeedback ?? 0
      existing.ratingSum += s.ratingSum ?? 0
      existing.avgRating =
        existing.totalFeedback > 0
          ? Number((existing.ratingSum / existing.totalFeedback).toFixed(2))
          : 0
      map.set(mId, existing)
    }
    return [...map.values()].sort((a, b) => b.avgRating - a.avgRating)
  }, [allSessionsWithLive])

  const liveStats = useMemo(() => {
    const { feedbackCount, ratingSum, oneStarCount } = allSessionsWithLive.reduce(
      (acc, sess) => {
        acc.feedbackCount += sess.totalFeedback ?? 0
        acc.ratingSum += sess.ratingSum ?? 0
        acc.oneStarCount += liveFeedbackStats[sess.id]?.oneStarCount ?? 0
        return acc
      },
      { feedbackCount: 0, ratingSum: 0, oneStarCount: 0 },
    )
    return {
      feedbackCount,
      avgRating: feedbackCount > 0 ? ratingSum / feedbackCount : 0,
      oneStarCount,
    }
  }, [allSessionsWithLive, liveFeedbackStats])

  async function handleSeedDemoData() {
    setError(null)
    setSeedMessage(null)
    setIsSeeding(true)
    try {
      const fn = httpsCallable(functions, "seedDummyData")
      const result: any = await fn({})
      setSeedMessage(`Seeded · Password: ${result.data.credentials.password}`)
    } catch {
      setError("Unable to seed demo data")
    } finally {
      setIsSeeding(false)
    }
  }

  async function handleGenerateReport() {
    setError(null)
    setIsGeneratingReport(true)
    try {
      const fn = httpsCallable<{ date: string }, DayReportResult>(functions, "generateDayFeedbackReport")
      const result = await fn({ date: reportDate })
      setReportData(result.data)
    } catch {
      setError("Unable to generate report. Check that the Gemini API key is configured.")
    } finally {
      setIsGeneratingReport(false)
    }
  }

  function handleDownloadReport() {
    if (!reportData) return
    const lines = [
      `TEDx Event Feedback Report`,
      `Date: ${reportData.date}`,
      `Total Feedback: ${reportData.totalFeedback}`,
      "",
      "── AI SUMMARY ──────────────────────────",
      `What went well: ${reportData.summary.wentWell}`,
      `What didn't go well: ${reportData.summary.didntGoWell}`,
      `Recommendation: ${reportData.summary.recommendation}`,
      "",
      "── FEEDBACK ENTRIES ─────────────────────",
      ...reportData.feedback.map((f, i) => `${i + 1}. [${f.sessionTitle}] (${f.rating}★)\n   ${f.comment}`),
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `tedx-feedback-${reportData.date}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (authLoading) return null
  if (!user) return <p className="text-zinc-500">Please sign in.</p>

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-ted mb-1">Event Director</p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-zinc-900 tracking-tight">
              {user.displayName || user.email}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">Real-time event analytics</p>
          </div>
          <div className="flex gap-2 shrink-0 pt-1">
            <Link to="/director/sessions" className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 transition-colors">
              Sessions
            </Link>
            <Link to="/director/roles" className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors">
              Roles
            </Link>
          </div>
        </div>
      </div>

      {/* 1-star alert */}
      {oneStarAlert && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-center gap-3">
          <span className="text-red-500 text-xl shrink-0">⚠</span>
          <div>
            <p className="font-semibold text-red-800 text-sm">{oneStarAlert}</p>
            <p className="text-xs text-red-600 mt-0.5">Check the At Risk panel below</p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Top-level stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Responses" value={liveStats.feedbackCount || "—"} sub="event-wide" />
        <StatCard
          label="Overall Average"
          value={liveStats.feedbackCount > 0 ? liveStats.avgRating.toFixed(2) : "—"}
          sub="weighted across all sessions"
        />
        <StatCard
          label="1-Star Ratings"
          value={liveStats.oneStarCount || "—"}
          highlight={liveStats.oneStarCount > 0}
          sub="requires attention"
        />
      </div>

      {/* Per-manager breakdown */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
          Manager Performance
        </h2>
        {loading ? <p className="text-sm text-zinc-400">Loading…</p> : <ManagerSummaryTable rows={managerRows} />}
      </div>

      {/* Leaderboard + At Risk */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">Top Sessions</h2>
          {loading ? <p className="text-sm text-zinc-400">Loading…</p> : <Leaderboard sessions={topSessions} />}
        </div>
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
            At Risk <span className="text-red-500">· avg &lt; 3.0</span>
          </h2>
          <AtRiskList sessions={atRiskSessions} />
        </div>
      </div>

      {/* All sessions drill-down */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">All Sessions</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Click any session to drill into its feedback</p>
          </div>
          <span className="text-xs text-zinc-400">{allSessionsWithLive.length} total</span>
        </div>
        {loading ? <p className="text-sm text-zinc-400">Loading…</p> : <AllSessionsTable sessions={allSessionsWithLive} />}
      </div>

      {/* Day Feedback Report */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Day Feedback Report</h2>
          <p className="text-xs text-zinc-400 mt-0.5">AI-generated summary of all feedback for a selected date</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-900 focus:border-ted focus:outline-none focus:ring-2 focus:ring-ted/10 transition"
          />
          <button
            onClick={handleGenerateReport}
            disabled={isGeneratingReport}
            className="rounded-xl bg-ted px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition"
          >
            {isGeneratingReport ? "Generating…" : "Generate"}
          </button>
          <button
            onClick={handleDownloadReport}
            disabled={!reportData}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition"
          >
            Download .txt
          </button>
        </div>
        {reportData && (
          <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              {reportData.date} · {reportData.totalFeedback} feedback entries
            </p>
            <div className="space-y-2">
              {[
                { icon: "✓", color: "text-green-600", label: "Went well", text: reportData.summary.wentWell },
                { icon: "✗", color: "text-red-500", label: "Issues", text: reportData.summary.didntGoWell },
                { icon: "→", color: "text-ted", label: "Recommendation", text: reportData.summary.recommendation },
              ].map(({ icon, color, label, text }) => (
                <div key={label} className="flex gap-2">
                  <span className={`${color} text-sm shrink-0 mt-0.5`}>{icon}</span>
                  <p className="text-sm text-zinc-700">
                    <span className="font-semibold">{label}:</span> {text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Seed section */}
      <div className="bg-white rounded-2xl border border-dashed border-zinc-200 p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Seed Demo Data</h2>
        <p className="text-xs text-zinc-400 mt-1 mb-4">
          Creates 2 managers · 4 sessions each · 25 feedback per session · 365-day history.
        </p>
        <button
          onClick={handleSeedDemoData}
          disabled={isSeeding}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 transition"
        >
          {isSeeding ? "Seeding…" : "Run Seed"}
        </button>
        {seedMessage && <p className="mt-3 text-sm text-green-600 font-medium">{seedMessage}</p>}
      </div>

    </div>
  )
}
