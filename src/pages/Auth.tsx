import { useState } from "react"
import { Navigate } from "react-router-dom"

import { useAuth } from "../hooks/useAuth"
import {
  registerWithEmailPassword,
  signInWithEmailPassword,
  signInWithGoogle,
} from "../services/authService"

type Mode = "login" | "register"

export default function AuthPage() {
  const { user } = useAuth()

  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user) {
    if (user.role === "eventDirector") return <Navigate to="/director" replace />
    if (user.role === "stageManager") return <Navigate to="/manager" replace />
    return <Navigate to="/home" replace />
  }

  async function handleEmailAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError("Email and password are required")
      return
    }

    setSubmitting(true)

    try {
      if (mode === "login") {
        await signInWithEmailPassword(email.trim(), password)
      } else {
        await registerWithEmailPassword(email.trim(), password)
      }
    } catch (err) {
      console.error(err)
      setError(
        mode === "login"
          ? "Login failed. Check your credentials."
          : "Registration failed"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="rounded-lg bg-indigo-500 px-4 py-3 text-center text-xl font-bold uppercase tracking-wider text-white">
        Event Management Application
      </h1>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">

        <h2 className="text-2xl font-semibold text-slate-900 text-center">
          {mode === "login" ? "Sign in" : "Create account"}
        </h2>

        <p className="mt-2 text-sm text-slate-600 text-center">
          Use Google or email and password
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode("login")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "login"
              ? "bg-indigo-500 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          Login
        </button>

        <button
          onClick={() => setMode("register")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "register"
              ? "bg-indigo-500 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          Register
        </button>
        </div>

        <form onSubmit={handleEmailAuth} className="mt-5 space-y-4">

        <div>
          <label className="text-xs uppercase tracking-wider text-slate-500">
            Email
          </label>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-slate-500">
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
        >
          {submitting
            ? "Please wait..."
            : mode === "login"
            ? "Login with Email"
            : "Register with Email"}
        </button>
        </form>

        <div className="my-5 h-px bg-slate-200" />

        <button
          onClick={signInWithGoogle}
          className="w-full rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-cyan-400"
        >
          Continue with Google
        </button>
      </div>
    </section>
  )
}