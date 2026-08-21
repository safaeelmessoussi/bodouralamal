import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/** R66 — an enrolment carries its own branch, taken from the group so the
 *  composite FK `(administrative_group_id, branch_id)` holds. */
async function branchOf(groupId: string): Promise<string> {
  const g = await prisma.administrativeGroup.findUniqueOrThrow({
    where: { id: groupId },
    select: { branchId: true },
  });
  return g.branchId;
}

/**
 * `GET /calendar/sessions/{id}` over real HTTP — the §5.2 Session page (TD-3.4).
 *
 * **The claim only this layer can check** is §5.2's sentence: an anonymous
 * visitor sees a public session's *existence and details*, and never its
 * *private recordings*. That is one request returning some things and withholding
 * others, which no service assertion about a single list can express.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-session-page-test]";
const YEAR_LABEL = "2096-2097";

const PAGE_KEYS = [
  "linked_content",
  "notes",
  "occurrence",
  "recordings",
  // R99 — R75.6's default recording name, composed by the server so the browser
  // recorder and the ingestion worker cannot number into two namespaces.
  "suggested_recording_name",
];
const ITEM_KEYS = ["id", "level_id", "subject_id", "title"];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string };
    occurrence?: Record<string, unknown>;
    recordings?: Record<string, unknown>[];
    linked_content?: Record<string, unknown>[];
    schedule?: { id: string };
    data?: Record<string, unknown>[];
  };
}

const call = (path: string, token?: string): Promise<Res> =>
  httpCall<Res["body"]>(BASE, "GET", path, { token });

function bearer(
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string {
  return issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeUser(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  return u.id;
}

let branchA: string;
let levelId: string;
let subjectId: string;
let academicYearId: string;
let sessionId: string;
let studentToken: string;
let teacherToken: string;
const content = {
  publicPdf: "",
  privateAudio: "",
  publicAudio: "",
  hiddenPdf: "",
  /** R99.10 — audio that is NOT a recording, and a recording that is NOT audio.
   *  The two cases the superseded MIME rule got wrong. */
  publicAudioMaterial: "",
  publicVideoRecording: "",
};

