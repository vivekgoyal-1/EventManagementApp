export function RatingBadge({ avg, count }: { avg: number; count: number }) {
  if (count === 0) return <span className="text-xs text-zinc-400">—</span>

  const color =
    avg < 3
      ? "text-red-700 bg-red-100"
      : avg >= 4
      ? "text-green-700 bg-green-100"
      : "text-amber-700 bg-amber-100"

  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${color}`}>
      {avg.toFixed(2)} ★
    </span>
  )
}
