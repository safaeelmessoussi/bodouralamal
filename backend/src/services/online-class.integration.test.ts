import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import type { Actor } from "../policies/actor.js";
import {
  grantsFor,
  joinWindowFor,
  roomNameForSession,
  tokenSecondsFor,
  windowState,
  JOIN_OPENS_MINUTES_BEFORE,
  JOIN_GRACE_MINUTES_AFTER,
} from "../policies/online-class.js";
import {
  LiveKitOnlineClassProvider,
  createOnlineClassProvider,
  type JoinCredentialRequest,
  type OnlineClassProvider,
} from "../lib/online-class-provider.js";
import { authorizeJoin, joinOnlineClass } from "./online-class.service.js";
import { createLevel } from "./level.service.js";
import { createCourseSchedule } from "./course-schedule.service.js";
import { onlineJoinSchema } from "../validators/session.validators.js";

/**
 * **SRS Revision 98 — entering a class delivered عن بُعد.**
 *
 * The single property every assertion below serves:
 *
 * > **بذور الأمل authorizes; the media provider executes the media session.**
 *
 * Which means the interesting tests here are the **refusals**, and each is
 * written against the *reason it exists* rather than against the code path that
 * currently implements it:
 *
 * 1. **Nobody enters on role membership.** A مؤطِّرة with no effective
 *    assignment, one whose period ended, one whose period has not begun, and one
 *    who merely *declared* she can teach the subject (R88) are all refused —
 *    and each of those four is a different way the platform could have got it
 *    wrong.
 * 2. **The audience resolver is asked, never re-implemented.** R92's
 *    cross-branch override therefore works here with nothing here knowing about
 *    it, and the following ordinary occurrence refuses the same person. That
 *    pair is the whole proof; either half alone proves nothing.
 * 3. **A guardian enters as her child, and gains nothing.** Identity is the
 *    child's; a revoked link and a forged unrelated child are both `404`.
 * 4. **The credential says only what the platform decided.** Room, identity,
 *    permissions and expiry are asserted by decoding the issued JWT — never by
 *    trusting the request that produced it, and never by printing it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[online-join-r98]";

/** A Tuesday, so the weekly schedules below materialize predictably. */
const CLASS_DATE = "2026-06-09";
/** Inside the class itself — 15:00–17:00 on the association's clock. */
const DURING = new Date(`${CLASS_DATE}T15:30:00+01:00`);

const at = (hh: number, mm = 0): Date => new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
/** Materialization runs from "today", so it must precede the class date. */
const NOW = new Date("2026-06-01T08:00:00.000Z");

let adminId: string;
let categoryId: string;
let branchA: string;
let branchB: string;
let levelId: string;
let roomId: string;
let subjectId: string;
let academicYearId: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor => actorOf(adminId, [{ role: "super_admin", branches: null }]);

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string; details?: Record<string, unknown> }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string; details?: Record<string, unknown> };
  }
}

/**
 * **A fake provider, for the ninety per cent of this suite that is about
 * authorization** (R98.15).
 *
 * It records what it was told and mints nothing. The point is not speed: it is
 * that a test asserting *«an expired مؤطِّرة is refused»* must fail for that
 * reason and not because a media server was unreachable. The **real** LiveKit
 * signing path is exercised separately below, and an actual browser join is
 * proved by `verify-livekit-join`, which is where a mock could not.
 */
class RecordingProvider implements OnlineClassProvider {
  requests: JoinCredentialRequest[] = [];
  issueJoinCredentials(request: JoinCredentialRequest): Promise<{
    url: string;
    token: string;
    expiresAt: Date;
  }> {
    this.requests.push(request);
    return Promise.resolve({
      url: "wss://example.invalid",
      token: "fake",
      expiresAt: new Date(Date.now() + request.ttlSeconds * 1000),
    });
  }
}

/* ── Fixture ─────────────────────────────────────────────────────────────── */

async function person(
  label: string,
  roles: { role: string; branchId: string | null }[] = [],
): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  for (const assignment of roles) {
    const role = await prisma.role.findFirstOrThrow({
      where: { name: assignment.role },
      select: { id: true },
    });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: role.id, branchId: assignment.branchId },
    });
  }
  return user.id;
}

/** A weekly whole-Level online class at branch A, and its occurrence on
 *  CLASS_DATE. Whole-Level so the R92 override has meaning (R92 §B7). */