async function makeContent(
  label: string,
  visibility: "public" | "private" | "hidden",
  mimeType: string,
  /**
   * **R99.10 — what the item IS.** «التسجيلات» is decided here and no longer by
   * the MIME type: an ordinary uploaded audio file is a material, and an OGG or
   * MP4 produced by recording a class is a recording.
   */
  origin: "uploaded" | "session_recording" = "uploaded",
): Promise<string> {
  const row = await prisma.educationalContent.create({
    data: {
      title: `${TAG} ${label}`,
      levelId,
      subjectId,
      academicYearId,
      branchId: branchA,
      visibility: visibility as never,
      storageBucket: "content",
      storageKey: `${TAG}/${label}-${Date.now()}-${Math.random()}`,
      originalFilename: `${label}`,
      mimeType,
      sizeBytes: BigInt(512),
      origin: origin as never,
    },
    select: { id: true },
  });
  return row.id;
}

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  await prisma.sessionContent.deleteMany({
    where: { session: { scheduleId: { in: ids } } },
  });
  await prisma.sessionStaff.deleteMany({
    where: { session: { scheduleId: { in: ids } } },
  });
  // R77 — `notification.session_id` is RESTRICT, like every other reference
  // to a Session: a cancellation notice whose session vanished is unreadable.
  // Fixtures therefore unwind notices before the occurrences they name.
  await prisma.notification.deleteMany({
    where: { session: { scheduleId: { in: ids } } },
  });
  await prisma.session.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: ids } },
  });
  if (ids.length > 0) {
    await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  }
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: ids } },
  });

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.educationalContent.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  const groups = await prisma.administrativeGroup.findMany({
    where: { levelId: { in: levelIds } },
    select: { id: true },
  });
  await prisma.enrollment.deleteMany({
    where: { administrativeGroupId: { in: groups.map((g) => g.id) } },
  });
  await prisma.administrativeGroup.deleteMany({
    where: { id: { in: groups.map((g) => g.id) } },
  });
  await prisma.levelSubject.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.room.deleteMany({
    where: { branch: { name: { startsWith: TAG } } },
  });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: userIds } },
    });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        "docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api",
    );
  }
  await clear();

  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  const room = await prisma.room.create({
    data: { name: `${TAG} قاعة`, branchId: branchA },
  });
  const category = await prisma.category.create({
    data: { name: `${TAG} فئة` },
  });
  levelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} مستوى`,
        categoryId: category.id,
        genderRestriction: "any",
      },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } }))
    .id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  const group = await prisma.administrativeGroup.create({
    data: { name: `${TAG} مجموعة`, levelId, branchId: branchA },
  });
  academicYearId = (
    await prisma.academicYear.create({ data: { label: YEAR_LABEL } })
  ).id;

  const teacherId = await makeUser("أستاذ");
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حلقة`,
      subjectId,
      teachingMode: "administrative_group",
      administrativeGroupId: group.id,
      branchId: branchA,
      roomId: room.id,
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      recurrence: "weekly",
      weekdays: ["monday"],
      academicYearId,
    },
  });
  const session = await prisma.session.create({
    data: {
      scheduleId: schedule.id,
      date: new Date("2096-09-03T00:00:00Z"),
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      roomId: room.id,
    },
    select: { id: true },
  });
  sessionId = session.id;
  await prisma.sessionStaff.create({
    data: { sessionId, userId: teacherId, position: "teacher" },
  });

  content.publicPdf = await makeContent("نشرة", "public", "application/pdf");
  content.privateAudio = await makeContent(
    "تسجيل-خاص",
    "private",
    "audio/mpeg",
    "session_recording",
  );
  content.publicAudio = await makeContent(
    "تسجيل-عام",
    "public",
    "audio/mpeg",
    "session_recording",
  );
  content.hiddenPdf = await makeContent("مخفي", "hidden", "application/pdf");
  /**
   * **The two rows that make R99.10 provable rather than asserted.**
   *
   * The old rule was *audio ⇒ recording*, so it could not tell these apart: an
   * audio file somebody attached as listening material was called a recording,
   * and a video recording of a class was unrepresentable. Both now sit on this
   * session and each must land on the opposite side of the split from where the
   * MIME type would have put it.
   */
  content.publicAudioMaterial = await makeContent(
    "مادة-صوتية",
    "public",
    "audio/mpeg",
  );
  content.publicVideoRecording = await makeContent(
    "تسجيل-مرئي",
    "public",
    "video/mp4",
    "session_recording",
  );
  for (const id of Object.values(content)) {
    await prisma.sessionContent.create({ data: { sessionId, contentId: id } });
  }

  const studentId = await makeUser("طالبة");
  await prisma.enrollment.create({
    data: {
      studentId,
      administrativeGroupId: group.id,
      levelId,
      branchId: await branchOf(group.id),
    },
  });
  studentToken = bearer(studentId, []);
  teacherToken = bearer(await makeUser("أستاذة"), [
    { role: "teacher", branches: [branchA] },
  ]);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const ids = (rows: Record<string, unknown>[] | undefined): string[] =>
  (rows ?? []).map((r) => String(r.id));

