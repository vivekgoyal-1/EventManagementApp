import * as admin from "firebase-admin";
import { user } from "firebase-functions/v1/auth";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();

const db = admin.firestore();
const REGION = "asia-south2";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

type UserRole = "attendee" | "stageManager" | "eventDirector";

async function requireEventDirector(uid: string): Promise<void> {
  const userDoc = await db.collection("users").doc(uid).get();
  const role = userDoc.exists ? userDoc.data()?.role : null;

  if (role !== "eventDirector") {
    throw new HttpsError("permission-denied", "Only event directors can perform this action.");
  }
}

export const handleUserCreated = user().onCreate(async (userRecord) => {

  const userRef = db.collection("users").doc(userRecord.uid);
  const email = (userRecord.email ?? "").toLowerCase();

  const pendingSessions = await db
    .collection("sessions")
    .where("managerEmail", "==", email)
    .where("managerId", "==", null)
    .get();

  const role = pendingSessions.empty ? "attendee" : "stageManager";

  const batch = db.batch();

  batch.set(userRef, {
    email: userRecord.email ?? "",
    displayName: userRecord.displayName ?? "",
    role,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (!pendingSessions.empty) {
    pendingSessions.docs.forEach((sessionDoc) => {
      batch.update(sessionDoc.ref, {
        managerId: userRecord.uid,
        managerName: userRecord.displayName ?? userRecord.email ?? "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }

  await batch.commit();

  logger.info("Created user with role", role, userRecord.uid);
});

export const onSessionCreated = onDocumentCreated(
  {
    document: "sessions/{sessionId}",
    region: REGION,
  },
  async (event) => {

    const snapshot = event.data;
    const sessionId = event.params.sessionId;

    if (!snapshot) return;

    const session = snapshot.data();
    const managerEmail = String(session.managerEmail ?? "").trim().toLowerCase();
    const managerId = session.managerId ?? null;

    if (!managerEmail || managerId) return;

    const users = await db.collection("users").where("email", "==", managerEmail).limit(1).get();

    if (users.empty) return;

    const managerDoc = users.docs[0];
    const managerData = managerDoc.data() ?? {};

    const batch = db.batch();

    batch.update(snapshot.ref, {
      managerId: managerDoc.id,
      managerName: managerData.displayName ?? managerData.email ?? managerDoc.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if ((managerData.role ?? "attendee") !== "eventDirector") {
      batch.set(
        managerDoc.ref,
        {
          role: "stageManager",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    await batch.commit();

    logger.info("Linked existing user to session", sessionId);
  },
);

export const onFeedbackCreated = onDocumentCreated(
  {
    document: "sessions/{sessionId}/feedback/{feedbackId}",
    region: REGION,
  },
  async (event) => {

    const snapshot = event.data;
    const sessionId = event.params.sessionId;
    const feedbackId = event.params.feedbackId;

    if (!snapshot) return;

    const feedback = snapshot.data();
    if (!feedback) return;

    await db.collection("feedback").doc(feedbackId).set({
      sessionId,
      sessionTitle: String(feedback.sessionTitle ?? "Untitled"),
      managerId: feedback.managerId ?? null,
      userId: feedback.userId ?? null,
      rating: Number(feedback.rating ?? 0),
      comment: String(feedback.comment ?? ""),
      createdAt: feedback.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
    });

    if (feedback.skipAggregation === true) return;

    const rating = Number(feedback.rating ?? 0);
    const managerId = String(feedback.managerId ?? "");
    const userId = String(feedback.userId ?? "");

    const sessionRef = db.collection("sessions").doc(sessionId);
    const statsRef = db.collection("eventStats").doc("global");

    const now = new Date();
    const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const dailyRef = managerId
      ? db.collection("managerDailyStats").doc(`${managerId}_${dateStr}`)
      : null;

    await db.runTransaction(async (tx) => {

      const sessionDoc = await tx.get(sessionRef);
      const statsDoc = await tx.get(statsRef);

      const prevRatingSum = Number(sessionDoc.data()?.ratingSum ?? 0);
      const prevTotal = Number(sessionDoc.data()?.totalFeedback ?? 0);

      const nextSum = prevRatingSum + rating;
      const nextTotal = prevTotal + 1;

      tx.update(sessionRef, {
        ratingSum: nextSum,
        totalFeedback: nextTotal,
        avgRating: Number((nextSum / nextTotal).toFixed(2)),
      });

      const prevGlobalSum = Number(statsDoc.data()?.ratingSum ?? 0);
      const prevGlobalCount = Number(statsDoc.data()?.feedbackCount ?? 0);

      const newCount = prevGlobalCount + 1;
      const newSum = prevGlobalSum + rating;

      tx.set(
        statsRef,
        {
          feedbackCount: newCount,
          ratingSum: newSum,
          avgRating: Number((newSum / newCount).toFixed(2)),
          oneStarCount: Number(statsDoc.data()?.oneStarCount ?? 0) + (rating === 1 ? 1 : 0),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (dailyRef) {
        const dailyDoc = await tx.get(dailyRef);
        const prevDailySum = Number(dailyDoc.data()?.ratingSum ?? 0);
        const prevDailyCount = Number(dailyDoc.data()?.feedbackReceived ?? 0);
        const newDailyCount = prevDailyCount + 1;
        const newDailySum = prevDailySum + rating;

        tx.set(
          dailyRef,
          {
            managerId,
            date: dateStr,
            sessionsHosted: dailyDoc.data()?.sessionsHosted ?? 1,
            feedbackReceived: newDailyCount,
            ratingSum: newDailySum,
            averageRating: Number((newDailySum / newDailyCount).toFixed(2)),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    });

    if (userId) {
      await db
        .collection("sessions")
        .doc(sessionId)
        .collection("submittedBy")
        .doc(userId)
        .set({ userId, submittedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    logger.info("Updated aggregates for session", sessionId);
  },
);

/* ---------- Rule Based Fallback Summary ---------- */

function buildSummary(comments: string[], ratings: number[]) {

  const positive = ratings.filter((r) => r >= 4).length;
  const low = ratings.filter((r) => r <= 2).length;
  const total = Math.max(ratings.length, 1);

  return {
    wentWell:
      positive / total >= 0.6
        ? "Audience sentiment was mostly positive."
        : "Audience feedback was mixed.",

    didntGoWell:
      low > 0
        ? `There were ${low} low-rating responses.`
        : "Very few low ratings were recorded.",

    recommendation:
      low > positive / 2
        ? "Investigate the lowest rated sessions."
        : "Replicate the format of the highest rated sessions.",
  };
}

/* ---------- AI Summary ---------- */

async function buildAISummary(
  comments: string[],
  ratings: number[],
  apiKey: string,
) {

  const fallback = buildSummary(comments, ratings);

  if (!apiKey) {
    logger.warn("Gemini summary skipped because GEMINI_API_KEY is missing.");
    return fallback;
  }

  if (comments.length === 0 && ratings.length === 0) {
    logger.info("Gemini summary skipped because there is no feedback data for the selected day.");
    return fallback;
  }

  try {

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
You are an event analytics expert.

Analyze the following attendee feedback.

Ratings:
${ratings.join(", ")}

Comments:
${comments.slice(0, 40).map((c, i) => `Comment ${i + 1}: ${c}`).join("\n")}

Return ONLY JSON:

{
 "wentWell": "...",
 "didntGoWell": "...",
 "recommendation": "..."
}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const clean = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const jsonText = clean.match(/\{[\s\S]*\}/)?.[0] ?? clean;
    const parsed = JSON.parse(jsonText) as {
      wentWell?: unknown;
      didntGoWell?: unknown;
      recommendation?: unknown;
    };

    return {
      wentWell: String(parsed.wentWell ?? fallback.wentWell),
      didntGoWell: String(parsed.didntGoWell ?? fallback.didntGoWell),
      recommendation: String(parsed.recommendation ?? fallback.recommendation),
      sampleComments: comments.slice(0, 5),
    };

  } catch (err) {

    logger.warn("Gemini summary failed, using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

export const generateDayFeedbackReport = onCall(
  {
    region: REGION,
    secrets: [GEMINI_API_KEY],
  },
  async (request) => {

    const auth = request.auth;
    const data = request.data as { date?: string };

    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    await requireEventDirector(auth.uid);

    const date = String(data?.date ?? "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError("invalid-argument", "Date must be YYYY-MM-DD.");
    }

    const start = admin.firestore.Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
    const end = admin.firestore.Timestamp.fromDate(new Date(`${date}T23:59:59Z`));

    const feedbackSnapshot = await db
      .collection("feedback")
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .get();

    const feedbackItems: any[] = [];

    feedbackSnapshot.docs.forEach((doc) => {

      const row = doc.data();

      feedbackItems.push({
        id: doc.id,
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle ?? "Untitled",
        rating: Number(row.rating ?? 0),
        comment: String(row.comment ?? ""),
      });
    });

    const comments = feedbackItems.map((i) => i.comment).filter(Boolean);
    const ratings = feedbackItems.map((i) => i.rating);

    const summary = await buildAISummary(
      comments,
      ratings,
      GEMINI_API_KEY.value(),
    );

    return {
      date,
      totalFeedback: feedbackItems.length,
      summary,
      feedback: feedbackItems,
    };
  },
);

export const listUsersForRoleManagement = onCall({ region: REGION }, async (request) => {
  const auth = request.auth;
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  await requireEventDirector(auth.uid);

  const snapshot = await db.collection("users").limit(200).get();
  return {
    users: snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        email: String(data.email ?? ""),
        displayName: String(data.displayName ?? ""),
        role: (data.role as UserRole | undefined) ?? "attendee",
      };
    }),
  };
});

export const setUserRole = onCall({ region: REGION }, async (request) => {
  const auth = request.auth;
  const data = request.data as { uid?: string; role?: UserRole };

  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  await requireEventDirector(auth.uid);

  const targetUid = String(data?.uid ?? "").trim();
  const targetRole = data?.role;

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  if (!["attendee", "stageManager", "eventDirector"].includes(String(targetRole))) {
    throw new HttpsError("invalid-argument", "invalid role.");
  }

  await db.collection("users").doc(targetUid).set(
    {
      role: targetRole,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
});

export const deleteSessionCascade = onCall({ region: REGION }, async (request) => {
  const auth = request.auth;
  const data = request.data as { sessionId?: string };

  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  await requireEventDirector(auth.uid);

  const sessionId = String(data?.sessionId ?? "").trim();
  if (!sessionId) {
    throw new HttpsError("invalid-argument", "sessionId is required.");
  }

  const sessionRef = db.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "Session not found.");
  }

  const sessionData = sessionSnap.data() ?? {};
  const fallbackManagerId = String(sessionData.managerId ?? "");
  const fallbackSessionDate = (() => {
    const startedAt = sessionData.startedAt as admin.firestore.Timestamp | undefined;
    if (!startedAt?.toDate) return null;
    return startedAt.toDate().toISOString().slice(0, 10);
  })();

  let deletedFeedbackCount = 0;
  let deletedRatingSum = 0;
  let deletedOneStarCount = 0;
  const dailyDeltas = new Map<string, { managerId: string; date: string; count: number; ratingSum: number }>();

  // Delete feedback docs in batches to avoid recursive orphan data.
  while (true) {
    const feedbackSnap = await sessionRef.collection("feedback").limit(250).get();
    if (feedbackSnap.empty) {
      break;
    }

    const batch = db.batch();
    feedbackSnap.docs.forEach((docSnap) => {
      const row = docSnap.data() ?? {};
      const rating = Number(row.rating ?? 0);
      const managerId = String(row.managerId ?? fallbackManagerId);
      const createdAt = row.createdAt as admin.firestore.Timestamp | undefined;
      const date = createdAt?.toDate
        ? createdAt.toDate().toISOString().slice(0, 10)
        : fallbackSessionDate;

      deletedFeedbackCount += 1;
      deletedRatingSum += rating;
      if (rating === 1) deletedOneStarCount += 1;

      if (managerId && date) {
        const key = `${managerId}_${date}`;
        const prev = dailyDeltas.get(key) ?? { managerId, date, count: 0, ratingSum: 0 };
        prev.count += 1;
        prev.ratingSum += rating;
        dailyDeltas.set(key, prev);
      }

      batch.delete(docSnap.ref);
      batch.delete(db.collection("feedback").doc(docSnap.id));
    });
    await batch.commit();
  }

  // Cleanup one-submission markers for this session.
  while (true) {
    const submittedSnap = await sessionRef.collection("submittedBy").limit(250).get();
    if (submittedSnap.empty) {
      break;
    }

    const batch = db.batch();
    submittedSnap.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
  }

  await sessionRef.delete();

  // Keep aggregate dashboards consistent after deletion.
  if (deletedFeedbackCount > 0) {
    const statsRef = db.collection("eventStats").doc("global");
    await db.runTransaction(async (tx) => {
      const statsDoc = await tx.get(statsRef);
      const prevGlobalCount = Number(statsDoc.data()?.feedbackCount ?? 0);
      const prevGlobalSum = Number(statsDoc.data()?.ratingSum ?? 0);
      const prevOneStar = Number(statsDoc.data()?.oneStarCount ?? 0);

      const nextCount = Math.max(0, prevGlobalCount - deletedFeedbackCount);
      const nextSum = Math.max(0, prevGlobalSum - deletedRatingSum);
      const nextOneStar = Math.max(0, prevOneStar - deletedOneStarCount);

      tx.set(
        statsRef,
        {
          feedbackCount: nextCount,
          ratingSum: nextSum,
          avgRating: nextCount > 0 ? Number((nextSum / nextCount).toFixed(2)) : 0,
          oneStarCount: nextOneStar,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      for (const delta of dailyDeltas.values()) {
        const dailyRef = db.collection("managerDailyStats").doc(`${delta.managerId}_${delta.date}`);
        const dailyDoc = await tx.get(dailyRef);
        if (!dailyDoc.exists) continue;

        const prevCount = Number(dailyDoc.data()?.feedbackReceived ?? 0);
        const prevSum = Number(dailyDoc.data()?.ratingSum ?? 0);

        const nextCountDaily = Math.max(0, prevCount - delta.count);
        const nextSumDaily = Math.max(0, prevSum - delta.ratingSum);

        if (nextCountDaily === 0) {
          tx.delete(dailyRef);
        } else {
          tx.set(
            dailyRef,
            {
              feedbackReceived: nextCountDaily,
              ratingSum: nextSumDaily,
              averageRating: Number((nextSumDaily / nextCountDaily).toFixed(2)),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
    });
  }

  return { ok: true, deletedSessionId: sessionId };
});


export const seedDummyData = onCall({ region: REGION }, async (request) => {
  const auth = request.auth;
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const callerDoc = await db.collection("users").doc(auth.uid).get();
  const callerRole = callerDoc.exists ? callerDoc.data()?.role : null;
  const directorCheck = await db.collection("users").where("role", "==", "eventDirector").limit(1).get();

  if (callerRole !== "eventDirector" && !directorCheck.empty) {
    throw new HttpsError("permission-denied", "Only an event director can seed demo data.");
  }

  const DEMO_PASSWORD = "Pulse@123";
  const demoUsers = [
    { email: "director@pulse.local", displayName: "Event Director", role: "eventDirector" as UserRole },
    { email: "manager1@pulse.local", displayName: "Priya Sharma", role: "stageManager" as UserRole },
    { email: "manager2@pulse.local", displayName: "James Okafor", role: "stageManager" as UserRole },
    { email: "attendee1@pulse.local", displayName: "Attendee One", role: "attendee" as UserRole },
    { email: "attendee2@pulse.local", displayName: "Attendee Two", role: "attendee" as UserRole },
  ];

  async function getOrCreateAuthUser(email: string, password: string, displayName: string) {
    try {
      return await admin.auth().getUserByEmail(email);
    } catch {
      return admin.auth().createUser({ email, password, displayName, emailVerified: true });
    }
  }

  const userMap = new Map<string, string>();
  for (const demoUser of demoUsers) {
    const authUser = await getOrCreateAuthUser(demoUser.email, DEMO_PASSWORD, demoUser.displayName);
    userMap.set(demoUser.email, authUser.uid);
    await db.collection("users").doc(authUser.uid).set(
      {
        email: demoUser.email,
        displayName: demoUser.displayName,
        role: demoUser.role,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        seeded: true,
      },
      { merge: true },
    );
  }

  const manager1Uid = userMap.get("manager1@pulse.local");
  const manager2Uid = userMap.get("manager2@pulse.local");
  const attendee1Uid = userMap.get("attendee1@pulse.local");
  const attendee2Uid = userMap.get("attendee2@pulse.local");

  if (!manager1Uid || !manager2Uid || !attendee1Uid || !attendee2Uid) {
    throw new HttpsError("internal", "Failed to resolve demo users.");
  }

  // Wipe all existing daily stats for these managers so stale docs
  // from previous seeds don't bleed into the new graph.
  for (const managerUid of [manager1Uid, manager2Uid]) {
    const existing = await db
      .collection("managerDailyStats")
      .where("managerId", "==", managerUid)
      .get();
    // Delete in chunks of 500 (Firestore batch limit)
    for (let i = 0; i < existing.docs.length; i += 500) {
      const chunk = existing.docs.slice(i, i + 500);
      const delBatch = db.batch();
      chunk.forEach((d) => delBatch.delete(d.ref));
      await delBatch.commit();
    }
  }

  const now = new Date();

  function daysAgo(n: number): Date {
    const d = new Date(now);
    d.setUTCHours(14, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  }

  function feedbackTs(sessionDate: Date, minutesAfterStart: number): admin.firestore.Timestamp {
    return admin.firestore.Timestamp.fromDate(
      new Date(sessionDate.getTime() + minutesAfterStart * 60 * 1000),
    );
  }

  // 8 sessions total — 4 per manager, one per day over the last 8 days.
  // Each has 25 realistic feedback entries → 200 total feedback points.
  const sessions = [
    {
      id: "session-ai-healthcare",
      title: "The Future of AI in Healthcare",
      managerId: manager1Uid,
      managerEmail: "manager1@pulse.local",
      managerName: "Priya Sharma",
      accessCode: "AH2025",
      date: daysAgo(8),
    },
    {
      id: "session-urban-mobility",
      title: "Rethinking Urban Mobility",
      managerId: manager2Uid,
      managerEmail: "manager2@pulse.local",
      managerName: "James Okafor",
      accessCode: "UM2025",
      date: daysAgo(7),
    },
    {
      id: "session-ocean-tech",
      title: "Ocean Conservation and Technology",
      managerId: manager1Uid,
      managerEmail: "manager1@pulse.local",
      managerName: "Priya Sharma",
      accessCode: "OC2025",
      date: daysAgo(6),
    },
    {
      id: "session-mental-health",
      title: "Mental Health in the Digital Age",
      managerId: manager2Uid,
      managerEmail: "manager2@pulse.local",
      managerName: "James Okafor",
      accessCode: "MH2025",
      date: daysAgo(5),
    },
    {
      id: "session-climate-action",
      title: "Climate Action Through Grassroots Innovation",
      managerId: manager1Uid,
      managerEmail: "manager1@pulse.local",
      managerName: "Priya Sharma",
      accessCode: "CA2025",
      date: daysAgo(4),
    },
    {
      id: "session-future-education",
      title: "Reimagining Education for the Next Generation",
      managerId: manager2Uid,
      managerEmail: "manager2@pulse.local",
      managerName: "James Okafor",
      accessCode: "FE2025",
      date: daysAgo(3),
    },
    {
      id: "session-biotech-longevity",
      title: "Biotech and the Science of Living Longer",
      managerId: manager1Uid,
      managerEmail: "manager1@pulse.local",
      managerName: "Priya Sharma",
      accessCode: "BL2025",
      date: daysAgo(2),
    },
    {
      id: "session-digital-democracy",
      title: "Digital Democracy: Power, Platforms, and People",
      managerId: manager2Uid,
      managerEmail: "manager2@pulse.local",
      managerName: "James Okafor",
      accessCode: "DD2025",
      date: daysAgo(1),
    },
  ];

  // Realistic feedback per session: 25 entries each, varied ratings, realistic TED-style comments
  const feedbackBySessions: Record<string, Array<{ rating: number; comment: string }>> = {
    "session-ai-healthcare": [
      { rating: 5, comment: "Incredibly inspiring. The speaker's research on early cancer detection using AI is exactly the kind of innovation the world needs." },
      { rating: 5, comment: "Best talk of the event. Clear, evidence-based, and delivered with genuine passion." },
      { rating: 5, comment: "The live demo of the diagnostic tool was mind-blowing. I work in radiology and this is exactly where the field is heading." },
      { rating: 5, comment: "Left with three concrete ideas I want to share with my team on Monday. Phenomenal content." },
      { rating: 5, comment: "A perfect blend of personal story and hard science. Emotional without being manipulative." },
      { rating: 5, comment: "The statistics on misdiagnosis rates were sobering but the AI solution gave genuine hope." },
      { rating: 5, comment: "One of the most technically credible TEDx talks I have ever attended. Real data, real impact." },
      { rating: 5, comment: "This is why I come to TEDx. Left feeling genuinely optimistic about where healthcare is going." },
      { rating: 5, comment: "Standing ovation material. The speaker handled the ethical questions from the audience brilliantly." },
      { rating: 5, comment: "The speaker's energy and expertise were evident in every sentence. Exceptional." },
      { rating: 4, comment: "Really strong talk. A couple of slides were text-heavy and hard to read from the back rows." },
      { rating: 4, comment: "Impressive research. Would have liked more discussion on the regulatory approval process." },
      { rating: 4, comment: "Great talk overall. The opening story about the misdiagnosis patient was particularly powerful." },
      { rating: 4, comment: "Very engaging. The speaker could slow down in the technical sections for a non-specialist audience." },
      { rating: 4, comment: "Excellent substance. The stage presence was a bit stiff early on but the speaker warmed up nicely." },
      { rating: 4, comment: "Strong presentation. The AI accuracy numbers were compelling — citing sources would help credibility." },
      { rating: 4, comment: "Really valuable session. Minor note: the live demo had a moment of lag that disrupted the flow." },
      { rating: 4, comment: "Excellent overall. Ran about 5 minutes over, which cut into Q&A time." },
      { rating: 3, comment: "Interesting topic but felt like a lot of the claims needed more context to fully evaluate." },
      { rating: 3, comment: "Good foundation but the second half lost momentum. More concrete case studies would have helped." },
      { rating: 3, comment: "Decent talk. The speaker knows the material but struggled to make it accessible to non-technical attendees." },
      { rating: 3, comment: "Some interesting points buried under too much jargon. Needed a sharper narrative." },
      { rating: 3, comment: "Middle of the road. The topic deserves a more focused angle." },
      { rating: 2, comment: "The speaker overestimated how much the audience knew about machine learning. Lost me by slide 4." },
      { rating: 2, comment: "Too much jargon. The ideas might be good but they were not communicated clearly enough for a general audience." },
    ],
    "session-urban-mobility": [
      { rating: 5, comment: "This is the talk I will be recommending to every urban planner I know. Concrete, visionary, and actionable." },
      { rating: 5, comment: "The speaker dismantled my assumptions about car-centric city design in 18 minutes flat. Extraordinary." },
      { rating: 5, comment: "Brilliant. The before-and-after city case studies made the abstract tangible and the argument impossible to refute." },
      { rating: 5, comment: "Loved every minute. The ideas about 15-minute cities have changed how I think about where I live." },
      { rating: 5, comment: "One of the most coherent arguments for a policy shift I have ever heard in a public forum." },
      { rating: 5, comment: "Stunning presentation. Great balance of global research and personal experience as a daily commuter." },
      { rating: 5, comment: "The speaker's energy was infectious. Left wanting to take action immediately." },
      { rating: 5, comment: "Excellent use of data visualisations. Complex urban data made genuinely understandable and compelling." },
      { rating: 4, comment: "Very strong talk. Would have liked a bit more on implementation challenges in lower-income cities." },
      { rating: 4, comment: "Engaging and well-paced. The humour landed well and kept the energy up throughout." },
      { rating: 4, comment: "Great content. The final 3 minutes felt rushed — more time on the actionable framework would have helped." },
      { rating: 4, comment: "Really informative. The speaker clearly lives and breathes this topic." },
      { rating: 4, comment: "Excellent session. Some of the statistics would benefit from source citations on the slides." },
      { rating: 4, comment: "Compelling argument. The counterargument to urban sprawl was particularly well constructed." },
      { rating: 4, comment: "Well researched and clearly presented. Left with a lot to think about and share with colleagues." },
      { rating: 4, comment: "Very good. The Q&A was especially strong — the speaker handled pushback gracefully." },
      { rating: 4, comment: "Strong visual storytelling. The city map animations were particularly effective." },
      { rating: 4, comment: "Solid presentation. The interactive element mid-talk was a fun and unexpected touch." },
      { rating: 3, comment: "Good ideas but the talk needed a sharper conclusion. It ended somewhat abruptly." },
      { rating: 3, comment: "Decent content. Some sections felt more like a policy lecture than a TED talk." },
      { rating: 3, comment: "The first half was excellent; the second half lost its shape a bit." },
      { rating: 3, comment: "Interesting but the proposed solutions are harder to implement than the talk implied." },
      { rating: 3, comment: "Good foundation. More specificity on financing models would have elevated it considerably." },
      { rating: 2, comment: "Felt like a policy briefing rather than a TEDx talk. Needed more of a human story to anchor it." },
      { rating: 2, comment: "The ideas are sound but this particular speaker is not the right messenger for this topic." },
    ],
    "session-ocean-tech": [
      { rating: 5, comment: "Absolutely captivating. The drone footage alone was worth attending. A stunning presentation on a critical issue." },
      { rating: 5, comment: "Rare to see technology and conservation come together so thoughtfully. Genuinely moved by the end." },
      { rating: 5, comment: "The speaker's personal commitment to this cause came through in every slide. Truly inspiring." },
      { rating: 4, comment: "Good session. The data on microplastics was alarming in the right way — motivating rather than paralyzing." },
      { rating: 4, comment: "Well delivered. The section on bio-acoustic monitoring was new to me and genuinely fascinating." },
      { rating: 4, comment: "Solid talk with a clear message. More time on the tech solutions would have made it exceptional." },
      { rating: 4, comment: "Engaging and relevant. The call to action at the end was practical and specific." },
      { rating: 4, comment: "Good pacing. The speaker connected global data to local action effectively." },
      { rating: 3, comment: "Worthwhile topic but the talk felt like an overview rather than a deep dive into any single innovation." },
      { rating: 3, comment: "Decent. Some interesting technology mentioned but not explored in enough depth to be truly useful." },
      { rating: 3, comment: "The slides were busy. Key data points got lost in the visual clutter." },
      { rating: 3, comment: "Relevant content but the structure was a bit disjointed. Hard to follow the main thesis." },
      { rating: 3, comment: "Some genuinely interesting moments but also some padding that could have been cut." },
      { rating: 3, comment: "Good intentions, moderate execution. The technology case studies were underdeveloped." },
      { rating: 3, comment: "Topic is important. Presentation was average — could have been far more impactful." },
      { rating: 3, comment: "Some good points buried in too much general context about ocean ecosystems." },
      { rating: 3, comment: "Fair talk. The speaker seemed more comfortable with conservation than with the technology side." },
      { rating: 3, comment: "Middle of the road. Needed either more depth on the tech or a tighter focus on one solution." },
      { rating: 2, comment: "Expected more on the actual technology being deployed. Felt like an awareness session, not a TEDx talk." },
      { rating: 2, comment: "The speaker lost the thread in the middle section. Hard to see how the examples connected." },
      { rating: 2, comment: "Too surface-level. This could have been a 5-minute video. Not TEDx worthy." },
      { rating: 2, comment: "Weak structure. The statistics cited felt dated and were not properly sourced." },
      { rating: 2, comment: "Overlong for the amount of new information conveyed. Could have been half the length." },
      { rating: 1, comment: "Very poor. The speaker spent 8 minutes on background the audience already knew. No original ideas." },
      { rating: 1, comment: "Had high hopes but this was unfocused and underdelivered. The drone footage was great; everything else was not." },
    ],
    "session-mental-health": [
      { rating: 5, comment: "This talk will stay with me for a long time. The speaker's personal vulnerability made it genuinely powerful." },
      { rating: 5, comment: "Exactly what the conversation around mental health needs. Evidence-based, compassionate, and actionable." },
      { rating: 5, comment: "I came in sceptical of another mental health talk and left completely convinced. Exceptional in every way." },
      { rating: 5, comment: "The framework the speaker introduced for digital-physical balance is something I am implementing immediately." },
      { rating: 5, comment: "Stunning. The data on teen anxiety and social media use was presented without sensationalism." },
      { rating: 5, comment: "Genuinely moving. The section on children's screen time was handled with real care and nuance." },
      { rating: 5, comment: "The speaker has a remarkable gift for making clinical research feel personal and urgent." },
      { rating: 5, comment: "The most important talk of the event. Every parent in the room should have been present." },
      { rating: 5, comment: "Rare to see a talk that is both scientifically rigorous and emotionally resonant. This was both." },
      { rating: 5, comment: "Left in tears. The courage it took to share that story was not lost on anyone in the room." },
      { rating: 5, comment: "Changed how I think about my own relationship with my phone. Practical, direct, and deeply honest." },
      { rating: 5, comment: "A five-star talk in every dimension. I have already sent the recording link to twelve people." },
      { rating: 4, comment: "Beautiful talk. Some of the statistics felt like they needed more recent sourcing to be fully convincing." },
      { rating: 4, comment: "Incredibly moving. The stage lighting and pacing were perfect. Minor: the call to action could be clearer." },
      { rating: 4, comment: "Really strong. The personal story was handled with dignity. Would have liked more on therapist-facing tools." },
      { rating: 4, comment: "Excellent substance. The speaker occasionally rushed through the most interesting parts." },
      { rating: 4, comment: "Very good. The technology recommendations were practical. A bit more depth on the research behind them would be ideal." },
      { rating: 4, comment: "Great session. One or two transitions felt abrupt but the overall arc was strong." },
      { rating: 4, comment: "Strong talk. The vulnerability was authentic. A few slides were text-heavy." },
      { rating: 4, comment: "Really well delivered. The closing was slightly anticlimactic given how powerful the middle section was." },
      { rating: 3, comment: "Good talk but covered well-trodden ground. Not much that was genuinely new for those following this area." },
      { rating: 3, comment: "Decent. The personal story was compelling but the systemic analysis felt thin." },
      { rating: 3, comment: "Fine presentation. The connection between digital habits and mental health needed more specific evidence." },
      { rating: 3, comment: "Some strong moments but also some generalisations that did not hold up on reflection." },
      { rating: 2, comment: "The talk oversimplified complex mental health issues. Some of the recommendations felt irresponsible without more caveats." },
    ],
    "session-climate-action": [
      { rating: 5, comment: "One of the most energising talks I have attended. The grassroots examples from three continents were extraordinary." },
      { rating: 5, comment: "Refreshing to see climate action framed around community agency rather than top-down policy. Genuinely hopeful." },
      { rating: 5, comment: "The speaker's ability to connect micro-level stories to macro-level impact is a rare and beautiful skill." },
      { rating: 5, comment: "I left this talk with six actionable ideas. That almost never happens." },
      { rating: 5, comment: "Standing ovation from everyone around me. The data was compelling and the delivery was magnetic." },
      { rating: 4, comment: "Really strong. The African solar cooperative case study was the highlight. More like that, please." },
      { rating: 4, comment: "Excellent talk. The speaker had genuine conviction. Would have liked more depth on the funding models." },
      { rating: 4, comment: "Inspiring and well-paced. The transition to the Q&A was slightly abrupt." },
      { rating: 4, comment: "Great content. The speaker connected technology and community in a genuinely original way." },
      { rating: 4, comment: "Very good. The framing around 'distributed power' as both metaphor and reality was clever and memorable." },
      { rating: 4, comment: "Solid talk. The real-world examples were vivid. A bit more statistical rigour would have helped." },
      { rating: 4, comment: "Excellent energy throughout. The closing call to action was the strongest I have heard at any TEDx." },
      { rating: 4, comment: "Strong presentation. The speaker answered a difficult question in the Q&A with exceptional poise." },
      { rating: 3, comment: "Good ideas but some of the case studies felt cherry-picked. Needed more honest discussion of failures." },
      { rating: 3, comment: "Engaging speaker but the talk lacked a clear through-line. Felt like three talks compressed into one." },
      { rating: 3, comment: "Decent. The optimism was infectious but occasionally felt disconnected from the scale of the problem." },
      { rating: 3, comment: "Some interesting local examples but the global conclusions felt overstated." },
      { rating: 3, comment: "Good start, inconsistent middle, strong finish. Overall about average for a TEDx." },
      { rating: 3, comment: "Relevant and timely but not especially original. Much of this ground has been covered elsewhere." },
      { rating: 3, comment: "The speaker was passionate but occasionally sacrificed accuracy for a punchline." },
      { rating: 2, comment: "The talk promised grassroots innovation but spent most of its time on well-known projects. Disappointing." },
      { rating: 2, comment: "Felt like an advocacy piece rather than a TEDx talk. Needed more balance and depth." },
      { rating: 2, comment: "Some compelling moments but the argument was not coherent enough to build to a convincing conclusion." },
      { rating: 1, comment: "The speaker read directly from slides for most of the talk. The content itself was not original enough to compensate." },
      { rating: 1, comment: "Weakest talk of the day. The examples were anecdotal, the claims were unverified, and the structure was unclear." },
    ],
    "session-future-education": [
      { rating: 5, comment: "Possibly the most thought-provoking TEDx talk I have ever seen. Left wanting to overhaul my own learning approach immediately." },
      { rating: 5, comment: "The distinction between 'learning for tests' and 'learning for life' was articulated more clearly here than anywhere I have read." },
      { rating: 5, comment: "A genuine mind-shift in 18 minutes. The speaker is as good at teaching about teaching as you could hope for." },
      { rating: 5, comment: "Exceptional in every dimension. The live experiment with the audience was a genuinely innovative moment." },
      { rating: 5, comment: "I teach secondary school and this talk reminded me why I chose this profession. Thank you." },
      { rating: 5, comment: "The evidence base was rock solid and the narrative framing was beautifully constructed." },
      { rating: 5, comment: "Could not take notes fast enough. Every idea was both novel and immediately applicable." },
      { rating: 4, comment: "Really strong talk. The secondary school examples were particularly resonant. More on higher education would be welcome." },
      { rating: 4, comment: "Excellent substance. The audience participation segment slowed the pace a little but the point it made was worth it." },
      { rating: 4, comment: "Great talk. The research citations were impressive. Slides were occasionally text-heavy." },
      { rating: 4, comment: "Very engaging. The speaker made complex learning science genuinely accessible." },
      { rating: 4, comment: "Strong and practical. The three-framework model will stay with me for a long time." },
      { rating: 4, comment: "Good energy and clear structure. The call to action was specific and achievable." },
      { rating: 4, comment: "Excellent content. The speaker was occasionally too fast in the data-heavy sections." },
      { rating: 4, comment: "Really good. The framing around 'curiosity-first' education is something I want to bring to my team." },
      { rating: 3, comment: "The ideas are sound but not new. The execution was competent rather than exceptional." },
      { rating: 3, comment: "Good talk but veered into oversimplification at times. Education reform is harder than the talk implied." },
      { rating: 3, comment: "Some excellent individual moments but the talk did not fully connect them into a coherent argument." },
      { rating: 3, comment: "Decent. The speaker clearly knows the material but the talk needed a sharper central thesis." },
      { rating: 3, comment: "Fine overall. The international examples were interesting but felt underdeveloped." },
      { rating: 2, comment: "The ideas in the first five minutes were never built upon. The talk lost its thread and never found it." },
      { rating: 2, comment: "Needed more engagement with counterarguments. The talk was one-sided in a way that undermined its credibility." },
      { rating: 2, comment: "The live demo was a good idea that did not land. It broke the flow and the lesson it was meant to teach was unclear." },
      { rating: 1, comment: "Felt rushed and unprepared. The speaker seemed to be working from memory rather than from a rehearsed narrative." },
      { rating: 1, comment: "Very disappointing given the topic. Generic content, poor pacing, and no memorable takeaway." },
    ],
    "session-biotech-longevity": [
      { rating: 5, comment: "Extraordinary talk. The science of cellular ageing explained with clarity and genuine excitement." },
      { rating: 5, comment: "Left this feeling both optimistic and appropriately cautious. Rare for a talk on longevity to achieve that balance." },
      { rating: 5, comment: "The speaker's command of the research landscape in this field is impressive. Highly credible and deeply engaging." },
      { rating: 5, comment: "Covered the ethical dimension without being preachy. Refreshing honesty about what we do and don't yet know." },
      { rating: 5, comment: "This is the talk I will be thinking about for weeks. The implications are staggering." },
      { rating: 5, comment: "Phenomenal. The section on senolytics was the clearest lay explanation of the science I have encountered." },
      { rating: 4, comment: "Excellent talk. Very strong on the science; could have spent more time on the social implications of extended lifespans." },
      { rating: 4, comment: "Highly credible and well-delivered. The Q&A session was some of the best audience interaction of the day." },
      { rating: 4, comment: "Really strong content. A few technical sections lost the non-scientists in the audience." },
      { rating: 4, comment: "Great balance of aspiration and sober analysis. The discussion of access and equity was welcome and needed." },
      { rating: 4, comment: "Very good. The speaker's personal motivation for entering the field gave it emotional depth." },
      { rating: 4, comment: "Strong and well-paced. The closing provocation about what 'healthy longer lives' really means was perfectly timed." },
      { rating: 3, comment: "Interesting topic but the talk was very dense. Hard to follow for those without a science background." },
      { rating: 3, comment: "Some genuinely fascinating science here. The talk would benefit from a clearer narrative throughline." },
      { rating: 3, comment: "Good content but the speaker spoke very quickly in the technical sections. Would benefit from being slowed down." },
      { rating: 3, comment: "Decent. The data was impressive but the visual design of the slides made it harder to absorb than it needed to be." },
      { rating: 3, comment: "Fair talk. The first half was excellent; the second half felt rushed as though time was running out." },
      { rating: 2, comment: "The talk felt like an academic conference presentation rather than a TEDx talk. Needed significant reworking for a general audience." },
      { rating: 2, comment: "Important subject, but the speaker did not adapt the content for a lay audience. Too technical throughout." },
      { rating: 2, comment: "Lost me in the second half. The data was interesting but the argument it was meant to support was never clear." },
      { rating: 2, comment: "Missed opportunity. The ethical questions raised in the opening were never properly addressed." },
      { rating: 1, comment: "Way too technical and too fast. I understood perhaps 40% of what was said. Not appropriate for a general TEDx." },
      { rating: 1, comment: "The talk made bold claims about timelines for longevity breakthroughs that felt deeply irresponsible without more caveats." },
      { rating: 1, comment: "Uncomfortable mix of science and what felt like investment pitch. Lacked the intellectual honesty expected at TEDx." },
      { rating: 1, comment: "One of the weakest talks I have heard here. The speaker appeared to read from a script and made no eye contact." },
    ],
    "session-digital-democracy": [
      { rating: 5, comment: "Chilling and necessary. The analysis of how platforms shape political discourse was meticulous and devastating." },
      { rating: 5, comment: "One of the most important talks at any event this year. The speaker had the courage to name the specific mechanisms of manipulation." },
      { rating: 5, comment: "Left feeling genuinely informed rather than merely entertained. The distinction matters enormously for a topic like this." },
      { rating: 5, comment: "The speaker managed to be simultaneously alarming and hopeful. A very difficult balance, achieved brilliantly." },
      { rating: 5, comment: "Extraordinary depth for a short format. Every sentence was load-bearing." },
      { rating: 4, comment: "Really strong talk. The case studies from three different democracies were well chosen and well argued." },
      { rating: 4, comment: "Excellent analysis. The speaker was occasionally too abstract — more concrete examples would have helped." },
      { rating: 4, comment: "Very well constructed argument. The proposed solutions felt slightly rushed but the problem diagnosis was superb." },
      { rating: 4, comment: "Good balance of urgency and nuance. The regulatory proposals at the end were practical and grounded." },
      { rating: 4, comment: "Strong content. The speaker dealt thoughtfully with audience pushback in the Q&A." },
      { rating: 4, comment: "Well-researched and clearly argued. The talk benefits from being watched twice." },
      { rating: 4, comment: "Solid. The framing of 'attention as a political resource' was a genuinely useful new lens." },
      { rating: 3, comment: "Important topic but the talk felt too dense to fully absorb in one sitting. Needed more white space." },
      { rating: 3, comment: "Good ideas. The speaker's academic background occasionally got in the way of the storytelling." },
      { rating: 3, comment: "Decent. The breadth was impressive but came at the cost of depth on any individual point." },
      { rating: 3, comment: "Some very strong moments but also some overstatements that weakened an otherwise credible argument." },
      { rating: 3, comment: "Fair. The analysis of the problem was strong; the solutions section felt underdeveloped and generic." },
      { rating: 3, comment: "Fine talk. The global scope was ambitious and mostly achieved, though some regional examples felt thin." },
      { rating: 2, comment: "The talk suffered from trying to cover too much. Better to go deep on one mechanism than shallow on six." },
      { rating: 2, comment: "The speaker was clearly knowledgeable but the presentation was disorganised. Hard to follow the core argument." },
      { rating: 2, comment: "Left more confused than when I arrived. The talk raised important questions but answered very few of them." },
      { rating: 2, comment: "Needed a clearer editorial hand. Too many ideas competing for attention, none fully resolved." },
      { rating: 1, comment: "Disappointing. The first three minutes were excellent but the talk never built on that promise." },
      { rating: 1, comment: "The framing was alarmist without the evidence to justify it. Undermined what could have been a rigorous analysis." },
      { rating: 1, comment: "Very poor structure. It was unclear what the talk was arguing until the final minute, which is far too late." },
    ],
  };

  // Create sessions and feedback
  let totalFeedbackCount = 0;
  let totalRatingSum = 0;
  let totalOneStarCount = 0;

  for (const session of sessions) {
    const feedback = feedbackBySessions[session.id];
    const ratingSum = feedback.reduce((s, f) => s + f.rating, 0);
    const avgRating = Number((ratingSum / feedback.length).toFixed(2));
    const sessionDate = session.date;

    await db.collection("sessions").doc(session.id).set(
      {
        title: session.title,
        managerId: session.managerId,
        managerEmail: session.managerEmail,
        managerName: session.managerName,
        accessCode: session.accessCode,
        startedAt: admin.firestore.Timestamp.fromDate(sessionDate),
        createdAt: admin.firestore.Timestamp.fromDate(sessionDate),
        isActive: false,
        avgRating,
        totalFeedback: feedback.length,
        ratingSum,
        seeded: true,
      },
      { merge: true },
    );

    // Batch feedback writes — two writes per entry (session subcollection + mirror).
    // 25 entries × 2 = 50 ops, well within Firestore's 500-op batch limit.
    const feedbackBatch = db.batch();
    for (let i = 0; i < feedback.length; i++) {
      const { rating, comment } = feedback[i];
      const fUserId = i % 2 === 0 ? attendee1Uid : attendee2Uid;
      const createdAt = feedbackTs(sessionDate, 90 + i * 5);
      const docId = `${session.id}-seed-${i + 1}`;

      feedbackBatch.set(
        db.collection("sessions").doc(session.id).collection("feedback").doc(docId),
        {
          sessionId: session.id,
          sessionTitle: session.title,
          managerId: session.managerId,
          userId: fUserId,
          rating,
          comment,
          createdAt,
          skipAggregation: true,
          seeded: true,
        },
        { merge: true },
      );

      feedbackBatch.set(
        db.collection("feedback").doc(docId),
        {
          sessionId: session.id,
          sessionTitle: session.title,
          managerId: session.managerId,
          userId: fUserId,
          rating,
          comment,
          createdAt,
          seeded: true,
        },
        { merge: true },
      );
    }
    await feedbackBatch.commit();

    totalFeedbackCount += feedback.length;
    totalRatingSum += ratingSum;
    totalOneStarCount += feedback.filter((f) => f.rating === 1).length;

    // Manager daily stats for the session date
    const dateStr = sessionDate.toISOString().slice(0, 10);
    await db
      .collection("managerDailyStats")
      .doc(`${session.managerId}_${dateStr}`)
      .set(
        {
          managerId: session.managerId,
          date: dateStr,
          sessionsHosted: 1,
          feedbackReceived: feedback.length,
          ratingSum,
          averageRating: avgRating,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          seeded: true,
        },
        { merge: true },
      );
  }

  await db.collection("eventStats").doc("global").set(
    {
      feedbackCount: totalFeedbackCount,
      ratingSum: totalRatingSum,
      avgRating: Number((totalRatingSum / totalFeedbackCount).toFixed(2)),
      oneStarCount: totalOneStarCount,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      seeded: true,
    },
    { merge: true },
  );

  return {
    ok: true,
    message: "Demo data seeded: 8 sessions (4 per manager), 25 feedback each.",
    credentials: {
      password: DEMO_PASSWORD,
      users: demoUsers.map((u) => ({ email: u.email, role: u.role })),
    },
  };
});
