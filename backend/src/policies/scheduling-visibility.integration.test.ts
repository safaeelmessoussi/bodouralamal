import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  readCalendar,
  readSessionPage,
  type CalendarActor,
} from "../services/calendar.service.js";
import {
  createCourseSchedule,
  updateCourseSchedule,
} from "../services/course-schedule.service.js";
import { overrideSession } from "../services/session.service.js";
import { horizonFor } from "../services/session-materialize.service.js";
import type { RoleScope } from "./branch-scope.js";

/**
 * **SRS Revision 109 — the visibility tier, on all three kinds of scheduling
 * item** (NEW B §C).
 *
 * Three separate claims are asserted here, because R109 makes three separate
 * promises and each could hold while another silently broke:
 *
 * 1. **The read matrix.** Who sees a `public`, `private` and `hidden` item of
 *    each kind — and, just as importantly, who does *not*. The negative halves
 *    are what make the positive ones mean anything, so every actor asserts both.
 * 2. **The narrowing is real.** §4.4 gave every Admin every hidden Event. R109
 *    withdraws that, and the test that proves it is an Admin who can no longer
 *    see one — a test that would have passed before the revision is not a test
 *    of the revision.
 * 3. **The recurrence integration.** The tier travels schedule → occurrence
 *    exactly as `room_id` and `delivery_mode` do: snapshotted at
 *    materialization, resynced on future un-protected occurrences, and **never**
 *    on an overridden one.
 *
 * Requires the compose stack's database:
 *   bash scripts/dev/test-integration.sh src/policies/scheduling-visibility.integration.test.ts
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[r109-visibility-test]";

const AT_9 = new Date(Date.UTC(1970, 0, 1, 9, 0, 0));
const AT_10 = new Date(Date.UTC(1970, 0, 1, 10, 0, 0));
/** Far enough out that no fixture or seeded row shares the window. */
const FROM = new Date("2097-03-01T00:00:00.000Z");
const TO = new Date("2097-03-31T00:00:00.000Z");
const ON = new Date("2097-03-10T00:00:00.000Z");

type Tier = "public" | "private" | "hidden";
const TIERS: Tier[] = ["public", "private", "hidden"];

let branchA: string;
let branchB: string;
let categoryId: string;
let levelId: string;
let subjectId: string;
let academicYearId: string;
let groupA: string;
/** `exam_physical_place_all_or_none_check` — a physical sitting states branch,
 *  room and both clock bounds together or none of them (R58). */
let roomA: string;

let sessionIds: Record<Tier, string>;
let examIds: Record<Tier, string>;

/** Every principal the matrix distinguishes. */
let mainTeacher: string;
let assistant: string;
let otherTeacher: string;
let supervisor: string;
let eventOwner: string;
let adminAId: string;
let adminBId: string;
let superAdminId: string;
let studentId: string;

const actor = (
  userId: string,
  roleScopes: RoleScope[],
  accountStatus = "active",
): CalendarActor => ({
  userId,
  roles: roleScopes.map((s) => s.role),
  roleScopes,
  accountStatus,
});

