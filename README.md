# TEDx Feedback Platform

## 1. What You Built

A real-time feedback platform for a full-day TEDx event. Attendees submit a star rating and comment for each session using a session-specific access code given to them by their Stage Manager. Each Stage Manager sees a live dashboard of their four sessions — average ratings, response counts, a critical feedback feed for low-rated comments, and a 365-day trend graph. The Event Director sees event-wide aggregates (total responses, overall average, top-5 leaderboard, at-risk sessions, and a 1-star alert), can drill into any individual session for a full rating distribution and comment list, and can generate an AI-powered PDF report for any date. Access control is enforced at the Firestore rules layer, not just the UI: managers are locked to their own sessions, and only attendees (not managers) can submit feedback, preventing falsification.

## 2. Schema Design

```
users/{uid}
  role, email, displayName

sessions/{sessionId}
  title, managerId, managerEmail, managerName
  accessCode          ← shared with attendees to gate submissions
  startedAt, isActive
  ratingSum, totalFeedback, avgRating   ← pre-computed aggregates

  feedback/{feedbackId}
    sessionId, userId, managerId
    rating, comment, accessCode, createdAt

  submittedBy/{userId}
    userId, submittedAt   ← one doc per user; proves they submitted

feedback/{feedbackId}          ← top-level mirror, Cloud Function only
  (same fields as subcollection feedback)

eventStats/global
  feedbackCount, ratingSum, avgRating, oneStarCount

managerDailyStats/{managerId}_{YYYY-MM-DD}
  managerId, date, feedbackReceived, ratingSum, averageRating
```

**Why this structure:**
Feedback is nested under sessions (`sessions/{id}/feedback`) so Firestore rules can scope a Stage Manager's read access to the path of their own session. A top-level `feedback` mirror is maintained by Cloud Functions for the Event Director's cross-session report query — querying across all session subcollections from the client is not possible in a single Firestore request. The session document stores pre-computed aggregates (`ratingSum`, `totalFeedback`, `avgRating`) so the Director's leaderboard and the Manager's dashboard read a single document per session rather than scanning every feedback document. Global stats are rolled into `eventStats/global` for the same reason — one document read regardless of feedback volume.

**Alternative considered:** A flat `feedback` collection for everything. Rejected because it would require every Stage Manager query to filter by `managerId`, and Firestore cannot enforce "you can only query your own manager ID" purely at the rules layer without the nested path trick. The nested structure makes the path itself the access control boundary.

## 3. Architecture Decisions

**Aggregates:**
`onFeedbackCreated` (Firestore trigger) runs a single transaction that increments `sessions/{id}.ratingSum/totalFeedback/avgRating`, `eventStats/global`, and `managerDailyStats/{managerId}_{date}` atomically. This keeps read costs constant: the Director's dashboard always reads exactly three Firestore documents regardless of how many feedback entries exist.

**Cloud Functions:**
- `onFeedbackCreated` — trigger; handles all aggregation and mirrors feedback to the top-level collection. Also writes `submittedBy/{uid}` to record the submission.
- `generateDayFeedbackReport` — callable; queries the mirror collection by date range, sends comments to Gemini 2.5 Flash, returns structured JSON summary with fallback to rule-based logic if the API is unavailable.
- `seedDummyData` — callable; creates 4 realistic sessions (2 per manager, spread across 4 days) with 25 feedback entries each, timestamped on their respective session days so the date-range report query returns meaningful results.
- `deleteSessionCascade` — callable; deletes session subcollection feedback in batches of 250 to avoid Firestore write limits.
- `setUserRole` / `listUsersForRoleManagement` — callables for the Director's role management UI.

**Access control:**
Firestore rules enforce isolation at the database level. The `isManagerOfSession(sessionId)` helper reads `sessions/{sessionId}.managerId` and compares it to `request.auth.uid`. This is called on every feedback read/write for managers. The Event Director reads through a separate rule branch that does not call that helper. No UI-only guard is trusted for data isolation.

## 4. Security Rules

The Stage Manager restriction works as follows:

Feedback documents live at `sessions/{sessionId}/feedback/{feedbackId}`. The Firestore rule for reading feedback by a Stage Manager calls `isManagerOfSession(sessionId)`, which does a live `get()` on `sessions/{sessionId}` and checks that `data.managerId == request.auth.uid`. The `sessionId` comes from the document path, not from the request body — a manager cannot forge it. Because the check is tied to the path parameter, a Stage Manager who knows another session's document ID still cannot read or write that session's feedback: the rule will fetch the session doc, compare `managerId` to their UID, and deny access.

The same helper guards the top-level `feedback` mirror: a Stage Manager can read a mirrored document only if `feedback.managerId == request.auth.uid` AND `isManagerOfSession(feedback.sessionId)` both pass. This double-check prevents a manager from querying the mirror collection with a forged `managerId` field.

