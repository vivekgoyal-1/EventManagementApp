# TEDx Feedback Platform

## 1. What You Built

This project is a real time feedback platform designed for a full day TEDx event.

Attendees can submit a star rating and comment for each session using a session specific access code shared by the Stage Manager. Once feedback starts coming in, Stage Managers can monitor their sessions through a live dashboard showing:

- average ratings
- total responses
- a feed of low rated comments
- a trend graph of feedback across the event

The Event Director dashboard shows event wide analytics including total feedback count, overall average rating, a leaderboard of top sessions, and alerts for sessions receiving 1 star feedback.

The director can also open any session to view its full rating distribution and comments. In addition, the system can generate an AI assisted PDF summary report for feedback collected on a given date.

Access control is handled at the Firestore rules level rather than just the UI. Stage Managers can only see their assigned sessions and cannot view other managers' data. Only attendees are allowed to submit feedback which prevents managers from manipulating ratings.

## 2. Schema Design

```text
users/{uid}
  role, email, displayName

sessions/{sessionId}
  title, managerId, managerEmail, managerName
  accessCode
  startedAt, isActive
  ratingSum, totalFeedback, avgRating

  feedback/{feedbackId}
    sessionId, userId, managerId
    rating, comment, accessCode, createdAt

  submittedBy/{userId}
    userId, submittedAt

feedback/{feedbackId}
  (mirror copy created by Cloud Function)

eventStats/global
  feedbackCount, ratingSum, avgRating, oneStarCount

managerDailyStats/{managerId}_{YYYY-MM-DD}
  managerId, date, feedbackReceived, ratingSum, averageRating
```

### Why this structure

Feedback documents are stored under the session path (`sessions/{id}/feedback`). This makes it easier to enforce security rules because a Stage Manager's access can be tied directly to the session path they own.

However, the Event Director needs to query feedback across all sessions when generating reports. Since Firestore cannot easily query multiple nested collections in one request, a Cloud Function mirrors feedback into a top level feedback collection specifically for reporting.

The session document also stores precomputed aggregates like `ratingSum`, `totalFeedback`, and `avgRating`. This allows dashboards to read just a single document instead of scanning all feedback entries.

### Alternative considered

An earlier design used a flat feedback collection with a `managerId` field. I decided against this because it makes rule based access control harder to enforce safely. Using the nested structure keeps the access boundary tied to the document path itself.

## 3. Architecture Decisions

### Aggregates

A Firestore trigger called `onFeedbackCreated` runs whenever new feedback is submitted. Inside a transaction it updates:

- session level aggregates
- event level stats
- daily manager statistics

This ensures that dashboards can read constant time aggregates without scanning feedback documents.

### Cloud Functions

Several Cloud Functions handle backend logic:

- `onFeedbackCreated`
  updates aggregates and mirrors feedback to the top level collection.

- `generateDayFeedbackReport`
  queries feedback by date and generates a structured summary using Gemini. If the API fails, a rule based fallback summary is used.

- `seedDummyData`
  creates demo users, sessions, and realistic feedback for testing.

- `deleteSessionCascade`
  deletes sessions and their feedback safely in batches.

- `setUserRole` and `listUsersForRoleManagement`
  used by the Event Director to manage roles.

### Access Control

Security rules enforce strict role isolation.

A helper function `isManagerOfSession(sessionId)` checks whether the current user is the manager assigned to that session. Managers can only read feedback belonging to sessions they manage.

The Event Director has a separate rule path that allows event wide reads.

No data isolation relies on UI checks alone.

## 4. Security Rules

Feedback documents live under:

`sessions/{sessionId}/feedback/{feedbackId}`

When a Stage Manager attempts to read feedback, the rule checks:

`sessions/{sessionId}.managerId == request.auth.uid`

Because the session ID comes from the document path, it cannot be forged in the request body.

Even if a manager somehow guesses another session ID, the rule will fetch that session document and deny access if the manager ID does not match.

### Additional safeguards

- Only attendees can create feedback
- Access code must match the session's stored code
- Each user can submit only once per session
- `submittedBy` documents are immutable once written

This prevents both duplicate submissions and data manipulation.