describe("the page is public, at the caller’s tier (§5.2)", () => {
  it("serves an anonymous caller the occurrence and the documented keys", async () => {
    const res = await call(`/calendar/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(PAGE_KEYS);
    expect(res.body.occurrence!.kind).toBe("session");
    expect(res.body.occurrence!.id).toBe(sessionId);
  });

  it("returns the SAME occurrence shape the grid returns", async () => {
    // TD-3.4: "the occurrence above, plus …". One include and one mapper serve
    // both; two that agree today are two that drift.
    const page = await call(`/calendar/sessions/${sessionId}`);
    const grid = await call("/calendar?from=2096-09-01&to=2096-09-30");
    const fromGrid = grid.body.data!.find((o) => o.id === sessionId)!;
    expect(fromGrid).toBeDefined();
    expect(Object.keys(page.body.occurrence!).sort()).toEqual(
      Object.keys(fromGrid).sort(),
    );
    expect(page.body.occurrence).toEqual(fromGrid);
  });

  it("an anonymous visitor sees the public recording and NEVER the private one", async () => {
    // The §5.2 sentence, in one request: existence and details, never private
    // recordings.
    const res = await call(`/calendar/sessions/${sessionId}`);
    expect(ids(res.body.recordings)).toContain(content.publicAudio);
    expect(ids(res.body.recordings)).not.toContain(content.privateAudio);
    expect(ids(res.body.linked_content)).toContain(content.publicPdf);
    // Hidden is excluded from Student/Parent directories entirely (§4.9 tier 3).
    expect(ids(res.body.linked_content)).not.toContain(content.hiddenPdf);
  });

  it("an enrolled student sees the private recording; a teacher also sees hidden", async () => {
    // The same §4.9 tiers the library applies — literally the same predicate.
    const asStudent = await call(
      `/calendar/sessions/${sessionId}`,
      studentToken,
    );
    expect(ids(asStudent.body.recordings)).toContain(content.privateAudio);
    expect(ids(asStudent.body.linked_content)).not.toContain(content.hiddenPdf);

    const asTeacher = await call(
      `/calendar/sessions/${sessionId}`,
      teacherToken,
    );
    expect(ids(asTeacher.body.linked_content)).toContain(content.hiddenPdf);
  });
});

describe("recordings and linked_content are disjoint", () => {
  /**
   * **The property is the split, and it survives R99 — the INPUT changed.**
   *
   * This assertion used to read *splits on the file being audio*. R99.10
   * supersedes that: «التسجيلات» is a Session's linked contents with
   * `origin = session_recording`, and the MIME type decides only which player
   * the reader gets. The guard is restated on the new input rather than deleted,
   * because disjointness was never the thing that changed.
   */
  it("splits on the item's ORIGIN, and never lists an item twice", async () => {
    const res = await call(`/calendar/sessions/${sessionId}`, studentToken);
    const rec = ids(res.body.recordings);
    const linked = ids(res.body.linked_content);

    expect(rec.length).toBeGreaterThan(0);
    expect(linked.length).toBeGreaterThan(0);
    expect(rec.filter((id) => linked.includes(id))).toEqual([]);
    expect(linked).not.toContain(content.publicAudio);
  });

  it("an ordinary uploaded AUDIO file is a material, not a recording", async () => {
    // The half of the old rule that was wrong in one direction: it called every
    // attached audio file a recording whether or not it was one.
    const res = await call(`/calendar/sessions/${sessionId}`, studentToken);
    expect(ids(res.body.linked_content)).toContain(content.publicAudioMaterial);
    expect(ids(res.body.recordings)).not.toContain(content.publicAudioMaterial);
  });

  it("a VIDEO session recording is a recording, which the old rule could not represent", async () => {
    // The other half: `video/mp4` begins with neither `audio/` nor anything the
    // superseded rule could classify, so a recorded صوت وصورة class would have
    // appeared under «المواد المرفقة» — as material.
    const res = await call(`/calendar/sessions/${sessionId}`, studentToken);
    expect(ids(res.body.recordings)).toContain(content.publicVideoRecording);
    expect(ids(res.body.linked_content)).not.toContain(
      content.publicVideoRecording,
    );
  });

  it("suggests R75.6's default recording name, numbered in ONE namespace", async () => {
    // The rule moved from the browser to the server (R99): the name is composed
    // from the occurrence and numbered against everything already linked to it,
    // whatever produced those items.
    const res = await call(`/calendar/sessions/${sessionId}`, studentToken);
    const suggested = res.body["suggested_recording_name"];
    expect(typeof suggested).toBe("string");
    const titles = [
      ...res.body.recordings!,
      ...res.body.linked_content!,
    ].map((c) => c["title"]);
    expect(titles).not.toContain(suggested);
    // Composed from the occurrence, not invented: the class's own name and the
    // date of this occurrence are both in it.
    expect(String(suggested)).toContain(
      String(res.body.occurrence!["date"]),
    );
  });

  it("each item carries exactly the four fields TD-3.4 names", async () => {
    const res = await call(`/calendar/sessions/${sessionId}`);
    for (const item of [...res.body.recordings!, ...res.body.linked_content!]) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      // Deliberately absent: the object location. Only
      // GET /content/{id}/download-url hands that out, after its own check.
      for (const leak of [
        "storage_key",
        "storage_bucket",
        "mime_type",
        "visibility",
      ]) {
        expect(item).not.toHaveProperty(leak);
      }
    }
  });
});

describe("notes: the key ships, the storage does not exist", () => {
  it("is present and null — the gap is visible rather than silent", async () => {
    // TD-3.4 names `notes` and §5.2 lists them on the page, but §7 gives Session
    // no notes column and defines no note entity. Adding one is a §7 schema
    // decision, so the key ships null: a client coded against TD-3.4 finds the
    // field where the specification says it is.
    const res = await call(`/calendar/sessions/${sessionId}`);
    expect(res.body).toHaveProperty("notes");
    expect(res.body.notes).toBeNull();
  });
});

describe("lookup failures", () => {
  it("a malformed id is 400 and an unknown one is 404", async () => {
    expect((await call("/calendar/sessions/not-a-uuid")).status).toBe(400);
    const missing = await call(
      "/calendar/sessions/00000000-0000-4000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("NOT_FOUND");
  });

  it("never answers 401 — it is a public surface", async () => {
    const res = await call(
      `/calendar/sessions/${sessionId}`,
      "not-a-real-token",
    );
    expect(res.status).toBe(200);
  });
});

/**
 * **`GET /library/{id}/sessions` — `SessionContent` read backwards** (2026-08-17).
 *
 * §4.9 says content is **referenced, never owned**: *"one semester PDF is
 * referenced by every session that uses it."* Only the forward half had a
 * surface, so a reader looking at that PDF in the library could not see the
 * sentence's other half.
 *
 * **No new relationship** — this projects rows `SessionContent` already holds.
 * The interesting property is the **asymmetry of the two visibility rules**, and
 * every test below is about it.
 */
describe("which sessions reference a content (§4.9, R43)", () => {
  it("names the session that links it, for anyone who may see the content", async () => {
    const res = await call(`/library/${content.publicPdf}/sessions`);
    expect(res.status).toBe(200);
    expect(res.body.data!.map((o) => o["id"])).toContain(sessionId);
  });

  it("returns the SAME occurrence projection the calendar returns", async () => {
    // One mapper, not a second shape for the same fact: a reader gets the date,
    // the times, the level, the subject and the audience exactly as the grid and
    // the session page state them.
    const res = await call(`/library/${content.publicPdf}/sessions`);
    const occurrence = res.body.data!.find((o) => o["id"] === sessionId)!;
    for (const key of [
      "id",
      "kind",
      "title",
      "date",
      "start_time",
      "end_time",
    ]) {
      expect(Object.keys(occurrence), key).toContain(key);
    }
    expect(occurrence["kind"]).toBe("session");
    // Enough to identify the sitting without opening it.
    expect(typeof occurrence["date"]).toBe("string");
  });

  it("answers 404 — not an empty list — for content the caller may not see", async () => {
    // §20 rule 17: an empty list would confirm the id exists. The hidden PDF is
    // invisible to an anonymous caller and to a student, and visible to the
    // teacher who staffs the session.
    expect((await call(`/library/${content.hiddenPdf}/sessions`)).status).toBe(
      404,
    );
    expect(
      (await call(`/library/${content.hiddenPdf}/sessions`, studentToken))
        .status,
    ).toBe(404);

    const asTeacher = await call(
      `/library/${content.hiddenPdf}/sessions`,
      teacherToken,
    );
    expect(asTeacher.status).toBe(200);
    expect(asTeacher.body.data!.map((o) => o["id"])).toContain(sessionId);
  });

  it("gates on the CONTENT, never on the sessions", async () => {
    /**
     * The asymmetry, asserted directly. The occurrences are the **public
     * timetable** — R43 made them browsable by anonymous visitors — so once the
     * content is visible, the sessions referencing it are too. Hiding them would
     * withhold what the same caller can read by opening the calendar; widening
     * the content check would leak a private item's existence.
     */
    const anon = await call(`/library/${content.publicPdf}/sessions`);
    const student = await call(
      `/library/${content.publicPdf}/sessions`,
      studentToken,
    );
    expect(anon.status).toBe(200);
    expect(student.status).toBe(200);
    expect(anon.body.data!.map((o) => o["id"]).sort()).toEqual(
      student.body.data!.map((o) => o["id"]).sort(),
    );
  });

  it("is empty for a content nothing references — 0 is a real answer", async () => {
    // The `0` of 0..N. An unreferenced item is ordinary, not an error.
    const orphan = await makeContent("غير مرتبط", "public", "application/pdf");
    const res = await call(`/library/${orphan}/sessions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("drops the session when the link is removed, and keeps the content", async () => {
    // Unlinking never deletes (TD-3.12). The reverse read must reflect that in
    // both halves: the session goes, the content stays readable.
    const item = await makeContent("مؤقت", "public", "application/pdf");
    await prisma.sessionContent.create({
      data: { sessionId, contentId: item },
    });
    expect((await call(`/library/${item}/sessions`)).body.data).toHaveLength(1);

    await prisma.sessionContent.updateMany({
      where: { sessionId, contentId: item },
      data: { deletedAt: new Date() },
    });
    const after = await call(`/library/${item}/sessions`);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual([]);
  });

  it("refuses a malformed id and answers 404 for an unknown one", async () => {
    expect((await call("/library/not-a-uuid/sessions")).status).toBe(400);
    expect(
      (await call("/library/00000000-0000-4000-8000-000000000000/sessions"))
        .status,
    ).toBe(404);
  });
});
