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
import { SignOutButton } from "../components/SignOutButton"

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

export default function EventDirectorDashboard() {
  const { user, loading: authLoading } = useAuth()

  const [stats, setStats] = useState<EventStatsState | null>(null)
  const [topSessions, setTopSessions] = useState<Session[]>([])
  const [atRiskSessions, setAtRiskSessions] = useState<Session[]>([])
  const [reportDate, setReportDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  )
  const [reportData, setReportData] = useState<DayReportResult | null>(null)

  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [isSeeding, setIsSeeding] = useState(false)

  const [seedMessage, setSeedMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [oneStarAlert, setOneStarAlert] = useState<string | null>(null)

  useEffect(() => {
    const statsRef = doc(db, "eventStats", "global")

    let previousOneStarCount = 0
    let hasInitialStats = false

    const unsubscribeStats = onSnapshot(statsRef, (statsDoc) => {
      const data = statsDoc.data()
      if (!data) return

      const nextStats: EventStatsState = {
        feedbackCount: Number(data.feedbackCount ?? 0),
        avgRating: Number(data.avgRating ?? 0),
        oneStarCount: Number(data.oneStarCount ?? 0),
      }

      if (hasInitialStats && nextStats.oneStarCount > previousOneStarCount) {
        const delta = nextStats.oneStarCount - previousOneStarCount
        setOneStarAlert(
          `Alert: ${delta} new 1-star rating${delta > 1 ? "s" : ""} arrived`
        )
        setTimeout(() => setOneStarAlert(null), 7000)
      }

      hasInitialStats = true
      previousOneStarCount = nextStats.oneStarCount
      setStats(nextStats)
    })

    const topQuery = query(
      collection(db, "sessions"),
      orderBy("avgRating", "desc"),
      limit(5)
    )

    const unsubscribeTop = onSnapshot(topQuery, (snapshot) => {
      setTopSessions(
        snapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            }) as Session
        )
      )
      setLoading(false)
    })

    const riskQuery = query(
      collection(db, "sessions"),
      where("avgRating", ">", 0),
      where("avgRating", "<", 3),
      orderBy("avgRating", "asc"),
      limit(5)
    )

    const unsubscribeRisk = onSnapshot(
      riskQuery,
      (snapshot) => {
        setAtRiskSessions(
          snapshot.docs.map(
            (doc) =>
              ({
                id: doc.id,
                ...doc.data(),
              }) as Session
          )
        )
      },
      (err) => {
        console.error(err)
        setError(err.message || "Unable to load at-risk sessions")
      }
    )

    return () => {
      unsubscribeStats()
      unsubscribeTop()
      unsubscribeRisk()
    }
  }, [])

  const formattedOverallAverage = useMemo(() => {
    return stats ? stats.avgRating.toFixed(2) : "-"
  }, [stats])

  async function handleGenerateReport() {
    setError(null)
    setIsGeneratingReport(true)

    try {
      const callable = httpsCallable<
        { date: string },
        DayReportResult
      >(functions, "generateDayFeedbackReport")

      const result = await callable({ date: reportDate })

      setReportData(result.data)
    } catch (err) {
      console.error(err)
      setError("Unable to generate report")
    } finally {
      setIsGeneratingReport(false)
    }
  }

  async function handleSeedDemoData() {
    setError(null)
    setSeedMessage(null)
    setIsSeeding(true)

    try {
      const callable = httpsCallable(functions, "seedDummyData")

      const result: any = await callable({})

      setSeedMessage(
        `${result.data.message} Password: ${result.data.credentials.password}`
      )
    } catch (err) {
      console.error(err)
      setError("Unable to seed demo data")
    } finally {
      setIsSeeding(false)
    }
  }

  function handleDownloadReport() {
    if (!reportData) return

    const lines = [
      `Pulse Feedback Report ${reportData.date}`,
      `Total Feedback: ${reportData.totalFeedback}`,
      "",
      "AI Summary",
      `Went well: ${reportData.summary.wentWell}`,
      `Issues: ${reportData.summary.didntGoWell}`,
      `Recommendation: ${reportData.summary.recommendation}`,
      "",
      "Feedback Entries",
      ...reportData.feedback.map(
        (f, i) =>
          `${i + 1}. [${f.sessionTitle}] (${f.rating}★) ${f.comment}`
      ),
    ]

    const blob = new Blob([lines.join("\n")], {
      type: "text/plain",
    })

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = `pulse-report-${reportData.date}.txt`
    a.click()

    URL.revokeObjectURL(url)
  }

  if (authLoading) return <p className="text-slate-600">Loading...</p>

  if (!user) return <p>Please sign in</p>

  return (
    <section className="space-y-6">

      <div className="flex items-start justify-between">

        <div>
          <p className="text-xs uppercase tracking-wider text-indigo-600">
            Event Director Dashboard
          </p>

          <h1 className="text-3xl font-bold text-slate-900">
            {user.displayName || user.email}
          </h1>

          <p className="text-slate-600">
            Realtime event level feedback analytics
          </p>

          <div className="mt-4 flex gap-2">

            <Link
              to="/director/roles"
              className="rounded-md bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400"
            >
              Manage Roles
            </Link>

            <Link
              to="/director/sessions"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-700"
            >
              Manage Sessions
            </Link>

          </div>
        </div>

        <SignOutButton />

      </div>

      {oneStarAlert && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {oneStarAlert}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">

        <StatCard label="Total Feedback" value={stats?.feedbackCount ?? "-"} />

        <StatCard label="Overall Avg Rating" value={formattedOverallAverage} />

        <StatCard label="1 Star Count" value={stats?.oneStarCount ?? "-"} />

      </div>

      <SessionList title="Top Sessions" sessions={topSessions} good />

      <SessionList title="At Risk Sessions" sessions={atRiskSessions} bad />

      <ReportSection
        reportDate={reportDate}
        setReportDate={setReportDate}
        reportData={reportData}
        generate={handleGenerateReport}
        download={handleDownloadReport}
        generating={isGeneratingReport}
      />

      <SeedSection
        seed={handleSeedDemoData}
        seeding={isSeeding}
        message={seedMessage}
      />

    </section>
  )
}