async function person(label: string): Promise<string> {
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

/** The tiers this actor can actually read, of one kind, in the window. */
async function tiersSeen(
  who: CalendarActor | null,
  kind: "session" | "exam" | "event",
): Promise<Tier[]> {
  const rows = await readCalendar(prisma, who, { from: FROM, to: TO, kind });
  return [
    ...new Set(
      rows
        .filter((r) => r.title.startsWith(TAG))
        .map((r) => r.visibility as Tier),
    ),
  ].sort();
}

beforeAll(async () => {
  await clear();

  branchA = (
    await prisma.branch.create({
      data: {
        name: `${TAG} فرع أ`,
        operationalStartDate: new Date("2026-01-01"),
      },
    })
  ).id;
  branchB = (
    await prisma.branch.create({
      data: {
        name: `${TAG} فرع ب`,
        operationalStartDate: new Date("2026-01-01"),
      },
    })
  ).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } }))
    .id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: "any" },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } }))
    .id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: branchA },
    })
  ).id;
  roomA = (
    await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: branchA, capacity: 20 },
    })
  ).id;
  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
  ).id;

  mainTeacher = await person("مؤطرة أساسية");
  assistant = await person("مساعدة");
  otherTeacher = await person("مؤطرة أخرى");
  supervisor = await person("مراقبة");
  eventOwner = await person("مسؤولة نشاط");
  adminAId = await person("إدارية أ");
  adminBId = await person("إدارية ب");
  superAdminId = await person("مديرة عامة");
  studentId = await person("مستفيدة");

  // ── One schedule per tier, each with the SAME staffing, so the only thing
  //    that differs between the three rows is the tier itself.
  sessionIds = {} as Record<Tier, string>;
  for (const tier of TIERS) {
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة ${tier}`,
        subjectId,
        teachingMode: "administrative_group",
        administrativeGroupId: groupA,
        branchId: branchA,
        startTime: AT_9,
        endTime: AT_10,
        recurrence: "weekly",
        weekdays: ["wednesday"],
        academicYearId,
        visibility: tier,
      },
    });
    const session = await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: ON,
        startTime: AT_9,
        endTime: AT_10,
        visibility: tier,
      },
    });
    // The occurrence's OWN snapshot (R43.4) — which is what R109 resolves the
    // hidden owner from, and why the date never has to be compared here.
    await prisma.sessionStaff.createMany({
      data: [
        { sessionId: session.id, userId: mainTeacher, position: "teacher" },
        { sessionId: session.id, userId: assistant, position: "assistant" },
      ],
    });
    sessionIds[tier] = session.id;
  }

  // ── One exam per tier, one supervisor on each.
  examIds = {} as Record<Tier, string>;
  for (const tier of TIERS) {
    const exam = await prisma.exam.create({
      data: {
        title: `${TAG} امتحان ${tier}`,
        mode: "physical",
        levelId,
        subjectId,
        academicYearId,
        branchId: branchA,
        roomId: roomA,
        date: ON,
        startTime: AT_9,
        endTime: AT_10,
        maxGrade: 20,
        visibility: tier,
      },
    });
    await prisma.examStaff.create({
      data: { examId: exam.id, userId: supervisor, position: "supervisor" },
    });
    examIds[tier] = exam.id;
  }

  // ── One event per tier, one responsible on each.
  for (const tier of TIERS) {
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط ${tier}`,
        visibility: tier,
        startDate: ON,
        startTime: AT_9,
        recurrenceType: "none",
      },
    });
    await prisma.eventStaff.create({
      data: { eventId: event.id, userId: eventOwner, position: "responsible" },
    });
  }
});

async function clear(): Promise<void> {
  const tagged = { startsWith: TAG };
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: tagged },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  const sessions = await prisma.session.findMany({
    where: { scheduleId: { in: scheduleIds } },
    select: { id: true },
  });
  const ids = sessions.map((s) => s.id);
  await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: ids } } });
  await prisma.sessionContent.deleteMany({ where: { sessionId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { sessionId: { in: ids } } });
  await prisma.session.deleteMany({ where: { id: { in: ids } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: scheduleIds } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: scheduleIds } },
  });

  const exams = await prisma.exam.findMany({
    where: { title: tagged },
    select: { id: true },
  });
  const examRowIds = exams.map((e) => e.id);
  await prisma.examStaff.deleteMany({ where: { examId: { in: examRowIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examRowIds } } });

  const events = await prisma.event.findMany({
    where: { title: tagged },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.notification.deleteMany({
    where: { eventId: { in: eventIds } },
  });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  await prisma.enrollment.deleteMany({
    where: { administrativeGroup: { name: tagged } },
  });
  await prisma.administrativeGroup.deleteMany({ where: { name: tagged } });
  await prisma.room.deleteMany({ where: { name: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: { name: tagged } } });
  await prisma.subject.deleteMany({ where: { name: tagged } });
  await prisma.level.deleteMany({ where: { name: tagged } });
  await prisma.category.deleteMany({ where: { name: tagged } });

  const users = await prisma.user.findMany({
    where: { nameArabic: tagged },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { subjectUserId: { in: userIds } }] },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: tagged } });
}

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/* ── 1. حصة — the read matrix ───────────────────────────────────────────── */

