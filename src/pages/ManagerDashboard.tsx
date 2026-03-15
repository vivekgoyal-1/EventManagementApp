import { useEffect, useMemo, useState } from "react"
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
import { SignOutButton } from "../components/SignOutButton"

type CriticalFeedback = {
  id: string
  sessionId: string
  sessionTitle: string
  comment: string
  rating: number
  createdAt?: Timestamp
}

function DailyAverageGraph({ data }: { data: ManagerDailyStats[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400">No daily stats yet</p>
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))

  const points = sorted.map((d, idx) => {
    const x = (idx / Math.max(sorted.length - 1, 1)) * 100
    const y = 100 - Math.max(0, Math.min(5, d.averageRating)) * 20
    return `${x},${y}`
  })

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900">
          Daily Average Rating
        </p>
        <p className="text-xs text-slate-500">1.0 to 5.0</p>
      </div>

      <svg viewBox="0 0 100 100" className="h-40 w-full">
        {[20, 40, 60, 80].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="#e2e8f0"
            strokeWidth="0.5"
          />
        ))}

        <polyline
          fill="none"
          stroke="#6366f1"
          strokeWidth="1.5"
          points={points.join(" ")}
        />
      </svg>
    </div>
  )
}

export default function ManagerDashboard() {
  const { user, loading: authLoading } = useAuth()

  const [sessions, setSessions] = useState<Session[]>([])
  const [dailyStats, setDailyStats] = useState<ManagerDailyStats[]>([])
  const [criticalFeedback, setCriticalFeedback] = useState<CriticalFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      setSessions([])
      setLoading(false)
      return
    }

    const q = query(
      collection(db, "sessions"),
      where("managerId", "==", user.uid),
      limit(4)
    )

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Session[]

        setSessions(list)
        setLoading(false)
      },
      (err) => {
        setError(err.message || "Unable to fetch manager sessions")
        setLoading(false)
      }
    )

    return () => unsub()
  }, [user])

  useEffect(() => {
    if (!user) return

    const dailyQuery = query(
      collection(db, "managerDailyStats"),
      where("managerId", "==", user.uid),
      orderBy("date", "desc"),
      limit(365)
    )

    const unsub = onSnapshot(
      dailyQuery,
      (snapshot) => {
        setDailyStats(
          snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })) as ManagerDailyStats[]
        )
      },
      (err) => setError(err.message || "Unable to fetch daily averages")
    )

    return () => unsub()
  }, [user])

  useEffect(() => {
    if (sessions.length === 0) {
      setCriticalFeedback([])
      return
    }

    const unsubs = sessions.slice(0, 4).map((session) => {
      const feedbackQuery = query(
        collection(db, "sessions", session.id, "feedback"),
        where("rating", "<=", 2),
        limit(5)
      )

      return onSnapshot(feedbackQuery, (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          id: doc.id,
          sessionId: session.id,
          sessionTitle: session.title ?? "Untitled Session",
          comment: String(doc.data().comment ?? ""),
          rating: Number(doc.data().rating ?? 0),
          createdAt: doc.data().createdAt as Timestamp | undefined,
        }))

        setCriticalFeedback((current) => {
          const filtered = current.filter((f) => f.sessionId !== session.id)
          const combined = [...filtered, ...items]

          combined.sort((a, b) => a.rating - b.rating)

          return combined.slice(0, 10)
        })
      })
    })

    return () => unsubs.forEach((u) => u())
  }, [sessions])

  const liveResponseCount = useMemo(
    () => sessions.reduce((sum, s) => sum + (s.totalFeedback ?? 0), 0),
    [sessions]
  )

  const liveAvgRating = useMemo(() => {
    const valid = sessions.filter((s) => typeof s.avgRating === "number")
    if (!valid.length) return 0
    return valid.reduce((sum, s) => sum + (s.avgRating ?? 0), 0) / valid.length
  }, [sessions])

  if (authLoading) {
    return <p className="text-slate-600">Loading authentication...</p>
  }

  if (!user) {
    return <p className="text-red-500">Please sign in to view dashboard</p>
  }

  return (
    <section className="space-y-6">

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-indigo-600">
            Stage Manager Dashboard
          </p>

          <h1 className="text-3xl font-bold text-slate-900">
            {user.displayName || user.email}
          </h1>

          <p className="text-sm text-slate-600">
            Live session and feedback monitoring
          </p>
        </div>

        <SignOutButton />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">

        <StatCard label="Sessions Assigned" value={sessions.length} />

        <StatCard label="Live Responses" value={liveResponseCount} />

        <StatCard label="Average Rating" value={liveAvgRating.toFixed(2)} />

      </div>

      <SessionList sessions={sessions} loading={loading} user={user} />

      <DailyAverageGraph data={dailyStats} />

      <CriticalFeed feedback={criticalFeedback} />

    </section>
  )
}

function StatCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function SessionList({ sessions, loading }: any) {
  if (loading) {
    return <p className="text-slate-500">Loading sessions...</p>
  }

  if (!sessions.length) {
    return <p className="text-slate-400">No sessions assigned yet</p>
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        Assigned Sessions
      </h2>

      <ul className="space-y-3">

        {sessions.map((session: Session) => {

          const avg = session.avgRating ?? 0
          const low = avg < 3

          return (
            <li
              key={session.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
            >

              <div className="flex items-center justify-between">

                <p className="font-medium text-slate-900">
                  {session.title ?? "Untitled Session"}
                </p>

                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    low
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {avg.toFixed(2)}
                </span>

              </div>

              <p className="mt-1 text-xs text-slate-500">
                Feedback: {session.totalFeedback ?? 0}
              </p>

            </li>
          )
        })}

      </ul>

    </div>
  )
}

function CriticalFeed({ feedback }: { feedback: CriticalFeedback[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        Critical Feedback
      </h2>

      {feedback.length === 0 ? (
        <p className="text-sm text-slate-400">
          No critical comments yet
        </p>
      ) : (
        <ul className="space-y-2">

          {feedback.map((item) => (
            <li
              key={`${item.sessionId}-${item.id}`}
              className="rounded-md border border-red-200 bg-red-50 p-3"
            >

              <div className="flex items-center justify-between">

                <p className="text-sm font-medium text-slate-900">
                  {item.sessionTitle}
                </p>

                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  {item.rating}★
                </span>

              </div>

              <p className="mt-1 text-sm text-slate-700">
                {item.comment || "No comment"}
              </p>

            </li>
          ))}

        </ul>
      )}

    </div>
  )
}