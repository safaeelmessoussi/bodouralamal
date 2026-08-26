import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **The association's own scenario, end to end** (Document Owner, 2026-08-18).
 *
 * > المرأة → وميض الأمل → تفسير, every Monday 15:00–17:00, at تاركة in القاعة 5,
 * > with صفاء and أمينة enrolled — then the schedule, its occurrences, and what
 * > each student's calendar shows.
 *
 * ## Why this exists beside the per-feature suites
 *
 * Every step below is already covered somewhere: taxonomy, enrolment, scheduling,
 * materialization and the calendar each have their own file, and each passes.
 * What none of them asks is whether the steps **compose** — whether the Level a
 * screen created is the Level the schedule targets, whether the group a student
 * joined is the audience the occurrence resolves to, and whether the calendar a
 * beneficiary opens contains the class an administrator set up an hour earlier.
 *
 * That is a different question from *does each part work*, and it is the one the
 * association actually asks. It is written with the real names deliberately: a
 * failure here reads as *«صفاء لا ترى حصة التفسير»* rather than as an assertion
 * index, which is what makes it actionable by the person who reported it.
 *
 * Requires the compose stack:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[scenario]";
const YEAR_LABEL = "2096-2097";

/** A future Monday and a stable query window around it. Keeping the Owner's
 * scenario relative prevents this integration proof from silently expiring
 * when its once-future 2026-08-24 occurrence moves behind materialization's
 * today boundary. */
const DAY_MS = 86_400_000;
const today = new Date();
const utcToday = new Date(
  Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
);
const anchor = new Date(utcToday.getTime() + 14 * DAY_MS);
const cancelled = new Date(
  anchor.getTime() + ((8 - anchor.getUTCDay()) % 7) * DAY_MS,
);
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const CANCELLED_DATE = isoDate(cancelled);
const FROM = isoDate(new Date(cancelled.getTime() - 21 * DAY_MS));
const TO = isoDate(new Date(cancelled.getTime() + 42 * DAY_MS));

interface Row {
  id: string;
  title: string;
  instructors?: { display_name: string }[];
  date: string;
  start_time: string;
  end_time: string;
  status?: string;
  subject_name?: string | null;
  branch_name?: string | null;
  room_name?: string | null;
  audience_label?: string | null;
}

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string };
    data?: Row[];
    schedule?: { id: string };
  };
}

const call = (
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> =>
  httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });

/**
 * The id of whatever was just created.
 *
 * **The envelope is not uniform across these endpoints** — `POST /admin/branches`
 * answers with the branch DTO at the top level while `POST /admin/categories`
 * wraps it in `data` — so this reads either rather than encoding one screen's
 * luck. That inconsistency is a real finding, recorded here rather than worked
 * around silently in five places.
 */
const createdId = (res: Res): string => {
  const body = res.body as Record<string, unknown>;
  const payload = (body["data"] ?? body) as Record<string, unknown>;
  const id = payload["id"];
  if (typeof id !== "string")
    throw new Error(`no id in ${JSON.stringify(body).slice(0, 200)}`);
  return id;
};