describe("a class occurrence is read at the caller's tier (R109)", () => {
  it("shows an anonymous visitor the public timetable and nothing else", async () => {
    expect(await tiersSeen(null, "session")).toEqual(["public"]);
  });

  it("gives a PENDING account exactly what an anonymous visitor gets", async () => {
    // TD-1: the account exists and grants nothing. Asserted rather than assumed,
    // because "signed in" and "approved" are two different facts.
    const pending = actor(studentId, [], "pending");
    expect(await tiersSeen(pending, "session")).toEqual(["public"]);
  });

  it("shows an approved beneficiary public and private, never hidden", async () => {
    // Active is only lifecycle state; the structural Student role is what
    // distinguishes a beneficiary from an active role-less account.
    expect(
      await tiersSeen(actor(studentId, [{ role: "student", branches: null }]), "session"),
    ).toEqual([
      "private",
      "public",
    ]);
  });

  it("shows the occurrence's OWN main teacher its hidden tier", async () => {
    const she = actor(mainTeacher, [
      { role: "teacher", branches: [branchA] },
    ]);
    expect(await tiersSeen(she, "session")).toEqual([
      "hidden",
      "private",
      "public",
    ]);
  });

  it("does NOT show the hidden tier to an assistant on the same occurrence", async () => {
    // R87 §G makes an assistant the main teacher for *operational* authorization
    // on her class. `hidden` is not an operation — it is who the item belongs
    // to — and the Owner named `position = 'teacher'`. The asymmetry is
    // deliberate, so it is pinned rather than left to be re-derived.
    const she = actor(assistant, [{ role: "teacher", branches: [branchA] }]);
    expect(await tiersSeen(she, "session")).toEqual(["private", "public"]);
  });

  it("does NOT show the hidden tier to another teacher at the same branch", async () => {
    const she = actor(otherTeacher, [
      { role: "teacher", branches: [branchA] },
    ]);
    expect(await tiersSeen(she, "session")).toEqual(["private", "public"]);
  });

  it("does NOT show the hidden tier to an Admin who does not teach it", async () => {
    const she = actor(adminAId, [{ role: "admin", branches: [branchA] }]);
    expect(await tiersSeen(she, "session")).toEqual(["private", "public"]);
  });

  it("bounds an Admin's PRIVATE tier by her own branches (§4.4)", async () => {
    // Branch B reaches nothing here, so she is left with the public tier alone —
    // the negative half that proves the branch bound is doing work.
    const she = actor(adminBId, [{ role: "admin", branches: [branchB] }]);
    expect(await tiersSeen(she, "session")).toEqual(["public"]);
  });

  it("shows a Super Admin every tier", async () => {
    const she = actor(superAdminId, [{ role: "super_admin", branches: null }]);
    expect(await tiersSeen(she, "session")).toEqual([
      "hidden",
      "private",
      "public",
    ]);
  });
});

/* ── 2. امتحان ──────────────────────────────────────────────────────────── */

describe("a sitting is read at the caller's tier (R109, superseding §4.6)", () => {
  it("shows an anonymous visitor only the public sitting", async () => {
    expect(await tiersSeen(null, "exam")).toEqual(["public"]);
  });

  it("shows its supervisor the hidden sitting", async () => {
    const she = actor(supervisor, [{ role: "teacher", branches: [branchA] }]);
    expect(await tiersSeen(she, "exam")).toEqual([
      "hidden",
      "private",
      "public",
    ]);
  });

  it("hides it from another teacher and from an Admin who does not supervise", async () => {
    const other = actor(otherTeacher, [
      { role: "teacher", branches: [branchA] },
    ]);
    const admin = actor(adminAId, [{ role: "admin", branches: [branchA] }]);
    expect(await tiersSeen(other, "exam")).toEqual(["private", "public"]);
    expect(await tiersSeen(admin, "exam")).toEqual(["private", "public"]);
  });

  it("shows a Super Admin every tier", async () => {
    const she = actor(superAdminId, [{ role: "super_admin", branches: null }]);
    expect(await tiersSeen(she, "exam")).toEqual([
      "hidden",
      "private",
      "public",
    ]);
  });
});

