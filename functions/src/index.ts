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

    const sessionRef = db.collection("sessions").doc(sessionId);
    const statsRef = db.collection("eventStats").doc("global");

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
    });

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
        ? " this is coded Audience sentiment was mostly positive."
        : " this is coded Audience feedback was mixed.",

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

  // Delete feedback docs in batches to avoid recursive orphan data.
  while (true) {
    const feedbackSnap = await sessionRef.collection("feedback").limit(250).get();
    if (feedbackSnap.empty) {
      break;
    }

    const batch = db.batch();
    feedbackSnap.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
      batch.delete(db.collection("feedback").doc(docSnap.id));
    });
    await batch.commit();
  }

  await sessionRef.delete();
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
    { email: "manager1@pulse.local", displayName: "Stage Manager One", role: "stageManager" as UserRole },
    { email: "manager2@pulse.local", displayName: "Stage Manager Two", role: "stageManager" as UserRole },
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
  if (!manager1Uid || !manager2Uid) {
    throw new HttpsError("internal", "Failed to resolve demo managers.");
  }

  const demoSessions = [
    { id: "session-ai-future", title: "The Future of AI", managerId: manager1Uid, managerEmail: "manager1@pulse.local", managerName: "Stage Manager One", avgRating: 4.5, totalFeedback: 6, ratingSum: 27 },
    { id: "session-climate-action", title: "Climate Action Now", managerId: manager1Uid, managerEmail: "manager1@pulse.local", managerName: "Stage Manager One", avgRating: 3.9, totalFeedback: 5, ratingSum: 19.5 },
    { id: "session-design-minds", title: "Designing Better Minds", managerId: manager1Uid, managerEmail: "manager1@pulse.local", managerName: "Stage Manager One", avgRating: 2.7, totalFeedback: 5, ratingSum: 13.5 },
    { id: "session-health-innov", title: "Health Innovation", managerId: manager1Uid, managerEmail: "manager1@pulse.local", managerName: "Stage Manager One", avgRating: 4.1, totalFeedback: 5, ratingSum: 20.5 },
    { id: "session-ethics-scale", title: "Ethics at Scale", managerId: manager2Uid, managerEmail: "manager2@pulse.local", managerName: "Stage Manager Two", avgRating: 3.2, totalFeedback: 5, ratingSum: 16 },
    { id: "session-city-future", title: "Future Cities", managerId: manager2Uid, managerEmail: "manager2@pulse.local", managerName: "Stage Manager Two", avgRating: 4.7, totalFeedback: 6, ratingSum: 28.2 },
    { id: "session-edu-evolve", title: "Education Evolved", managerId: manager2Uid, managerEmail: "manager2@pulse.local", managerName: "Stage Manager Two", avgRating: 2.5, totalFeedback: 4, ratingSum: 10 },
    { id: "session-human-story", title: "The Human Story", managerId: manager2Uid, managerEmail: "manager2@pulse.local", managerName: "Stage Manager Two", avgRating: 3.8, totalFeedback: 5, ratingSum: 19 },
  ];

  const now = new Date();
  for (const session of demoSessions) {
    await db.collection("sessions").doc(session.id).set(
      {
        title: session.title,
        managerId: session.managerId,
        managerEmail: session.managerEmail,
        managerName: session.managerName,
        startedAt: admin.firestore.Timestamp.fromDate(now),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
        avgRating: session.avgRating,
        totalFeedback: session.totalFeedback,
        ratingSum: session.ratingSum,
        seeded: true,
      },
      { merge: true },
    );

    for (let i = 0; i < session.totalFeedback; i += 1) {
      const ratingPattern = [5, 4, 4, 3, 2, 1];
      const rating = ratingPattern[i % ratingPattern.length];
      await db.collection("sessions").doc(session.id).collection("feedback").doc(`${session.id}-seed-${i + 1}`).set(
        {
          sessionId: session.id,
          sessionTitle: session.title,
          managerId: session.managerId,
          userId: userMap.get("attendee1@pulse.local") ?? null,
          rating,
          comment: `Seed comment ${i + 1} for ${session.title}`,
          createdAt: admin.firestore.Timestamp.fromDate(new Date(now.getTime() - (i + 1) * 60 * 60 * 1000)),
          skipAggregation: true,
          seeded: true,
        },
        { merge: true },
      );
    }
  }

  await db.collection("eventStats").doc("global").set(
    {
      feedbackCount: demoSessions.reduce((acc, s) => acc + s.totalFeedback, 0),
      ratingSum: demoSessions.reduce((acc, s) => acc + s.ratingSum, 0),
      avgRating: 3.67,
      oneStarCount: 4,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      seeded: true,
    },
    { merge: true },
  );

  const dailyDates = Array.from({ length: 30 }, (_, idx) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - idx);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  });

  for (const managerUid of [manager1Uid, manager2Uid]) {
    for (const date of dailyDates) {
      const avg = Number((2.5 + Math.random() * 2.2).toFixed(2));
      await db.collection("managerDailyStats").doc(`${managerUid}_${date}`).set(
        {
          managerId: managerUid,
          date,
          sessionsHosted: 4,
          feedbackReceived: 10,
          averageRating: avg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          seeded: true,
        },
        { merge: true },
      );
    }
  }

  await db.collection("sessionSummaries").doc("seed-summary").set(
    {
      date: now.toISOString().slice(0, 10),
      summaryText: "Seeded summary: sessions performed strongly overall with a few at-risk topics requiring follow-up.",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      seeded: true,
    },
    { merge: true },
  );

  await db.collection("tasks").doc("seed-task-1").set({ title: "Check at-risk sessions before next break", seeded: true }, { merge: true });
  await db.collection("tasks").doc("seed-task-2").set({ title: "Review one-star comments with managers", seeded: true }, { merge: true });

  return {
    ok: true,
    message: "Dummy data seeded successfully.",
    credentials: {
      password: DEMO_PASSWORD,
      users: demoUsers.map((u) => ({ email: u.email, role: u.role })),
    },
  };
});
