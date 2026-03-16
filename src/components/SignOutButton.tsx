import { useState } from "react"
import { signOutUser } from "../services/authService"

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    try {
      await signOutUser()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className={
        compact
          ? "text-xs text-zinc-500 hover:text-white transition-colors disabled:opacity-50"
          : "w-full rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
      }
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  )
}
