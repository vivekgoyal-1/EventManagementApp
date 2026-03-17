export function StatCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string
  value: string | number
  sub?: string
  highlight?: boolean
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
