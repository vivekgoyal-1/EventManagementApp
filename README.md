# TEDx Feedback Platform

Firebase + React + TypeScript implementation for the assignment.

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Firebase Cloud Functions (TypeScript)
- Database: Firestore (real-time listeners + aggregated stats)
- Auth: Firebase Authentication (Google)

## Local Setup

1. Install frontend dependencies:

```bash
npm install
```

2. Install Cloud Functions dependencies:

```bash
cd functions
npm install
cd ..
```

3. Run frontend:

```bash
npm run dev
```

4. Build frontend:

```bash
npm run build
```

5. Build Cloud Functions:

```bash
cd functions
npm run build
```

## Environment Variables

1. Create a local env file from the example:

```bash
cp .env.example .env
```

2. Fill in the Firebase values in `.env`.

The app reads these Vite variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## Demo Credentials (Seed Data)

These accounts are created by the Cloud Function `seedDummyData` in [functions/src/index.ts](functions/src/index.ts).

- Password for all demo users: `Pulse@123`
- Event Director:
  - `director@pulse.local`
- Stage Managers:
  - `manager1@pulse.local`
  - `manager2@pulse.local`
- Attendees:
  - `attendee1@pulse.local`
  - `attendee2@pulse.local`

Use these only for local/demo testing, not for production.

## Routes

- `/` -> Login page
- `/home` -> Feedback form / base home
- `/manager` -> Stage Manager dashboard
- `/director` -> Event Director dashboard

## Requirement Coverage

### 1) Feedback Form

Implemented in [src/components/FeedbackForm.tsx](src/components/FeedbackForm.tsx).

- Rating 1-5
- Comment input
- Session picker
- Writes feedback under: `sessions/{sessionId}/feedback/{feedbackId}`
- Includes `managerId`, `sessionTitle`, `userId` to support fast aggregated and reporting workflows

### 2) Stage Manager Dashboard

Implemented in [src/pages/ManagerDashboard.tsx](src/pages/ManagerDashboard.tsx).

- Reads sessions assigned to signed-in manager (`where("managerId", "==", user.uid)`)
- Shows live response count and live average rating
- Highlights sessions with `avgRating < 3`
- Uses Firestore real-time listeners (`onSnapshot`)

### 3) Event Director Dashboard

Implemented in [src/pages/EventDirectorDashboard.tsx](src/pages/EventDirectorDashboard.tsx).

- Total responses from `eventStats/global.feedbackCount`
- Overall average from `eventStats/global.avgRating`
- Top 5 sessions from aggregated `sessions.avgRating` (no feedback scan)
- Live one-star count from `eventStats/global.oneStarCount`
- Live alert when one-star count increases
- Uses real-time listeners, with aggregated data strategy so read cost does not grow with feedback volume

### 4) Daily Average Graph (365 days)

Implemented in [src/pages/ManagerDashboard.tsx](src/pages/ManagerDashboard.tsx).

- Reads manager aggregates from `managerDailyStats`
- Queries last 365 rows (`orderBy("date", "desc"), limit(365)`)
- Renders chart as SVG polyline

### 5) Day Feedback Report + AI Summary

Backend callable in [functions/src/index.ts](functions/src/index.ts): `generateDayFeedbackReport`.
Frontend UI in [src/pages/EventDirectorDashboard.tsx](src/pages/EventDirectorDashboard.tsx).

- Director chooses a date
- Function queries top-level `feedback` mirror collection for that date range
- Returns all comments and ratings
- Produces AI summary:
  - What went well
  - What did not go well
  - One actionable recommendation
- Report can be downloaded as `.txt`

### 6) Firestore Security Rules

Implemented in [firestore.rules](firestore.rules).

#### Stage Manager restriction (how it is enforced)

The key control is path-scoped ownership checking:

- Feedback docs are nested under session path: `sessions/{sessionId}/feedback/{feedbackId}`
- Rule helper `isManagerOfSession(sessionId)` checks:
  - requester role is `stageManager`
  - `sessions/{sessionId}.managerId == request.auth.uid`
- Any read/write to feedback by stage managers requires this function, so manager access is locked to only their own assigned sessions.

For the top-level mirror `feedback/{feedbackId}` used by reporting, read access is also constrained:

- Event Director can read all mirrored feedback
- Stage Manager can read mirrored feedback only if:
  - `feedback.managerId == request.auth.uid`, and
  - `isManagerOfSession(feedback.sessionId)` is true
- Client writes to mirrored feedback are denied (`allow write: if false`) so only Cloud Functions can maintain it

Because authorization is derived from the session document tied to the path parameter, a Stage Manager cannot read or write another manager's session feedback even if they know document IDs.

#### Other rule guarantees

- Attendees can create feedback but cannot read or edit feedback
- Event Director can read all sessions/feedback but cannot write feedback
- No unauthenticated read/write access anywhere
- Aggregate collections are read-only to clients (`eventStats`, `managerDailyStats`)

### 7) Additional Features (3)

#### Feature A: Critical Feedback Feed (Stage Manager)

- Implemented in [src/pages/ManagerDashboard.tsx](src/pages/ManagerDashboard.tsx)
- Problem: Managers need fast visibility into the worst comments between sessions.
- Audience: Stage Manager
- Tradeoff: Uses multiple listeners (up to 4 session subcollections) for speed and clarity over a more complex server-side fan-out.

#### Feature B: At-risk Sessions Panel (Event Director)

- Implemented in [src/pages/EventDirectorDashboard.tsx](src/pages/EventDirectorDashboard.tsx)
- Problem: Director needs immediate awareness of weak sessions without scanning full tables.
- Audience: Event Director
- Tradeoff: Uses `avgRating < 3` aggregated threshold, which is simple but less nuanced than trend-based anomaly detection.

#### Feature C: Live 1-star Alert Toast

- Implemented in [src/pages/EventDirectorDashboard.tsx](src/pages/EventDirectorDashboard.tsx)
- Problem: Director cannot stare at the dashboard constantly.
- Audience: Event Director
- Tradeoff: In-app alert only (no external push/SMS) to keep scope small and deployable quickly.

## Cloud Functions

Implemented in [functions/src/index.ts](functions/src/index.ts):

- `onFeedbackCreated`
  - Trigger: `sessions/{sessionId}/feedback/{feedbackId}` create
  - Uses Firestore transaction to update:
    - Session aggregates (`ratingSum`, `totalFeedback`, `avgRating`)
    - Global event aggregates (`feedbackCount`, `ratingSum`, `avgRating`, `oneStarCount`)
    - Manager daily aggregates (`managerDailyStats/{managerId}_{YYYY-MM-DD}`)

- `generateDayFeedbackReport` (callable)
  - Event Director only
  - Date-based report generation with summary and row data

## Data Notes

Expected user role document:

- `users/{uid}` includes `role` with one of:
  - `attendee`
  - `stageManager`
  - `eventDirector`

## AI Usage Note

AI tooling was used for implementation acceleration, scaffolding, and iterative refactoring. Final architecture and security constraints were validated manually against assignment requirements.

// location of functions 
// all read before write
// cloud configuration 
