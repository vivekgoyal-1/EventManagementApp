import FeedbackForm from "../components/FeedbackForm"
import { useAuth } from "../hooks/useAuth"

export default function HomePage() {
  const { user } = useAuth()

  return (
    <div className="max-w mx-auto space-y-6">

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-ted mb-1">
          Attendee
        </p>
        <h1 className="text-2xl font-black text-zinc-900">Submit Feedback</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Signed in as {user?.displayName || user?.email}
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-100 bg-white shadow-sm p-6">

        <div className="mb-5 rounded-xl bg-zinc-50 border border-zinc-100 px-4 py-3">
          <p className="text-sm text-zinc-600">
            Select your session, enter the access code from your Stage Manager, rate the talk, and leave a comment.
          </p>
        </div>

        <FeedbackForm />

      </div>

    </div>
  )
}
