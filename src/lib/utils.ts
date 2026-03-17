import type { UserProfile } from "../types"

/** Initials from displayName or email (max 2 chars) */
export function getInitials(user: Pick<UserProfile, "displayName" | "email"> | null | undefined): string {
  return (user?.displayName || user?.email || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

/** Safely convert a Firestore Timestamp or Date-like value to a JS Date */
export function toDate(value: unknown): Date | null {
  if (!value) return null
  if (typeof (value as any).toDate === "function") return (value as any).toDate()
  if (value instanceof Date) return value
  return null
}