async function onlineClass(
  over: { mediaMode?: "audio_video" | "audio_only" } = {},
): Promise<{ scheduleId: string; sessionId: string }> {
  const { id } = await createCourseSchedule(
    prisma,
    superAdmin(),
    {
      title: `${TAG} تفسير`,
      subjectId,
      teachingMode: "entire_level",
      targetId: levelId,
      branchId: branchA,
      roomId: null,
      startTime: at(15),
      endTime: at(17),
      recurrence: "weekly",
      weekdays: ["tuesday"],
      academicYearId,
      staff: [],
      deliveryMode: "online",
      onlineMediaMode: over.mediaMode ?? "audio_video",
    },
    NOW,
  );
  const session = await prisma.session.findFirstOrThrow({
    where: { scheduleId: id, date: day(CLASS_DATE) },
    select: { id: true },
  });
  return { scheduleId: id, sessionId: session.id };
}

async function inPersonClass(): Promise<{ sessionId: string }> {
  const { id } = await createCourseSchedule(
    prisma,
    superAdmin(),
    {
      title: `${TAG} فقه`,
      subjectId,
      teachingMode: "entire_level",
      targetId: levelId,
      branchId: branchA,
      roomId,
      startTime: at(15),
      endTime: at(17),
      recurrence: "weekly",
      weekdays: ["wednesday"],
      academicYearId,
      staff: [],
    },
    NOW,
  );
  const session = await prisma.session.findFirstOrThrow({
    where: { scheduleId: id },
    orderBy: { date: "asc" },
    select: { id: true },
  });
  return { sessionId: session.id };
}

async function enrol(studentId: string, branchId: string): Promise<void> {
  await prisma.enrollment.create({ data: { studentId, levelId, branchId } });
}