const bearer = (
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string =>
  issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superAdmin: string;
let safaToken: string;
let aminaToken: string;
let outsiderToken: string;
let teacherToken: string;
let assistantToken: string;
let branchId: string;
let roomId: string;
let categoryId: string;
let levelId: string;
let subjectId: string;
let groupId: string;
let academicYearId: string;
let scheduleId: string;

/**
 * `sex` is set on every beneficiary here, and that is part of the scenario
 * rather than fixture noise: فئة المرأة's Level is `girls_only`, and R27 makes
 * enrolment treat a NULL `sex` as **not eligible** — a restriction nothing could
 * enforce would be a restriction in name only.
 */
const person = async (
  label: string,
  sex: "female" | "male" | null = "female",
): Promise<string> =>
  (
    await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} ${label}`,
        accountStatus: "active",
        ...(sex === null ? {} : { sex }),
      },
    })
  ).id;

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  await prisma.notification.deleteMany({
    where: { session: { scheduleId: { in: ids } } },
  });
  await prisma.sessionStaff.deleteMany({
    where: { session: { scheduleId: { in: ids } } },
  });
  await prisma.session.deleteMany({ where: { scheduleId: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: ids } },
  });
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
  }
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: ids } },
  });

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.administrativeGroup.deleteMany({
    where: { levelId: { in: levelIds } },
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
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
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
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  superAdmin = bearer(await person("مديرة", null), [
    { role: "super_admin", branches: null },
  ]);
  academicYearId = (
    await prisma.academicYear.create({ data: { label: YEAR_LABEL } })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** Every occurrence of this scenario's class, in date order. */
async function occurrences(token?: string): Promise<Row[]> {
  const res = await call("GET", `/calendar?from=${FROM}&to=${TO}`, token);
  expect(res.status).toBe(200);
  return (res.body.data ?? [])
    .filter((r) => r.title?.startsWith(TAG))
    .sort((a, b) => a.date.localeCompare(b.date));
}

describe("the scenario, step by step — each step through the API a screen uses", () => {
  it("1 · the structure: فئة المرأة → مستوى وميض الأمل, teaching مادة التفسير", async () => {
    const category = await call("POST", "/admin/categories", superAdmin, {
      name: `${TAG} المرأة`,
    });
    expect(category.status).toBe(201);
    categoryId = createdId(category);

    const level = await call("POST", "/admin/levels", superAdmin, {
      name: `${TAG} وميض الأمل`,
      category_id: categoryId,
      gender_restriction: "girls_only",
    });
    expect(level.status).toBe(201);
    levelId = createdId(level);

    const subject = await call("POST", "/admin/subjects", superAdmin, {
      name: `${TAG} تفسير القرآن`,
    });
    expect(subject.status).toBe(201);
    subjectId = createdId(subject);

    // §4.4b — a Level teaches a Subject only once the pairing is made. Without
    // it the schedule below must be refused, which is the next step's guard.
    // Idempotent in effect, and it answers `204` — there is no new resource to
    // return, only a pairing that now holds.
    expect(
      (
        await call(
          "PUT",
          `/admin/levels/${levelId}/subjects/${subjectId}`,
          superAdmin,
        )
      ).status,
    ).toBe(204);
  });

  it("2 · the premises: فرع تاركة with القاعة 5", async () => {
    const branch = await call("POST", "/admin/branches", superAdmin, {
      name: `${TAG} تاركة`,
    });
    expect(branch.status).toBe(201);
    branchId = createdId(branch);

    const room = await call(
      "POST",
      `/admin/branches/${branchId}/rooms`,
      superAdmin,
      {
        name: `${TAG} القاعة 5`,
      },
    );
    expect(room.status).toBe(201);
    roomId = createdId(room);
  });

  it("3 · the group, and صفاء and أمينة enrolled in it", async () => {
    const group = await call(
      "POST",
      "/admin/administrative-groups",
      superAdmin,
      {
        name: `${TAG} المجموعة 1`,
        level_id: levelId,
        branch_id: branchId,
      },
    );
    expect(group.status).toBe(201);
    groupId = createdId(group);

    for (const name of ["مستفيدة أولى", "مستفيدة ثانية"]) {
      const studentId = await person(name);
      const enrolled = await call(
        "POST",
        `/admin/administrative-groups/${groupId}/roster`,
        superAdmin,
        { student_id: studentId },
      );
      expect(enrolled.status, name).toBe(201);
      const token = bearer(studentId, [{ role: "student", branches: null }]);
      if (name === "مستفيدة أولى") safaToken = token;
      else aminaToken = token;
    }
    // Enrolled in nothing — the control for the notification assertions.
    outsiderToken = bearer(await person("زائرة"), [
      { role: "student", branches: null },
    ]);
  });

  it("4 · the schedule: every Monday, 15:00–17:00, in that room, with its staff", async () => {
    // §4.4c — a Teacher's whole reach is derived from the schedules she staffs,
    // so صفاء and أمينة are STAFF here and not enrolled people.
    const safaId = await person("صفاء", null);
    const aminaId = await person("أمينة", null);
    teacherToken = bearer(safaId, [{ role: "teacher", branches: null }]);
    assistantToken = bearer(aminaId, [{ role: "teacher", branches: null }]);

    const created = await call("POST", "/admin/course-schedules", superAdmin, {
      staff: [
        { user_id: safaId, position: "teacher" },
        { user_id: aminaId, position: "assistant" },
      ],
      title: `${TAG} حلقة التفسير`,
      subject_id: subjectId,
      teaching_mode: "administrative_group",
      target_id: groupId,
      branch_id: branchId,
      room_id: roomId,
      start_time: "15:00",
      end_time: "17:00",
      recurrence: "weekly",
      weekdays: ["monday"],
      academic_year_id: academicYearId,
    });
    expect(created.status).toBe(201);
    scheduleId = created.body.schedule!.id;
  });

  it("5 · the occurrences are MATERIALIZED rows, every one a Monday", async () => {
    // TD-4.6c — a Session is a real row, not a rule evaluated at read time. That
    // is what lets one occurrence be cancelled without touching the series.
    const rows = await prisma.session.findMany({
      where: { scheduleId, deletedAt: null },
      select: { date: true },
      orderBy: { date: "asc" },
    });
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      // 1 = Monday.
      expect(row.date.getUTCDay(), row.date.toISOString().slice(0, 10)).toBe(1);
    }
    expect(
      rows.some((r) => r.date.toISOString().slice(0, 10) === CANCELLED_DATE),
    ).toBe(true);
  });

  it("6 · صفاء’s calendar carries the class, with its room, branch and audience", async () => {
    const rows = await occurrences(safaToken);
    expect(rows.length).toBeGreaterThan(3);
    const monday = rows.find((r) => r.date === CANCELLED_DATE)!;
    // Wall-clock, never an instant (TD-11): 15:00 stays 15:00 across the Ramadan
    // DST shift, which is the whole reason for the type.
    expect(monday.start_time).toBe("15:00");
    expect(monday.end_time).toBe("17:00");
    expect(monday.subject_name).toContain("تفسير");
    expect(monday.room_name).toContain("القاعة 5");
    expect(monday.branch_name).toContain("تاركة");
    // R43 — who the class is FOR, carried beside the class rather than buried in
    // its description.
    expect(monday.audience_label).toContain("المجموعة 1");
  });

  it("7 · أمينة sees the same class — and so does everyone, which is the design", async () => {
    expect((await occurrences(aminaToken)).length).toBeGreaterThan(3);

    /**
     * **The timetable is public** (§4.4 as amended by Revision 43): an anonymous
     * visitor browses the occurrences, and any approved student sees them
     * whether or not she is enrolled — the private tier is deliberately not
     * filtered by the student's own branch, which §4.4 records as Risk R-6.
     *
     * Both are pinned here on purpose. They are the exact facts a reader of this
     * scenario would otherwise assume the other way round, and the day somebody
     * narrows either, this file reports it as a change to the *business
     * scenario* rather than as a distant assertion failing for reasons nobody
     * connects back to the decision.
     *
     * **What is NOT public is the notification.** It is addressed to the
     * resolved audience rather than published to a tier, which is precisely the
     * distinction R77 adds — and the section below asserts it.
     */
    expect((await occurrences()).length).toBeGreaterThan(3);
    expect((await occurrences(outsiderToken)).length).toBeGreaterThan(3);
  });

  it("8 · the staff see it too, and every occurrence carries its own context", async () => {
    /**
     * **The occurrences reach the staffing side from the SAME rows.**
     *
     * There is no teacher-specific event and no student-specific one: one
     * materialized `Session` set serves every calendar, and a second projection
     * for staff would be the parallel model §20 rule 22 forbids. What differs
     * between readers is the §4.4 tier, never the source.
     *
     * The context assertions are the other half: an occurrence a مؤطرة opens
     * has to say *where* and *with whom*, and R36.1 carries the resolved names
     * beside it so an event dialog opens with no further request.
     */
    for (const [who, token] of [
      ["صفاء (main teacher)", teacherToken],
      ["أمينة (assistant)", assistantToken],
    ] as const) {
      const rows = await occurrences(token);
      expect(rows.length, who).toBeGreaterThan(3);
      const monday = rows.find((r) => r.date === CANCELLED_DATE)!;
      expect(monday, who).toBeDefined();
      expect(monday.start_time, who).toBe("15:00");
      expect(monday.end_time, who).toBe("17:00");
      expect(monday.room_name, who).toContain("القاعة 5");
      expect(monday.branch_name, who).toContain("تاركة");
      expect(monday.subject_name, who).toContain("تفسير");
      // Both are named, and R36.1 resolves the display name server-side — a
      // client that fell back to a full name would leak one nobody published.
      const named = (monday.instructors ?? [])
        .map((i) => i.display_name)
        .join(" | ");
      expect(named, who).toContain("صفاء");
      expect(named, who).toContain("أمينة");
    }
  });
});

describe("cancelling ONE Monday leaves the series alone", () => {
  let cancelledId: string;

  it("cancels one future Monday for «الأستاذة مريضة», and nothing else changes", async () => {
    const target = await prisma.session.findFirstOrThrow({
      where: { scheduleId, date: new Date(`${CANCELLED_DATE}T00:00:00.000Z`) },
      select: { id: true, version: true },
    });
    cancelledId = target.id;

    const res = await call(
      "POST",
      `/sessions/${target.id}/cancel`,
      superAdmin,
      {
        reason: "الأستاذة مريضة",
        version: target.version,
      },
    );
    expect(res.status).toBe(200);

    // The recurring schedule is untouched — cancelling one occurrence is not
    // ending a class, and conflating them is the failure this asserts against.
    const schedule = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { deletedAt: true },
    });
    expect(schedule.deletedAt).toBeNull();
    const stillScheduled = await prisma.session.count({
      where: { scheduleId, status: "scheduled", deletedAt: null },
    });
    expect(stillScheduled).toBeGreaterThan(2);
  });

  /**
   * **Restated by R83.1, and the direction reversed deliberately.**
   *
   * This asserted that the cancelled Monday still SHOWS, marked — on the
   * reasoning that hiding it answers *is there a class* while the reader asks
   * *what happened to my class*. The Owner decided the opposite: a calendar
   * shows what is **on**, and a class that is not happening is not on. The
   * reader's question is answered by the **notification**, which is where the
   * news belongs and which R77 exists to deliver.
   *
   * The guard is kept because the risk is unchanged — that a cancellation
   * silently takes the whole series with it — and that half is asserted below.
   */
  it("REMOVES the cancelled Monday from the calendar (R83.1)", async () => {
    const monday = (await occurrences(safaToken)).find(
      (r) => r.date === CANCELLED_DATE,
    );
    expect(monday).toBeUndefined();
  });

  it("and the row is still there, cancelled — hidden from the calendar, not deleted", async () => {
    // The distinction R83.1 turns on: the occurrence keeps its state, its
    // reason and its history, and restoring it brings it back.
    // By ID, not by date: other suites materialise sessions on the same day,
    // and identifying a row by rendered date is the trap this project has paid
    // for before.
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: cancelledId },
      select: { status: true, deletedAt: true },
    });
    expect(row.status).toBe("cancelled");
    expect(row.deletedAt).toBeNull();
  });

  /**
   * **R83.3 — cancelling tells nobody until somebody decides to tell them.**
   *
   * R77.4 wrote the notices inside the cancelling transaction; the Owner made
   * the send an explicit choice, so the cancellation alone leaves every inbox
   * empty. This asserts that first — the half that used not to exist — and then
   * the send, which is where the original property still lives.
   */
  it("tells NOBODY on cancellation alone (R83.3)", async () => {
    for (const token of [safaToken, aminaToken]) {
      const res = await call("GET", "/notifications", token);
      const mine = (
        res.body.data as unknown as Record<string, unknown>[]
      ).filter((n) => n["session_id"] === cancelledId);
      expect(mine).toHaveLength(0);
    }
  });

  it("tells صفاء and أمينة when the send is chosen, and nobody else", async () => {
    const sent = await call("POST", `/sessions/${cancelledId}/notify`, superAdmin, {
      change: "cancelled",
    });
    expect(sent.status).toBe(200);

    for (const token of [safaToken, aminaToken]) {
      const res = await call("GET", "/notifications", token);
      const mine = (
        res.body.data as unknown as Record<string, unknown>[]
      ).filter((n) => n["session_id"] === cancelledId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!["reason"]).toBe("الأستاذة مريضة");
    }
    const outsider = await call("GET", "/notifications", outsiderToken);
    expect(
      outsider.body.data as unknown as Record<string, unknown>[],
    ).toHaveLength(0);
  });

  it("restores it, and the calendar and the notices both come back into line", async () => {
    const before = await prisma.session.findUniqueOrThrow({
      where: { id: cancelledId },
      select: { version: true },
    });
    expect(
      (
        await call("POST", `/sessions/${cancelledId}/restore`, superAdmin, {
          version: before.version,
        })
      ).status,
    ).toBe(200);

    const monday = (await occurrences(safaToken)).find(
      (r) => r.date === CANCELLED_DATE,
    )!;
    expect(monday.status).toBe("scheduled");

    // Neither student had read hers, so both notices are withdrawn: an unread
    // notice of something no longer true is worth nothing (R77.5).
    for (const token of [safaToken, aminaToken]) {
      const res = await call("GET", "/notifications", token);
      expect(
        (res.body.data as unknown as Record<string, unknown>[]).filter(
          (n) => n["session_id"] === cancelledId,
        ),
      ).toHaveLength(0);
    }
  });
});