/* ── 3. نشاط — the one place R109 REMOVES reach ─────────────────────────── */

describe("R109 narrows the hidden Event tier — and that is the point", () => {
  it("no longer shows a branch-scoped Admin a hidden activity", async () => {
    // §4.4 said *"and to ALL Admins regardless of branch scope"*. This assertion
    // fails on the pre-R109 filter, which is what makes it a test of the change
    // rather than of the code around it.
    const she = actor(adminAId, [{ role: "admin", branches: [branchA] }]);
    expect(await tiersSeen(she, "event")).not.toContain("hidden");
  });

  it("no longer shows an ALL-BRANCHES Admin a hidden activity either", async () => {
    // The pre-R109 filter short-circuited to `{}` for this caller, returning
    // every hidden Event in the platform. That path is gone.
    const she = actor(adminAId, [{ role: "admin", branches: null }]);
    expect(await tiersSeen(she, "event")).not.toContain("hidden");
  });

  it("shows the responsible مؤطرة the hidden activity she answers for", async () => {
    const she = actor(eventOwner, [{ role: "teacher", branches: [branchA] }]);
    expect(await tiersSeen(she, "event")).toContain("hidden");
  });

  it("still shows a Super Admin every tier", async () => {
    const she = actor(superAdminId, [{ role: "super_admin", branches: null }]);
    expect(await tiersSeen(she, "event")).toEqual([
      "hidden",
      "private",
      "public",
    ]);
  });
});

/* ── 4. The session page answers 404, never 403 ─────────────────────────── */

describe("the §5.2 session page is gated by the same rule", () => {
  it("answers 404 for a hidden occurrence to a caller who may not read it", async () => {
    // A distinguishable refusal would confirm the class exists (§20 rule 17),
    // which is the whole point of the tier. Both an anonymous caller and a
    // scoped Admin get the same answer a nonexistent id gets.
    await expect(
      readSessionPage(prisma, null, sessionIds.hidden),
    ).rejects.toThrow(/no such session/);
    await expect(
      readSessionPage(
        prisma,
        actor(adminAId, [{ role: "admin", branches: [branchA] }]),
        sessionIds.hidden,
      ),
    ).rejects.toThrow(/no such session/);
  });

  it("opens for its own main teacher and for a Super Admin", async () => {
    const she = actor(mainTeacher, [
      { role: "teacher", branches: [branchA] },
    ]);
    await expect(
      readSessionPage(prisma, she, sessionIds.hidden),
    ).resolves.toMatchObject({ occurrence: { visibility: "hidden" } });
    await expect(
      readSessionPage(
        prisma,
        actor(superAdminId, [{ role: "super_admin", branches: null }]),
        sessionIds.hidden,
      ),
    ).resolves.toMatchObject({ occurrence: { visibility: "hidden" } });
  });

  it("still opens the public occurrence for an anonymous visitor", async () => {
    await expect(
      readSessionPage(prisma, null, sessionIds.public),
    ).resolves.toMatchObject({ occurrence: { visibility: "public" } });
  });
});

/* ── 5. The recurrence integration ──────────────────────────────────────── */

