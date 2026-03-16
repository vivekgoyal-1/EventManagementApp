import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"

import { db, functions } from "../services/firebase"
import type { DayReportSummary, Session } from "../types"
import { useAuth } from "../hooks/useAuth"

type EventStatsState = {
  feedbackCount: number
  avgRating: number
  oneStarCount: number
}

type ReportRow = {
  id: string
  sessionId: string
  sessionTitle: string
  rating: number
  comment: string
  managerId: string | null
}

type DayReportResult = {
  date: string
  totalFeedback: number
  summary: DayReportSummary & { sampleComments?: string[] }
  feedback: ReportRow[]
}

function StatCard({ label, value, highlight = false, sub }: {
  label: string
  value: any
  highlight?: boolean
  sub?: string
}) {
  return (
    <div className={`rounded-2xl border shadow-sm p-6 ${
      highlight ? "bg-red-50 border-red-200" : "bg-white border-zinc-100"
    }`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
      <p className={`mt-3 text-4xl font-black tabular-nums leading-none ${
        highlight ? "text-red-700" : "text-zinc-900"
      }`}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

function Leaderboard({ sessions }: { sessions: Session[] }) {
  const rankStyle = (i: number) => {
    if (i === 0) return "bg-yellow-100 text-yellow-700"
    if (i === 1) return "bg-zinc-200 text-zinc-600"
    if (i === 2) return "bg-orange-100 text-orange-700"
    return "bg-zinc-100 text-zinc-500"
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-zinc-400 py-4">No sessions with feedback yet</p>
  }

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
          <span className="shrink-0 font-bold text-zinc-900 text-sm">
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
          <span className="shrink-0 font-bold text-red-700 text-sm">
            {(s.avgRating ?? 0).toFixed(2)} ★
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function EventDirectorDashboard() {
  const { user, loading: authLoading } = useAuth()

  const [stats, setStats] = useState<EventStatsState | null>(null)
  const [topSessions, setTopSessions] = useState<Session[]>([])
  const [atRiskSessions, setAtRiskSessions] = useState<Session[]>([])
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reportData, setReportData] = useState<DayReportResult | null>(null)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [isSeeding, setIsSeeding] = useState(false)
  const [seedMessage, setSeedMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [oneStarAlert, setOneStarAlert] = useState<string | null>(null)

  useEffect(() => {
    const statsRef = doc(db, "eventStats", "global")
    let prevOneStarCount = 0
    let hasInit = false

    const unsubStats = onSnapshot(statsRef, (snap) => {
      const data = snap.data()
      if (!data) return

      const next: EventStatsState = {
        feedbackCount: Number(data.feedbackCount ?? 0),
        avgRating: Number(data.avgRating ?? 0),
        oneStarCount: Number(data.oneStarCount ?? 0),
      }

      if (hasInit && next.oneStarCount > prevOneStarCount) {
        const delta = next.oneStarCount - prevOneStarCount
        setOneStarAlert(`${delta} new 1-star rating${delta > 1 ? "s" : ""} just arrived`)
        setTimeout(() => setOneStarAlert(null), 8000)
      }

      hasInit = true
      prevOneStarCount = next.oneStarCount
      setStats(next)
    })

    const unsubTop = onSnapshot(
      query(collection(db, "sessions"), orderBy("avgRating", "desc"), limit(5)),
      (snap) => {
        setTopSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Session))
        setLoading(false)
      },
    )

    const unsubRisk = onSnapshot(
      query(
        collection(db, "sessions"),
        where("avgRating", ">", 0),
        where("avgRating", "<", 3),
        orderBy("avgRating", "asc"),
        limit(5),
      ),
      (snap) => setAtRiskSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Session)),
      (err) => setError(err.message || "Unable to load at-risk sessions"),
    )

    return () => { unsubStats(); unsubTop(); unsubRisk() }
  }, [])

  const formattedAvg = useMemo(() => (stats ? stats.avgRating.toFixed(2) : "—"), [stats])

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

  async function handleSeedDemoData() {
    setError(null)
    setSeedMessage(null)
    setIsSeeding(true)
    try {
      const fn = httpsCallable(functions, "seedDummyData")
      const result: any = await fn({})
      setSeedMessage(`Seeded successfully · Password: ${result.data.credentials.password}`)
    } catch {
      setError("Unable to seed demo data")
    } finally {
      setIsSeeding(false)
    }
  }

  function handleDownloadReport() {
    if (!reportData) return

    const lines = [
      `EFP · Event Feedback Report`,
      `Date: ${reportData.date}`,
      `Total Feedback: ${reportData.totalFeedback}`,
      "",
      "── AI SUMMARY ──────────────────────────",
      `What went well: ${reportData.summary.wentWell}`,
      `What didn't go well: ${reportData.summary.didntGoWell}`,
      `Recommendation: ${reportData.summary.recommendation}`,
      "",
      "── FEEDBACK ENTRIES ─────────────────────",
      ...reportData.feedback.map(
        (f, i) => `${i + 1}. [${f.sessionTitle}] (${f.rating}★)\n   ${f.comment}`,
      ),
    ]

    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `pulse-report-${reportData.date}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (authLoading) return null
  if (!user) return <p className="text-zinc-500">Please sign in.</p>

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-ted mb-1">
          Event Director
        </p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-zinc-900 tracking-tight">
              {user.displayName || user.email}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">Real-time event analytics</p>
          </div>
          <div className="flex gap-2 shrink-0 pt-1">
            <Link
              to="/director/sessions"
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 transition-colors"
            >
              Sessions
            </Link>
            <Link
              to="/director/roles"
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
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

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Responses" value={stats?.feedbackCount ?? "—"} sub="event-wide" />
        <StatCard label="Overall Average" value={formattedAvg} sub="weighted across all sessions" />
        <StatCard label="1-Star Ratings" value={stats?.oneStarCount ?? "—"} highlight={Boolean(stats && stats.oneStarCount > 0)} sub="requires attention" />
      </div>

      {/* Leaderboard + At Risk side by side */}
      <div className="grid gap-4 lg:grid-cols-2">

        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
            Top Sessions
          </h2>
          {loading ? (
            <p className="text-sm text-zinc-400">Loading…</p>
          ) : (
            <Leaderboard sessions={topSessions} />
          )}
        </div>

        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
            At Risk  <span className="text-red-500">· avg &lt; 3.0</span>
          </h2>
          <AtRiskList sessions={atRiskSessions} />
        </div>

      </div>

      {/* Day Report */}
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-6 space-y-4">

        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Day Feedback Report</h2>
          <p className="text-xs text-zinc-400 mt-0.5">AI-generated summary with all feedback for a selected date</p>
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
              <div className="flex gap-2">
                <span className="text-green-600 text-sm shrink-0 mt-0.5">✓</span>
                <p className="text-sm text-zinc-700"><span className="font-semibold">Went well:</span> {reportData.summary.wentWell}</p>
              </div>
              <div className="flex gap-2">
                <span className="text-red-500 text-sm shrink-0 mt-0.5">✗</span>
                <p className="text-sm text-zinc-700"><span className="font-semibold">Issues:</span> {reportData.summary.didntGoWell}</p>
              </div>
              <div className="flex gap-2">
                <span className="text-ted text-sm shrink-0 mt-0.5">→</span>
                <p className="text-sm text-zinc-700"><span className="font-semibold">Recommendation:</span> {reportData.summary.recommendation}</p>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Seed section */}
      <div className="bg-white rounded-2xl border border-dashed border-zinc-200 p-6">
        <h2 className="text-sm font-semibold text-zinc-900">Seed Demo Data</h2>
        <p className="text-xs text-zinc-400 mt-1 mb-4">
          Creates 4 sessions with 25 realistic feedback entries each and 365-day history.
        </p>
        <button
          onClick={handleSeedDemoData}
          disabled={isSeeding}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 transition"
        >
          {isSeeding ? "Seeding…" : "Run Seed"}
        </button>
        {seedMessage && (
          <p className="mt-3 text-sm text-green-600 font-medium">{seedMessage}</p>
        )}
      </div>

    </div>
  )
}