**Additional rule guarantees added in this version:**
- Feedback `create` requires `isAttendee()` — managers are explicitly excluded, so they cannot falsify data even if they know the session ID and access code.
- Feedback `create` checks `request.resource.data.accessCode == get(session).data.accessCode` — only attendees with the code shared by the manager can submit.
- Feedback `create` checks `!exists(sessions/{id}/submittedBy/{uid})` — enforces one submission per user per session at the database level.
- `submittedBy` documents are immutable once created (no `update` or `delete`) so a user cannot delete their marker to re-enable submission.

## 5. Your Own Features

### Feature A: Critical Feedback Feed (Stage Manager)

**Problem:** After a session ends a manager has 20 minutes before the next one starts. They need to know immediately if something went badly wrong — not by scrolling through 25 comments, but by seeing the worst ones first.

**Who it's for:** Stage Manager.

**How it works:** A real-time listener queries `sessions/{id}/feedback` with `rating <= 2` for each of the manager's sessions. Results are merged, sorted by rating ascending, and shown in a dedicated panel on the manager dashboard.

**Tradeoff:** Up to 4 parallel Firestore listeners (one per session). A single server-side fan-out query would be cleaner at scale, but the per-session listener approach avoids a Cloud Function call and gives sub-second latency for a small session count.

### Feature B: Session Drill-Down (Both roles)

**Problem:** The dashboard shows aggregate numbers but gives no way to investigate *why* a session is underperforming. An Event Director who sees a 2.4 average needs to read the actual comments to understand the problem.

**Who it's for:** Stage Manager (own sessions) and Event Director (all sessions).

**How it works:** Every session row in both dashboards links to `/session/:id`. The detail page shows a real-time rating distribution bar chart (1★–5★ with percentage fills) and a live-updating list of all feedback, sorted newest first, with low-rated items highlighted in red.

**Tradeoff:** The feedback list loads all documents for the session in one listener — fine for 25–100 responses, but would need pagination for very large sessions. Accepted this tradeoff to keep the implementation simple for a one-day event format.

### Feature C: Session Access Codes (Attendee verification + anti-falsification)

**Problem:** Two problems the original build did not address: (1) nothing stopped an attendee from submitting feedback for a session they did not attend; (2) nothing stopped a manager from submitting fake feedback to inflate their scores.

**Who it's for:** Stage Manager (distributes the code), Attendee (enters it), Event Director (protected by the rules).

**How it works:** Each session is assigned a short alphanumeric access code (`accessCode` field) when created. The manager sees the code on their dashboard and can copy a pre-filled feedback link to share with attendees. The Firestore rule for feedback creation validates the submitted code against the stored session code. Managers are excluded from the feedback `create` rule entirely, so they cannot submit feedback through any client. A `submittedBy/{uid}` subcollection tracks who has submitted; the rule checks `!exists()` before allowing a new entry, enforcing one submission per user per session at the database level.

**Tradeoff:** The access code is a shared secret — anyone with the link can submit. A proper solution would use signed short-lived tokens. Accepted this tradeoff because token generation requires an additional Cloud Function and the code approach is sufficient to prevent casual cross-session or duplicate submissions at a physical event.

## 6. AI Usage

Claude (Sonnet) was used throughout this project as a coding assistant. Here is an honest account of where it helped and where it fell short:

**Schema design:** The initial AI suggestion was a flat `feedback` collection with a `managerId` field. I rejected this because Firestore rules cannot enforce "you can only query where managerId == your uid" without also allowing any manager to attempt the query and be denied only at read time — which still exposes document IDs. The nested `sessions/{id}/feedback` structure ties access to the document path, which Firestore rules can enforce cleanly. I made this decision and rewrote the schema.

**Firestore rules:** AI generated a first draft that allowed Stage Managers to create feedback for their assigned sessions. This is a falsification risk — a manager could submit fake 5-star ratings. I removed `isManagerOfSession` from the feedback `create` rule and restricted creation to `isAttendee()` only.

**Seed data:** The initial seed data used generic placeholder comments ("Seed comment 1 for Session X") which produce meaningless AI summaries. I replaced all 100 comments with realistic TED-style feedback, varying by session topic, rating tier, and specificity, so the Gemini summary has something worth analysing.

**`buildSummary` fallback:** AI generated a fallback function with a literal debug string ` this is coded` prepended to the `wentWell` field. I caught and removed this.

**`onFeedbackCreated` trigger:** The original Cloud Function did not update `managerDailyStats` in real time — daily stats were only seeded, never updated from live submissions. I added the daily stats update inside the existing transaction.

**General scaffolding:** React component structure, Tailwind class selection, TypeScript interfaces, and Firebase SDK boilerplate were largely AI-generated and used with minor adjustments.

## 7. What You'd Do With More Time

Replace the shared access code with a signed, short-lived session token generated by a Cloud Function and embedded in a QR code displayed by the Stage Manager. The current code is a static string tied to the session — it never expires and can be forwarded. A token approach would let the Director set a submission window (e.g., 30 minutes after session end) after which the link stops working, making the feedback data more trustworthy and time-anchored. This would require one new callable function and a change to the Firestore rule, but would significantly strengthen the anti-fraud guarantee that the `submittedBy` collection currently provides only for duplicates, not for late or out-of-session submissions.

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