async function staff(
  scheduleId: string,
  userId: string,
  position: "teacher" | "assistant",
  period: { from?: string; until?: string } = {},
): Promise<void> {
  await prisma.courseScheduleStaff.create({
    data: {
      scheduleId,
      userId,
      position,
      effectiveFrom: period.from ? day(period.from) : null,
      effectiveUntil: period.until ? day(period.until) : null,
    },
  });
}

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };
  const scheduleWhere = { schedule: { subject: tagged } };

  await prisma.sessionAudienceBranch.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionContent.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionStaff.deleteMany({ where: { session: scheduleWhere } });
  await prisma.notification.deleteMany({ where: { session: scheduleWhere } });
  await prisma.session.deleteMany({ where: scheduleWhere });
  await prisma.courseScheduleStaff.deleteMany({ where: { schedule: { subject: tagged } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.familyLink.deleteMany({ where: { parent: taggedPerson } });
  await prisma.enrollment.deleteMany({ where: { student: taggedPerson } });
  await prisma.teacherSubjectCapability.deleteMany({ where: { user: taggedPerson } });
  await prisma.teacherCategoryCapability.deleteMany({ where: { user: taggedPerson } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.userBranchRole.deleteMany({ where: { user: taggedPerson } });
  await prisma.auditLog.deleteMany({ where: { actor: taggedPerson } });
  await prisma.user.deleteMany({ where: taggedPerson });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.room.deleteMany({ where: tagged });
  await prisma.branch.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

beforeEach(async () => {
  await cleanup();
  adminId = await person("المسؤولة", [{ role: "super_admin", branchId: null }]);
  categoryId = (await prisma.category.create({ data: { name: `${TAG} النساء` } })).id;
  branchA = (
    await prisma.branch.create({
      data: { name: `${TAG} تاركة`, operationalStartDate: day("2026-01-01") },
    })
  ).id;
  branchB = (
    await prisma.branch.create({
      data: { name: `${TAG} المسيرة`, operationalStartDate: day("2026-01-01") },
    })
  ).id;
  levelId = (
    await createLevel(prisma, superAdmin(), {
      name: `${TAG} المستوى 1`,
      categoryId,
      genderRestriction: "any",
    })
  ).level.id;
  roomId = (await prisma.room.create({ data: { name: `${TAG} قاعة 5`, branchId: branchA } })).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} تفسير` } })).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/* ── The room identity ───────────────────────────────────────────────────── */

describe("room identity is derived, never stored (R98.2)", () => {
  it("is deterministic — the same Session always yields the same room", () => {
    const id = "8f14e45f-ceea-4d0b-9c1e-0e3fbd8b3f21";
    expect(roomNameForSession(id)).toBe(roomNameForSession(id));
  });

  it("differs for two occurrences of the same class", async () => {
    const { scheduleId } = await onlineClass();
    const [first, second] = await prisma.session.findMany({
      where: { scheduleId },
      orderBy: { date: "asc" },
      take: 2,
      select: { id: true },
    });
    expect(roomNameForSession(first!.id)).not.toBe(roomNameForSession(second!.id));
  });

  it("carries no personal data and no free text from the class", async () => {
    const { sessionId } = await onlineClass();
    const room = roomNameForSession(sessionId);
    // Not the title, not the Subject, not the id itself — a room name reaches a
    // third party's operational logs, and none of those belongs there.
    expect(room).toMatch(/^bodour-[0-9a-f]{32}$/);
    expect(room).not.toContain(sessionId);
    expect(room).not.toContain("تفسير");
  });

  it("has no column on any scheduling table — R97.9 as a schema property", async () => {
    /**
     * The clause names three things exactly: the schedule, the Session and the
     * occurrence projection. So the assertion names them too, rather than
     * sweeping the whole database — `user_identity.provider` is the OAuth
     * provider and has nothing to do with media, and a guard that fails on an
     * unrelated word is one somebody eventually deletes.
     */
    const columns = await prisma.$queryRawUnsafe<
      { table_name: string; column_name: string }[]
    >(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('recurring_course_schedule', 'session')
          AND (column_name ILIKE '%livekit%' OR column_name ILIKE '%room_name%'
               OR column_name ILIKE '%egress%' OR column_name ILIKE '%provider%'
               OR column_name ILIKE '%token%' OR column_name ILIKE '%meeting%')`,
    );
    expect(columns).toEqual([]);
    // …and no table was invented to hold one either (R98.2).
    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name ILIKE '%livekit%' OR table_name ILIKE '%online_room%'
               OR table_name ILIKE '%egress%')`,
    );
    expect(tables).toEqual([]);
  });
});

/* ── The join window ─────────────────────────────────────────────────────── */

describe("the join window (R98.10)", () => {
  const occurrence = {
    date: day(CLASS_DATE),
    startTime: at(15),
    endTime: at(17),
  };

  it("opens exactly the documented interval before the start", () => {
    const window = joinWindowFor(occurrence);
    const start = new Date(`${CLASS_DATE}T15:00:00+01:00`);
    expect((start.getTime() - window.opensAt.getTime()) / 60_000).toBe(
      JOIN_OPENS_MINUTES_BEFORE,
    );
  });

  it("closes exactly the documented grace after the scheduled end", () => {
    const window = joinWindowFor(occurrence);
    const end = new Date(`${CLASS_DATE}T17:00:00+01:00`);
    expect((window.closesAt.getTime() - end.getTime()) / 60_000).toBe(
      JOIN_GRACE_MINUTES_AFTER,
    );
  });

  it("is closed before, open during, closed after", () => {
    const window = joinWindowFor(occurrence);
    expect([
      windowState(window, new Date(`${CLASS_DATE}T13:00:00+01:00`)),
      windowState(window, new Date(`${CLASS_DATE}T14:50:00+01:00`)),
      windowState(window, DURING),
      windowState(window, new Date(`${CLASS_DATE}T17:20:00+01:00`)),
      windowState(window, new Date(`${CLASS_DATE}T18:00:00+01:00`)),
    ]).toEqual(["too_early", "open", "open", "open", "too_late"]);
  });

  it("never mints a timeless credential, and never one that is already dead", () => {
    const window = joinWindowFor(occurrence);
    const midClass = tokenSecondsFor(window, DURING);
    // Bounded above by the window, and by a hard ceiling regardless of it.
    expect(midClass).toBeLessThanOrEqual(6 * 60 * 60);
    expect(midClass).toBeGreaterThan(0);
    // A request landing on the last second still yields a usable credential
    // rather than one that expires before the connection completes.
    const lastMoment = tokenSecondsFor(window, window.closesAt);
    expect(lastMoment).toBeGreaterThanOrEqual(60);
  });
});

/* ── Beneficiaries ───────────────────────────────────────────────────────── */

describe("a beneficiary enters through the canonical audience (R98.5)", () => {
  it("enters her own online class", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);

    const auth = await authorizeJoin(
      prisma,
      actorOf(student, [{ role: "student", branches: [branchA] }]),
      sessionId,
      undefined,
      DURING,
    );
    expect({ role: auth.role, identity: auth.identity, media: auth.mediaMode }).toEqual({
      role: "student",
      identity: student,
      media: "audio_video",
    });
  });

  it("refuses an unrelated beneficiary — 404, never 403", async () => {
    const { sessionId } = await onlineClass();
    const outsider = await person("غريبة", [{ role: "student", branchId: branchB }]);
    // Enrolled at ANOTHER branch in the same Level: the whole-Level audience is
    // branch-bound (R66), so she is legitimately elsewhere rather than nowhere.
    await enrol(outsider, branchB);

    const error = await failure(() =>
      authorizeJoin(
        prisma,
        actorOf(outsider, [{ role: "student", branches: [branchB] }]),
        sessionId,
        undefined,
        DURING,
      ),
    );
    expect(error.code).toBe("NOT_FOUND");
  });

  it("refuses her once her enrolment is gone, on the very next request", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);
    const actor = actorOf(student, [{ role: "student", branches: [branchA] }]);

    await authorizeJoin(prisma, actor, sessionId, undefined, DURING);
    await prisma.enrollment.updateMany({
      where: { studentId: student },
      data: { deletedAt: new Date() },
    });

    // The audience is resolved per request against live rows (§20 rule 22) —
    // nothing was cached, so nothing has to be invalidated.
    expect((await failure(() => authorizeJoin(prisma, actor, sessionId, undefined, DURING))).code).toBe(
      "NOT_FOUND",
    );
  });
});

/* ── R92, proved as a PAIR ───────────────────────────────────────────────── */

describe("R92 — a combined occurrence widens ONE occurrence (R98.5)", () => {
  it("admits the second branch's beneficiary there and refuses her the next week", async () => {
    const { scheduleId, sessionId } = await onlineClass();
    const visitor = await person("مستفيدة من المسيرة", [
      { role: "student", branchId: branchB },
    ]);
    await enrol(visitor, branchB);
    const actor = actorOf(visitor, [{ role: "student", branches: [branchB] }]);

    // The override REPLACES the audience branches for this occurrence only.
    await prisma.sessionAudienceBranch.createMany({
      data: [
        { sessionId, branchId: branchA },
        { sessionId, branchId: branchB },
      ],
    });

    const combined = await authorizeJoin(prisma, actor, sessionId, undefined, DURING);
    expect(combined.identity).toBe(visitor);

    // The next ordinary occurrence of the SAME class — nothing propagated, and
    // no Enrolment was mutated to make the first half pass.
    const next = await prisma.session.findFirstOrThrow({
      where: { scheduleId, date: { gt: day(CLASS_DATE) } },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    });
    const nextDuring = new Date(
      `${next.date.toISOString().slice(0, 10)}T15:30:00+01:00`,
    );
    expect(
      (await failure(() => authorizeJoin(prisma, actor, next.id, undefined, nextDuring))).code,
    ).toBe("NOT_FOUND");

    // And her enrolment is exactly where it was.
    const enrolment = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: visitor, deletedAt: null },
      select: { branchId: true },
    });
    expect(enrolment.branchId).toBe(branchB);
  });
});

/* ── Guardians ───────────────────────────────────────────────────────────── */

describe("a guardian enters AS THE CHILD (R98.6)", () => {
  async function family(): Promise<{
    parent: string;
    child: string;
    sessionId: string;
  }> {
    const { sessionId } = await onlineClass();
    const parent = await person("الوالدة", [{ role: "parent", branchId: branchA }]);
    const child = await person("الابنة");
    await enrol(child, branchA);
    await prisma.familyLink.create({
      data: { parentId: parent, studentId: child, status: "approved" },
    });
    return { parent, child, sessionId };
  }

  it("the participant is the child, never the guardian", async () => {
    const { parent, child, sessionId } = await family();
    const auth = await authorizeJoin(
      prisma,
      actorOf(parent, [{ role: "parent", branches: [branchA] }]),
      sessionId,
      child,
      DURING,
    );
    expect(auth.identity).toBe(child);
    expect(auth.identity).not.toBe(parent);
    // And she is a beneficiary participant *for this room* without holding the
    // role: no `student` assignment was created anywhere.
    expect(auth.role).toBe("student");
    const roles = await prisma.userBranchRole.count({
      where: { userId: parent, role: { name: "student" }, deletedAt: null },
    });
    expect(roles).toBe(0);
  });

  it("refuses a forged unrelated child", async () => {
    const { parent, sessionId } = await family();
    const stranger = await person("طفلة أخرى");
    await enrol(stranger, branchA);

    const error = await failure(() =>
      authorizeJoin(
        prisma,
        actorOf(parent, [{ role: "parent", branches: [branchA] }]),
        sessionId,
        stranger,
        DURING,
      ),
    );
    // §4.3 — the same answer as "no such child", deliberately, so the refusal
    // does not confirm that another family's daughter exists.
    expect(error.code).toBe("NOT_FOUND");
  });

  it("refuses a revoked link on the very next request", async () => {
    const { parent, child, sessionId } = await family();
    const actor = actorOf(parent, [{ role: "parent", branches: [branchA] }]);
    await authorizeJoin(prisma, actor, sessionId, child, DURING);

    await prisma.familyLink.updateMany({
      where: { parentId: parent, studentId: child },
      data: { status: "rejected" },
    });
    expect((await failure(() => authorizeJoin(prisma, actor, sessionId, child, DURING))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("refuses a guardian who names no child at all", async () => {
    const { parent, sessionId } = await family();
    const error = await failure(() =>
      authorizeJoin(
        prisma,
        actorOf(parent, [{ role: "parent", branches: [branchA] }]),
        sessionId,
        undefined,
        DURING,
      ),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
  });
});

/* ── Teaching staff ──────────────────────────────────────────────────────── */

describe("teaching authority is R91's effective assignment (R98.7)", () => {
  it("admits the مؤطِّرة effective on this occurrence's date", async () => {
    const { scheduleId, sessionId } = await onlineClass();
    const teacher = await person("مؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, teacher, "teacher");

    const auth = await authorizeJoin(
      prisma,
      actorOf(teacher, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      undefined,
      DURING,
    );
    expect(auth.role).toBe("teacher");
  });

  it("refuses a مؤطِّرة whose period ENDED before this occurrence", async () => {
    const { scheduleId, sessionId } = await onlineClass();
    const outgoing = await person("مؤطِّرة سابقة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, outgoing, "teacher", { until: "2026-06-02" });

    expect(
      (
        await failure(() =>
          authorizeJoin(
            prisma,
            actorOf(outgoing, [{ role: "teacher", branches: [branchA] }]),
            sessionId,
            undefined,
            DURING,
          ),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("refuses a مؤطِّرة whose period has NOT BEGUN", async () => {
    const { scheduleId, sessionId } = await onlineClass();
    const incoming = await person("مؤطِّرة قادمة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, incoming, "teacher", { from: "2026-07-01" });

    expect(
      (
        await failure(() =>
          authorizeJoin(
            prisma,
            actorOf(incoming, [{ role: "teacher", branches: [branchA] }]),
            sessionId,
            undefined,
            DURING,
          ),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("gives an assistant EXACTLY the lead's operational authority (R87 §G)", async () => {
    const { scheduleId, sessionId } = await onlineClass();
    const lead = await person("المؤطِّرة", [{ role: "teacher", branchId: branchA }]);
    const assistant = await person("المساعِدة", [{ role: "teacher", branchId: branchA }]);
    await staff(scheduleId, lead, "teacher");
    await staff(scheduleId, assistant, "assistant");
    // The occurrence's own snapshot is what names the position (R43.4).
    await prisma.sessionStaff.createMany({
      data: [
        { sessionId, userId: lead, position: "teacher" },
        { sessionId, userId: assistant, position: "assistant" },
      ],
    });

    const leadAuth = await authorizeJoin(
      prisma,
      actorOf(lead, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      undefined,
      DURING,
    );
    const assistantAuth = await authorizeJoin(
      prisma,
      actorOf(assistant, [{ role: "teacher", branches: [branchA] }]),
      sessionId,
      undefined,
      DURING,
    );

    // The POSITION is reported honestly — it is responsibility and audit.
    expect([leadAuth.role, assistantAuth.role]).toEqual(["teacher", "assistant"]);
    // The AUTHORITY is identical, which is the rule.
    expect(grantsFor(assistantAuth.role, "audio_video")).toEqual(
      grantsFor(leadAuth.role, "audio_video"),
    );
  });

  it("admits a one-off cover for THAT occurrence and no other (R91.9)", async () => {
    const { scheduleId, sessionId } = await onlineClass();
    const cover = await person("مؤطِّرة بديلة", [{ role: "teacher", branchId: branchA }]);
    // No schedule assignment at all — the cover exists only on this occurrence.
    await prisma.sessionStaff.create({
      data: { sessionId, userId: cover, position: "teacher" },
    });
    const actor = actorOf(cover, [{ role: "teacher", branches: [branchA] }]);

    expect((await authorizeJoin(prisma, actor, sessionId, undefined, DURING)).role).toBe(
      "teacher",
    );

    const next = await prisma.session.findFirstOrThrow({
      where: { scheduleId, date: { gt: day(CLASS_DATE) } },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    });
    const nextDuring = new Date(`${next.date.toISOString().slice(0, 10)}T15:30:00+01:00`);
    expect(
      (await failure(() => authorizeJoin(prisma, actor, next.id, undefined, nextDuring))).code,
    ).toBe("NOT_FOUND");
  });

  it("refuses a مؤطِّرة who only DECLARED she can teach this (R88)", async () => {
    const { sessionId } = await onlineClass();
    const declared = await person("مؤطِّرة معلنة", [{ role: "teacher", branchId: branchA }]);
    // R88's planning data, in full — and it staffs nothing.
    await prisma.teacherSubjectCapability.create({
      data: { userId: declared, subjectId },
    });
    await prisma.teacherCategoryCapability.create({
      data: { userId: declared, categoryId },
    });

    expect(
      (
        await failure(() =>
          authorizeJoin(
            prisma,
            actorOf(declared, [{ role: "teacher", branches: [branchA] }]),
            sessionId,
            undefined,
            DURING,
          ),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});

/* ── Administration ──────────────────────────────────────────────────────── */

describe("administration reuses the authority that edits the occurrence (R98.8)", () => {
  it("admits an administrator scoped to the class's branch", async () => {
    const { sessionId } = await onlineClass();
    const admin = await person("إدارية", [{ role: "admin", branchId: branchA }]);
    const auth = await authorizeJoin(
      prisma,
      actorOf(admin, [{ role: "admin", branches: [branchA] }]),
      sessionId,
      undefined,
      DURING,
    );
    expect(auth.role).toBe("admin");
  });

  it("refuses an administrator scoped to ANOTHER branch — no all-rooms shortcut", async () => {
    const { sessionId } = await onlineClass();
    const elsewhere = await person("إدارية أخرى", [{ role: "admin", branchId: branchB }]);
    expect(
      (
        await failure(() =>
          authorizeJoin(
            prisma,
            actorOf(elsewhere, [{ role: "admin", branches: [branchB] }]),
            sessionId,
            undefined,
            DURING,
          ),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });

  it("gives an administrator NO moderation permissions (R98.9)", () => {
    expect(grantsFor("admin", "audio_video").roomAdmin).toBe(false);
    expect(grantsFor("teacher", "audio_video").roomAdmin).toBe(true);
  });
});

/* ── State refusals ──────────────────────────────────────────────────────── */

describe("only an online, live occurrence can be entered (R98.3)", () => {
  it("refuses an in-person occurrence, for everybody", async () => {
    const { sessionId } = await inPersonClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);

    const error = await failure(() =>
      authorizeJoin(
        prisma,
        actorOf(student, [{ role: "student", branches: [branchA] }]),
        sessionId,
        undefined,
        DURING,
      ),
    );
    expect({ code: error.code, reason: error.details?.["reason"] }).toEqual({
      code: "STATE_CONFLICT",
      reason: "NOT_ONLINE",
    });
  });

  it("refuses a cancelled occurrence", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "cancelled", cancellationReason: `${TAG} سبب` },
    });

    const error = await failure(() =>
      authorizeJoin(
        prisma,
        actorOf(student, [{ role: "student", branches: [branchA] }]),
        sessionId,
        undefined,
        DURING,
      ),
    );
    expect(error.details?.["reason"]).toBe("CANCELLED");
  });

  it("refuses before the window and after it, naming both bounds", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);
    const actor = actorOf(student, [{ role: "student", branches: [branchA] }]);

    const early = await failure(() =>
      authorizeJoin(prisma, actor, sessionId, undefined, new Date(`${CLASS_DATE}T09:00:00+01:00`)),
    );
    const late = await failure(() =>
      authorizeJoin(prisma, actor, sessionId, undefined, new Date(`${CLASS_DATE}T19:00:00+01:00`)),
    );

    expect([early.details?.["reason"], late.details?.["reason"]]).toEqual([
      "BEFORE_WINDOW",
      "AFTER_WINDOW",
    ]);
    // Both bounds are reported, so a screen can say when the door opens.
    expect(typeof early.details?.["opens_at"]).toBe("string");
    expect(typeof early.details?.["closes_at"]).toBe("string");
  });

  it("tells an UNAUTHORISED caller nothing about the timetable (R98.11)", async () => {
    const { sessionId } = await onlineClass();
    const outsider = await person("غريبة", [{ role: "student", branchId: branchB }]);
    await enrol(outsider, branchB);

    // Outside the window AND unauthorised: the answer must be the authorization
    // one, so the refusal does not confirm when a class she cannot attend runs.
    const error = await failure(() =>
      authorizeJoin(
        prisma,
        actorOf(outsider, [{ role: "student", branches: [branchB] }]),
        sessionId,
        undefined,
        new Date(`${CLASS_DATE}T09:00:00+01:00`),
      ),
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(error.details?.["opens_at"]).toBeUndefined();
  });

  it("refuses a suspended caller on the very next request (TD-12 freshness)", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);
    const actor = actorOf(student, [{ role: "student", branches: [branchA] }]);
    await authorizeJoin(prisma, actor, sessionId, undefined, DURING);

    await prisma.user.update({
      where: { id: student },
      data: { accountStatus: "suspended" },
    });
    expect((await failure(() => authorizeJoin(prisma, actor, sessionId, undefined, DURING))).code).toBe(
      "FORBIDDEN",
    );
  });
});

/* ── The credential itself ───────────────────────────────────────────────── */

describe("the credential says only what the platform decided (R98.4, R98.9)", () => {
  it("carries the caller's own identity, and the client cannot choose one", () => {
    // The boundary schema is EMPTY and strict — there is no field to forge.
    const forged = onlineJoinSchema.safeParse({
      identity: "somebody-else",
      role: "teacher",
      room: "bodour-anything",
      can_publish: true,
    });
    expect(forged.success).toBe(false);
    expect(onlineJoinSchema.safeParse({}).success).toBe(true);
  });

  it("mints for the room the platform derived and the person it authorized", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);
    const provider = new RecordingProvider();

    await joinOnlineClass(
      prisma,
      provider,
      actorOf(student, [{ role: "student", branches: [branchA] }]),
      sessionId,
      undefined,
      DURING,
    );

    const request = provider.requests[0]!;
    expect({ room: request.room, identity: request.identity }).toEqual({
      room: roomNameForSession(sessionId),
      identity: student,
    });
    expect(request.grants.roomAdmin).toBe(false);
  });

  it("restricts an audio-only class to the microphone, at the credential", () => {
    expect(grantsFor("student", "audio_only").canPublishSources).toEqual(["microphone"]);
    expect(grantsFor("teacher", "audio_only").canPublishSources).toEqual(["microphone"]);
    // …and an audio+video class permits the camera as well.
    expect(grantsFor("student", "audio_video").canPublishSources).toContain("camera");
  });

  it("repeating the request creates NO domain state (R98.12)", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);
    const provider = new RecordingProvider();
    const actor = actorOf(student, [{ role: "student", branches: [branchA] }]);

    const before = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { version: true, updatedAt: true, overridden: true },
    });
    const first = await joinOnlineClass(prisma, provider, actor, sessionId, undefined, DURING);
    const second = await joinOnlineClass(prisma, provider, actor, sessionId, undefined, DURING);
    const after = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { version: true, updatedAt: true, overridden: true },
    });

    // Same room both times, and the occurrence is untouched — no row was
    // written because a participant refreshed.
    expect(first.authorization.room).toBe(second.authorization.room);
    expect(after).toEqual(before);
  });

  it("answers 503 naming the settings when no provider is configured", async () => {
    const { sessionId } = await onlineClass();
    const student = await person("مستفيدة", [{ role: "student", branchId: branchA }]);
    await enrol(student, branchA);

    const error = await failure(() =>
      joinOnlineClass(
        prisma,
        null,
        actorOf(student, [{ role: "student", branches: [branchA] }]),
        sessionId,
        undefined,
        DURING,
      ),
    );
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.details?.["settings"]).toEqual([
      "LIVEKIT_URL",
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
    ]);
  });
});

/* ── The real signing path ───────────────────────────────────────────────── */

describe("the issued token, decoded (R98.9)", () => {
  /**
   * **Decoded, never printed.** The assertions read the JWT's *claims*; the
   * token itself is never snapshotted and the signing secret never appears in
   * an expectation, so a failure here prints a claim set and not a credential.
   *
   * The key pair below is local to this test and authorises nothing: it is not
   * the deployment's, and CI never reaches a paid account (R98.15).
   */
  const KEY = "test-api-key";
  const SECRET = "test-secret-test-secret-test-secret-xx";

  const claimsOf = (token: string): Record<string, unknown> =>
    JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

  it("names one room, one identity and exactly the permissions granted", async () => {
    const provider = new LiveKitOnlineClassProvider("wss://example.invalid", KEY, SECRET);
    const room = roomNameForSession("11111111-1111-4111-8111-111111111111");
    const { token, expiresAt } = await provider.issueJoinCredentials({
      room,
      identity: "22222222-2222-4222-8222-222222222222",
      displayName: "أمينة",
      grants: grantsFor("student", "audio_only"),
      ttlSeconds: 900,
    });

    const claims = claimsOf(token);
    const video = claims["video"] as Record<string, unknown>;

    expect(claims["sub"]).toBe("22222222-2222-4222-8222-222222222222");
    expect(video["room"]).toBe(room);
    expect(video["roomJoin"]).toBe(true);
    // A beneficiary is a participant, never a moderator, and can never open a
    // room, list rooms or start a recording.
    expect(video["roomAdmin"]).toBeFalsy();
    expect(video["roomCreate"]).toBeFalsy();
    expect(video["roomList"]).toBeFalsy();
    expect(video["roomRecord"]).toBeFalsy();
    expect(video["ingressAdmin"]).toBeFalsy();
    // صوت فقط, enforced on the credential rather than in a stylesheet.
    expect(video["canPublishSources"]).toEqual(["microphone"]);

    // Bounded, and bounded by what we asked for. The provider stamps `nbf`
    // rather than `iat`; the property asserted is the WIDTH of the validity,
    // which is what "no timeless token" actually means.
    const exp = claims["exp"] as number;
    const notBefore = claims["nbf"] as number;
    expect(exp - notBefore).toBe(900);
    expect(Math.abs(expiresAt.getTime() - exp * 1000)).toBeLessThan(5000);
  });

  it("gives teaching staff moderation and the camera, and nothing beyond", async () => {
    const provider = new LiveKitOnlineClassProvider("wss://example.invalid", KEY, SECRET);
    const { token } = await provider.issueJoinCredentials({
      room: "bodour-test",
      identity: "33333333-3333-4333-8333-333333333333",
      displayName: "صفاء",
      grants: grantsFor("teacher", "audio_video"),
      ttlSeconds: 600,
    });
    const video = claimsOf(token)["video"] as Record<string, unknown>;

    expect(video["roomAdmin"]).toBe(true);
    expect(video["canPublishSources"]).toHaveLength(3);
    expect(video["roomRecord"]).toBeFalsy();
    expect(video["roomCreate"]).toBeFalsy();
  });

  it("is `null` — not a broken provider — when the platform is unconfigured", () => {
    const base = { ...config, LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined };
    expect(createOnlineClassProvider(base)).toBeNull();
    expect(
      createOnlineClassProvider({
        ...base,
        LIVEKIT_URL: "wss://x.invalid",
        LIVEKIT_API_KEY: KEY,
        LIVEKIT_API_SECRET: SECRET,
      }),
    ).toBeInstanceOf(LiveKitOnlineClassProvider);
  });
});