function StatCard({ label, value }: any) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function SessionList({ title, sessions, good, bad }: any) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        {title}
      </h2>

      {sessions.length === 0 ? (
        <p className="text-slate-400">No sessions yet</p>
      ) : (
        <ul className="space-y-2">

          {sessions.map((s: Session) => (
            <li
              key={s.id}
              className={`rounded-md border p-3 ${
                bad
                  ? "border-red-200 bg-red-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >

              <div className="flex justify-between">

                <p className="font-medium text-slate-900">
                  {s.title ?? "Untitled"}
                </p>

                <span
                  className={`rounded px-2 py-1 text-xs ${
                    bad
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {(s.avgRating ?? 0).toFixed(2)}
                </span>

              </div>

            </li>
          ))}

        </ul>
      )}

    </div>
  )
}

function ReportSection({
  reportDate,
  setReportDate,
  generate,
  download,
  generating,
  reportData,
}: any) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

      <h2 className="text-lg font-semibold text-slate-900">
        Day Feedback Report
      </h2>

      <div className="mt-3 flex gap-2">

        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />

        <button
          onClick={generate}
          className="rounded bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-400"
        >
          {generating ? "Generating..." : "Generate"}
        </button>

        <button
          onClick={download}
          disabled={!reportData}
          className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Download
        </button>

      </div>

      {reportData && (
        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">

          <p>Total feedback: {reportData.totalFeedback}</p>

          <p className="text-green-700">
            Went well: {reportData.summary.wentWell}
          </p>

          <p className="text-red-700">
            Issues: {reportData.summary.didntGoWell}
          </p>

          <p className="text-indigo-700">
            Recommendation: {reportData.summary.recommendation}
          </p>

        </div>
      )}

    </div>
  )
}

function SeedSection({ seed, seeding, message }: any) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

      <h2 className="text-lg font-semibold text-slate-900">
        Seed Demo Data
      </h2>

      <button
        onClick={seed}
        disabled={seeding}
        className="mt-3 rounded bg-cyan-500 px-3 py-2 text-white hover:bg-cyan-600"
      >
        {seeding ? "Seeding..." : "Seed Demo Data"}
      </button>

      {message && (
        <p className="mt-2 text-sm text-green-600">
          {message}
        </p>
      )}

    </div>
  )
}