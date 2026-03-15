import { SignOutButton } from "../components/SignOutButton"
import FeedbackForm from "../components/FeedbackForm"
import { useAuth } from "../hooks/useAuth"

export default function HomePage() {
  const { user } = useAuth()

  return (
    <section className="space-y-6">

      <div className="flex items-start justify-between">

        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Feedback
          </h2>

          <p className="text-sm text-slate-600">
            Submit your session feedback here
          </p>

          <p className="text-sm text-slate-500 mt-1">
            Signed in as: {user?.displayName || user?.email}
          </p>
        </div>

        <SignOutButton />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-slate-600">
          Choose your session, rate it, and submit your feedback.
        </p>
      </div>

      <FeedbackForm />

    </section>
  )
}