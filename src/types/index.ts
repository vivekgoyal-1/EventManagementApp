export type UserRole = "attendee" | "stageManager" | "eventDirector"

export interface UserProfile {
  uid: string
  email: string
  displayName?: string
  photoURL?: string
  role?: UserRole
  createdAt?: Date
}

export interface Session {
  id: string

  title: string

  ownerId?: string

  managerId?: string
  managerEmail?: string
  managerName?: string

  startedAt?: Date
  endedAt?: Date

  isActive?: boolean
  createdAt?: Date

  ratingSum?: number
  totalFeedback?: number
  avgRating?: number

  accessCode?: string

  metadata?: Record<string, unknown>
  participants?: string[]
}

export interface Feedback {
  id: string

  sessionId: string
  sessionTitle?: string

  managerId?: string
  userId?: string

  rating: number
  comment: string

  createdAt?: Date
  updatedAt?: Date
}

export interface EventStats {
  id: string

  feedbackCount: number
  ratingSum: number
  avgRating: number

  oneStarCount: number

  lastUpdatedAt?: Date
}

export interface ManagerDailyStats {
  id: string

  managerId: string
  date: string

  sessionsHosted: number
  feedbackReceived: number
  averageRating: number

  updatedAt?: Date
}

export interface SessionSummary {
  id: string

  date: string
  summaryText: string

  createdAt?: Date
}

export interface DayReportSummary {
  wentWell: string
  didntGoWell: string
  recommendation: string
}

export interface FirestoreDoc {
  id: string
  [key: string]: unknown
}