describe("the tier travels schedule → occurrence, and an override survives", () => {
  /**
   * **The fixture's clock has to sit inside the current academic year.**
   *
   * `materializeSchedule` runs from `now` to `horizonFor(...)`, which is the end
   * of the current `AcademicYear` (§4.4). The read matrix above uses a far-future
   * window deliberately, to collide with nothing; this block cannot, because a
   * schedule anchored past the horizon materializes **zero** occurrences — which
   * is correct behaviour and a useless fixture. So the dates are derived from the
   * real horizon rather than written down.
   */
  let NOW: Date;
  let SPLIT_ON: Date;
  let scheduleId: string;

  beforeAll(async () => {
    const horizon = await horizonFor(prisma, new Date());
    const day = 86_400_000;
    NOW = new Date(horizon.getTime() - 120 * day);
    SPLIT_ON = new Date(horizon.getTime() - 45 * day);
  });

  const occurrences = () =>
    prisma.session.findMany({
      where: { scheduleId, deletedAt: null },
      select: {
        id: true,
        date: true,
        visibility: true,
        overridden: true,
        version: true,
      },
      orderBy: { date: "asc" },
    });

  const admin = () => ({
    userId: superAdminId,
    roles: ["super_admin"],
    roleScopes: [{ role: "super_admin", branches: null }],
    activeRole: "super_admin",
  });

  it("materializes every occurrence at the schedule's tier", async () => {
    const created = await createCourseSchedule(
      prisma,
      admin(),
      {
        title: `${TAG} حصة متكررة`,
        subjectId,
        teachingMode: "administrative_group",
        targetId: groupA,
        branchId: branchA,
        startTime: AT_9,
        endTime: AT_10,
        recurrence: "weekly",
        weekdays: ["thursday"],
        academicYearId,
        visibility: "hidden",
      },
      NOW,
    );
    scheduleId = created.id;

    const rows = await occurrences();
    expect(rows.length).toBeGreaterThan(0);
    // Every one, not "most" — a snapshot that reached some occurrences and not
    // others is exactly the half-applied edit R43.4's ordering exists to prevent.
    expect(rows.every((r) => r.visibility === "hidden")).toBe(true);
  });

  it("keeps an occurrence-only decision when the schedule is later published", async () => {
    const rows = await occurrences();
    const kept = rows[0]!;
    const swept = rows[1]!;

    await overrideSession(prisma, admin(), kept.id, {
      version: kept.version,
      visibility: "private",
    });

    const afterOverride = await prisma.session.findUniqueOrThrow({
      where: { id: kept.id },
      select: { visibility: true, overridden: true },
    });
    // The flag is the whole protection: it records that a human decided about
    // this date, and it is set by the override rather than inferred from a
    // difference (R43.4).
    expect(afterOverride).toEqual({
      visibility: "private",
      overridden: true,
    });

    await updateCourseSchedule(
      prisma,
      admin(),
      scheduleId,
      { version: 0, visibility: "public" },
      NOW,
    );

    const [keptAfter, sweptAfter] = await Promise.all([
      prisma.session.findUniqueOrThrow({
        where: { id: kept.id },
        select: { visibility: true },
      }),
      prisma.session.findUniqueOrThrow({
        where: { id: swept.id },
        select: { visibility: true },
      }),
    ]);
    // Both halves of the promise in one assertion pair: the untouched occurrence
    // follows the new tier, and the decided-about one does not.
    expect(sweptAfter.visibility).toBe("public");
    expect(keptAfter.visibility).toBe("private");
  });

  it("carries the tier across an R50 split, and lets the split change it", async () => {
    const splitOn = SPLIT_ON;
    const schedule = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { version: true },
    });
    const result = await updateCourseSchedule(
      prisma,
      admin(),
      scheduleId,
      {
        version: schedule.version,
        scope: "this_and_future",
        fromDate: splitOn,
        visibility: "hidden",
      },
      NOW,
    );

    expect(result.successorId).toBeTruthy();
    const successor = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: result.successorId! },
      select: { visibility: true },
    });
    // A successor that did not carry the tier would silently publish the tail of
    // a hidden series; one that could not change it would make the scope prompt
    // unable to express *«hide it from here on»*.
    expect(successor.visibility).toBe("hidden");

    const tail = await prisma.session.findMany({
      where: {
        scheduleId: result.successorId!,
        deletedAt: null,
        date: { gte: splitOn },
      },
      select: { visibility: true },
    });
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((r) => r.visibility === "hidden")).toBe(true);
  });
});