## 5. Custom Features

### Critical Feedback Feed

Stage Managers often have only a short gap between sessions. Instead of scanning all feedback, the dashboard highlights comments with ratings of 2 stars or lower.

A real time query listens for low rated feedback across the manager's sessions and shows the most critical issues first.

The implementation uses one listener per session. While not the most scalable design, it keeps the system simple and provides near instant updates for small session counts.

### Session Drill Down

Aggregate metrics alone do not explain why a session performed poorly.

Clicking any session opens a detail page that shows:

- rating distribution chart
- full comment list
- highlighted low rated feedback

Both Stage Managers and the Event Director can use this page to inspect sessions in detail.

For this prototype the page loads all feedback for the session. Pagination could be added if sessions receive very large response volumes.

### Session Access Codes

To ensure feedback comes from real attendees, each session has a short access code.

Attendees must enter this code when submitting feedback. The Firestore rule validates the submitted code against the stored session code.

Managers cannot create feedback entries because the rule explicitly restricts creation to attendees only.

A `submittedBy` collection records which users have submitted feedback for a session, ensuring one submission per user.

This approach is simple but effective for a physical event setting.

## 6. AI Usage

AI tools were used mainly as development assistance, not to design the entire system.

They were helpful for generating initial scaffolding such as React components, TypeScript interfaces, and Firebase setup code. However, most architecture and security decisions were revised manually after reviewing the generated suggestions.

For example, the first schema suggestion used a flat feedback collection. After thinking through Firestore rule limitations, I switched to the nested session structure to make access control easier to enforce.

Similarly, the initial security rules allowed Stage Managers to create feedback entries. I removed that permission because it could allow rating manipulation.

AI was also used to help draft some utility functions and UI components, but these were reviewed and adjusted during implementation.

The final system architecture, schema structure, and rule design were decided during development rather than being taken directly from generated output.

## 7. What I'd Improve With More Time

One improvement would be replacing the static session access code with a short lived signed token generated by a Cloud Function.

The current access code works well to prevent accidental cross session submissions, but it does not expire and could be shared after the session ends.

A token based system could enforce a submission window, such as allowing feedback only within 30 minutes after the session finishes.

This would make the feedback data more reliable and better tied to the actual event timeline.

## Local Setup

1. Install frontend dependencies:

```bash
npm install
```

2. Install Cloud Functions dependencies:

```bash
cd functions && npm install && cd ..
```

3. Copy and fill in environment variables:

```bash
cp .env.example .env
```

4. Run the frontend:

```bash
npm run dev
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase project API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firestore project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

The Gemini API key is stored as a Firebase Functions secret (`GEMINI_API_KEY`) set via `firebase functions:secrets:set GEMINI_API_KEY`. It is never in the `.env` file.

**Firebase services required:** Authentication (email/password + Google), Firestore, Cloud Functions (Node 22), Firebase Hosting.

## Demo Credentials

Seed via the "Seed Demo Data" button on the Director dashboard (or call `seedDummyData`).

Password for all demo accounts: `Pulse@123`

| Email | Role |
|---|---|
| `director@pulse.local` | Event Director |
| `manager1@pulse.local` | Stage Manager (Priya Sharma) |
| `manager2@pulse.local` | Stage Manager (James Okafor) |
| `attendee1@pulse.local` | Attendee |
| `attendee2@pulse.local` | Attendee |

Seeded sessions and their access codes:

| Session | Code |
|---|---|
| The Future of AI in Healthcare | `AH2025` |
| Rethinking Urban Mobility | `UM2025` |
| Ocean Conservation and Technology | `OC2025` |
| Mental Health in the Digital Age | `MH2025` |

## Routes

| Path | Role | Description |
|---|---|---|
| `/` | All | Login / register |
| `/home` | Attendee | Feedback submission form |
| `/manager` | Stage Manager | Live session dashboard |
| `/director` | Event Director | Event-wide analytics + report |
| `/director/sessions` | Event Director | Create / remove sessions |
| `/director/roles` | Event Director | Assign user roles |
| `/session/:id` | Manager / Director | Session drill-down detail |
