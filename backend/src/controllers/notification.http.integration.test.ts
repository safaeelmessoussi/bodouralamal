import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **Session cancellation as a notification event** (§4.8 as narrowed by R77),
 * over real HTTP.
 *
 * This file is the §12 scenario written down: cancel exactly one occurrence of a
 * recurring class, and assert what a beneficiary can actually see afterwards.
 * The properties that matter are the ones a service test cannot reach — that the
 * *enrolled* student is told and the unrelated one is not, that a second
 * student's notice is invisible to the first, and that restoring reconciles what
 * was already delivered rather than quietly deleting it.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = `[http-notification-test:${randomUUID()}]`;
const YEAR_LABEL = "2097-2098";

/**
 * The DTO's exact key set — asserted rather than sampled, so a field cannot join
 * the contract by accident.
 *
 * **R82 widened it**, and the shape of the widening is the decision: a notice is
 * now about a Session, an Event or an Exam, and the client renders ONE list — so
 * the fields that mean the same thing across targets are published under the
 * same names (`title`, `date`, `start_time`, `reason`, `scope_name`) with the
 * three target ids beside them. R77's `session_*` keys stay **in addition** and
 * unchanged: a contract does not break to be tidier.
 */
const KEYS = [
  "created_at",
  "date",
  "event_id",
  "exam_id",
  "id",
  "level_name",
  "read_at",
  "reason",
  "scope_name",
  "session_date",
  "session_id",
  "session_start_time",
  "start_time",
  "subject_name",
  "title",
  "type",
];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string };
    data?: Record<string, unknown>[] & Record<string, unknown>;
    meta?: { total: number; unread: number };
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

const bearer = (
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
): string =>
  issueAccessToken(
    { userId, roleScopes: scopes as never, accountStatus: "active" as never },
    config.JWT_SIGNING_KEY,
  ).token;

let superAdmin: string;
let enrolledToken: string;
let enrolledId: string;
let secondToken: string;
let outsiderToken: string;
let scheduleId: string;
let sessionId: string;
let teacherId: string;
let teacherToken: string;

async function makeUser(label: string): Promise<string> {
  return (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} ${label}`, accountStatus: "active" },
    })
  ).id;
}

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  const sessions = await prisma.session.findMany({
    where: { scheduleId: { in: ids } },
    select: { id: true },
  });
  await prisma.notification.deleteMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
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
  const groups = await prisma.administrativeGroup.findMany({
    where: { levelId: { in: levelIds } },
    select: { id: true },
  });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
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

  const branchId = (
    await prisma.branch.create({ data: { name: `${TAG} فرع` } })
  ).id;
  const roomId = (
    await prisma.room.create({ data: { name: `${TAG} قاعة`, branchId } })
  ).id;
  const category = await prisma.category.create({
    data: { name: `${TAG} فئة` },
  });
  const levelId = (
    await prisma.level.create({
      data: {
        name: `${TAG} مستوى`,
        categoryId: category.id,
        genderRestriction: "any",
      },
    })
  ).id;
  const subjectId = (
    await prisma.subject.create({ data: { name: `${TAG} مادة` } })
  ).id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  const groupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId },
    })
  ).id;
  const academicYearId = (
    await prisma.academicYear.create({ data: { label: YEAR_LABEL } })
  ).id;

  superAdmin = bearer(await makeUser("مدير عام"), [
    { role: "super_admin", branches: null },
  ]);

  enrolledId = await makeUser("مستفيدة مسجّلة");
  const secondId = await makeUser("مستفيدة ثانية");
  const outsiderId = await makeUser("مستفيدة غير معنية");
  enrolledToken = bearer(enrolledId, [{ role: "student", branches: null }]);
  secondToken = bearer(secondId, [{ role: "student", branches: null }]);
  // Enrolled in NOTHING — the control. A notification reaching her would mean
  // the audience is not the audience.
  outsiderToken = bearer(outsiderId, [{ role: "student", branches: null }]);

  for (const studentId of [enrolledId, secondId]) {
    await prisma.enrollment.create({
      data: { studentId, levelId, administrativeGroupId: groupId, branchId },
    });
  }

  // R78.3's second half needs staff on the session: an administrator's action
  // reaches them, and their own action does not reach themselves.
  teacherId = await makeUser("أستاذة");
  teacherToken = bearer(teacherId, [{ role: "teacher", branches: null }]);

  const created = await call("POST", "/admin/course-schedules", superAdmin, {
    staff: [{ user_id: teacherId, position: "teacher" }],
    title: `${TAG} حلقة`,
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
  if (created.status !== 201) {
    throw new Error(`fixture schedule failed: ${JSON.stringify(created.body)}`);
  }
  scheduleId = created.body.schedule!.id;
  sessionId = (
    await prisma.session.findFirstOrThrow({
      where: { scheduleId, status: "scheduled", deletedAt: null },
      orderBy: { date: "asc" },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const versionOf = async (): Promise<number> =>
  (
    await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { version: true },
    })
  ).version;

const cancel = async (reason: string): Promise<Res> =>
  call("POST", `/sessions/${sessionId}/cancel`, superAdmin, {
    reason,
    version: await versionOf(),
  });

/**
 * **R83.3 — the send is a separate act.** R77.4 wrote the notices inside the
 * cancelling transaction; the Owner made telling people a decision, so every
 * test that used to assert *cancelling notified* now cancels and then sends.
 * The property under test — who is reached, with what, and how idempotently —
 * is unchanged; only the moment it happens moved.
 */
const announce = async (change: "cancelled" | "rescheduled" = "cancelled"): Promise<Res> =>
  call("POST", `/sessions/${sessionId}/notify`, superAdmin, { change });

const restore = async (): Promise<Res> =>
  call("POST", `/sessions/${sessionId}/restore`, superAdmin, {
    version: await versionOf(),
  });

const inbox = async (token: string, query = ""): Promise<Res> =>
  call("GET", `/notifications${query}`, token);

describe("R77 — cancelling one occurrence notifies its enrolled students", () => {
  it("writes NOTHING on cancellation alone (R83.3)", async () => {
    const cancelled = await cancel("الأستاذة مريضة");
    expect(cancelled.status).toBe(200);
    // The half that did not exist before: declining costs nothing because
    // nothing is written until somebody chooses to write it.
    expect(await prisma.notification.count({ where: { sessionId } })).toBe(0);
  });

  it("reaches the enrolled student when sent, carrying the REASON", async () => {
    expect((await announce()).status).toBe(200);

    const res = await inbox(enrolledToken);
    expect(res.status).toBe(200);
    const mine = res.body.data!.filter((n) => n["session_id"] === sessionId);
    expect(mine).toHaveLength(1);
    // *Cancelled* without *why* is what §4.8's manual channels already managed,
    // badly — the reason is the point of the notice.
    expect(mine[0]!["reason"]).toBe("الأستاذة مريضة");
    expect(mine[0]!["type"]).toBe("session_cancelled");
    expect(mine[0]!["read_at"]).toBeNull();
    // TD-11 — a calendar date and a wall-clock time, never an instant.
    expect(String(mine[0]!["session_date"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mine[0]!["session_start_time"]).toBe("15:00");
  });

  it("is an explicit contract DTO, not the row", async () => {
    const res = await inbox(enrolledToken);
    expect(Object.keys(res.body.data![0]!).sort()).toEqual(KEYS);
  });

  it("does NOT reach a student enrolled in nothing", async () => {
    const res = await inbox(outsiderToken);
    expect(res.status).toBe(200);
    expect(
      res.body.data!.filter((n) => n["session_id"] === sessionId),
    ).toHaveLength(0);
  });

  it("reaches every enrolled student, each seeing only their own", async () => {
    const second = await inbox(secondToken);
    expect(
      second.body.data!.filter((n) => n["session_id"] === sessionId),
    ).toHaveLength(1);
    // The count is what the screen shows, and it is the caller's own.
    expect(second.body.meta!.unread).toBeGreaterThan(0);
    expect((await inbox(outsiderToken)).body.meta!.unread).toBe(0);
  });

  it("leaves the recurring schedule alive — only this occurrence is cancelled", async () => {
    const others = await prisma.session.count({
      where: { scheduleId, status: "scheduled", deletedAt: null },
    });
    expect(others).toBeGreaterThan(0);
    const schedule = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { deletedAt: true },
    });
    expect(schedule.deletedAt).toBeNull();
  });

  it("records both the audience size and how many were told", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "session.cancel", targetId: sessionId },
      orderBy: { createdAt: "desc" },
    });
    const detail = row.detail as Record<string, unknown>;
    // `audience_size` counts the STUDENTS the class is for — §4.4c's resolved
    // audience, unchanged by R78.
    expect(detail["audience_size"]).toBe(2);
    // **`notified` is no longer on this row** (R83.3): the cancellation no
    // longer tells anybody, so how many were told is not a fact about it. The
    // count is asserted where it now happens — on the send, below.
    expect(detail["notified"]).toBeUndefined();
  });

  it("is idempotent — a cancellation that is already in force writes no second notice", async () => {
    // The state machine refuses `cancelled → cancelled`, so the honest assertion
    // is that the notices did not multiply.
    const again = await cancel("مرة أخرى");
    expect(again.status).toBe(409);

    // **And sending twice writes no second notice** — which is now where the
    // idempotency actually lives, since the send is what writes.
    const second = await announce();
    expect(second.status).toBe(200);
    // `data` is declared as a row array on this local type; the announce
    // endpoint answers a single object, so the cast goes through `unknown`.
    expect((second.body.data as unknown as { notified: number }).notified).toBe(0);

    const count = await prisma.notification.count({
      where: { sessionId, type: "session_cancelled" },
    });
    // Two students and the assigned مؤطرة (R78.3) — and no more on a retry.
    expect(count).toBe(3);
  });

  it("refuses an anonymous read and never leaks another caller’s notice", async () => {
    // An anonymous read — no token at all, which is what the empty string
    // expresses to `call`. `undefined` was not assignable and made
    // `npm run typecheck` red without ever changing what is exercised.
    expect((await inbox("")).status).toBe(401);
    const mine = (await inbox(enrolledToken)).body.data![0]!;
    // §20 rule 17 — for a caller who is not the recipient this is NOT_FOUND, not
    // FORBIDDEN, which would confirm the notice exists.
    const stolen = await call(
      "POST",
      `/notifications/${String(mine["id"])}/read`,
      outsiderToken,
    );
    expect(stolen.status).toBe(404);
    expect(stolen.body.error?.code).toBe("NOT_FOUND");
  });
});

describe("R77.5 — restoring reconciles what was already delivered", () => {
  it("marks one read, and the unread filter answers accordingly", async () => {
    const mine = (await inbox(enrolledToken)).body.data!.find(
      (n) => n["session_id"] === sessionId,
    )!;
    const read = await call(
      "POST",
      `/notifications/${String(mine["id"])}/read`,
      enrolledToken,
    );
    expect(read.status).toBe(200);
    expect(read.body.data!["read_at"]).not.toBeNull();

    // Idempotent, and it does not move the timestamp — a retry must not rewrite
    // when the person actually read it.
    const first = read.body.data!["read_at"];
    const twice = await call(
      "POST",
      `/notifications/${String(mine["id"])}/read`,
      enrolledToken,
    );
    expect(twice.body.data!["read_at"]).toBe(first);

    const unread = await inbox(enrolledToken, "?unread_only=true");
    expect(
      unread.body.data!.filter((n) => n["session_id"] === sessionId),
    ).toHaveLength(0);
  });

  it("withdraws the UNREAD notice and CORRECTS the read one", async () => {
    const restored = await restore();
    expect(restored.status).toBe(200);

    // The second student never read hers, so hers is simply gone: an unread
    // notice of something no longer true is worth nothing.
    const second = (await inbox(secondToken)).body.data!.filter(
      (n) => n["session_id"] === sessionId,
    );
    expect(second).toHaveLength(0);

    // The first student HAD read hers, so deleting it silently would leave her
    // believing the class is cancelled with nothing to correct her.
    const first = (await inbox(enrolledToken)).body.data!.filter(
      (n) => n["session_id"] === sessionId,
    );
    expect(first).toHaveLength(1);
    expect(first[0]!["type"]).toBe("session_restored");
    // The correction REPLACES the notice it corrects — two contradictory
    // statements about one class in the same list would be worse than either.
    expect(first[0]!["read_at"]).toBeNull();
  });

  it("records what it reconciled, and is idempotent on a second restore", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "session.restore", targetId: sessionId },
      orderBy: { createdAt: "desc" },
    });
    const detail = row.detail as Record<string, unknown>;
    // The second student never read hers, and neither did the مؤطرة — both are
    // withdrawn. Only the first student had read hers, so only hers is corrected.
    expect(detail["withdrawn"]).toBe(2);
    expect(detail["corrected"]).toBe(1);

    // `scheduled → scheduled` is refused, and nothing multiplied.
    expect((await restore()).status).toBe(409);
    expect(await prisma.notification.count({ where: { sessionId } })).toBe(1);
  });
});

/**
 * **R78.3 — the audience is (students ∪ assigned staff) MINUS the actor.**
 *
 * R77.3 read *students only, not staff, who take the decision*. The reason was
 * right and the rule over-reached: an administrator cancelling a class is
 * telling the assigned مؤطرة something she did **not** decide. What R78 keeps is
 * the part that was actually true — nobody is told about their own act.
 */
describe("R78.3 — assigned staff are told, unless they did it themselves", () => {
  const reset = async (): Promise<void> => {
    await prisma.notification.deleteMany({ where: { sessionId } });
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true, version: true },
    });
    if (row.status === "cancelled") {
      await call("POST", `/sessions/${sessionId}/restore`, superAdmin, {
        version: row.version,
      });
      await prisma.notification.deleteMany({ where: { sessionId } });
    }
  };

  const typesFor = async (token: string): Promise<string[]> => {
    const res = await call("GET", "/notifications", token);
    return (res.body.data as unknown as Record<string, unknown>[])
      .filter((n) => n["session_id"] === sessionId)
      .map((n) => String(n["type"]));
  };

  it("an ADMIN cancelling reaches the students AND the assigned مؤطرة", async () => {
    await reset();
    expect((await cancel("الأستاذة مريضة")).status).toBe(200);
    expect((await announce()).status).toBe(200);
    expect(await typesFor(enrolledToken)).toEqual(["session_cancelled"]);
    // She did not take this decision, so it is news to her.
    expect(await typesFor(teacherToken)).toEqual(["session_cancelled"]);
    // And it still reaches nobody outside the audience.
    expect(await typesFor(outsiderToken)).toEqual([]);
  });

  it("the مؤطرة cancelling her OWN class is not told about it", async () => {
    await reset();
    const version = await versionOf();
    const res = await call(
      "POST",
      `/sessions/${sessionId}/cancel`,
      teacherToken,
      {
        reason: "ظرف طارئ",
        version,
      },
    );
    expect(res.status).toBe(200);
    // R83.3 — she then chooses to tell people, and the actor exclusion applies
    // to the send exactly as it applied to the write.
    expect(
      (await call("POST", `/sessions/${sessionId}/notify`, teacherToken, {
        change: "cancelled",
      })).status,
    ).toBe(200);
    // The students still learn of it — the event happened.
    expect(await typesFor(enrolledToken)).toEqual(["session_cancelled"]);
    // She performed it. Telling her would be the platform reporting her own act
    // back to her, which is exactly what R77.3 was reaching for.
    expect(await typesFor(teacherToken)).toEqual([]);
  });

  it("is idempotent for staff too — a retry writes no second notice", async () => {
    await reset();
    await cancel("الأستاذة مريضة");
    await announce();
    // `cancelled → cancelled` is refused, and a repeated SEND writes no second
    // notice — which is where idempotency lives now that the send is the write.
    expect((await cancel("مرة أخرى")).status).toBe(409);
    expect((await announce()).status).toBe(200);
    expect(await typesFor(teacherToken)).toEqual(["session_cancelled"]);
  });
});

/**
 * **R78.4 — a reschedule is one occurrence moving, not a cancellation and a
 * creation.**
 */
describe("R78.4 — rescheduling tells the audience where the class now is", () => {
  const moveTo = async (date: string, start: string, end: string) => {
    // A cancelled occurrence left behind by an earlier block is restored first:
    // rescheduling is about a class that is ON, and the scenario under test is
    // a move rather than a revival.
    const current = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true, version: true },
    });
    if (current.status === "cancelled") {
      await call("POST", `/sessions/${sessionId}/restore`, superAdmin, {
        version: current.version,
      });
      await prisma.notification.deleteMany({ where: { sessionId } });
    }
    const version = await versionOf();
    return call("PATCH", `/sessions/${sessionId}`, superAdmin, {
      version,
      date,
      start_time: start,
      end_time: end,
    });
  };

  it("writes ONE session_rescheduled carrying the NEW date and time", async () => {
    await prisma.notification.deleteMany({ where: { sessionId } });
    const before = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { date: true },
    });

    const moved = await moveTo("2098-03-09", "10:00", "12:00");
    expect(moved.status).toBe(200);
    // R83.3 — moving it commits alone; this is the decision to tell people.
    expect((await announce("rescheduled")).status).toBe(200);

    const res = await call("GET", "/notifications", enrolledToken);
    const mine = (res.body.data as unknown as Record<string, unknown>[]).filter(
      (n) => n["session_id"] === sessionId,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!["type"]).toBe("session_rescheduled");
    // **The new time, not the old one.** A notice saying only *the time changed*
    // is one nobody can act on.
    expect(mine[0]!["session_date"]).toBe("2098-03-09");
    expect(mine[0]!["session_start_time"]).toBe("10:00");
    expect(before.date.toISOString().slice(0, 10)).not.toBe("2098-03-09");

    // The SAME occurrence moved — no second row was created, and no
    // cancellation was faked to stand in for the move.
    expect(
      await prisma.session.count({
        where: { scheduleId, deletedAt: null, date: before.date },
      }),
    ).toBe(0);
    const still = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    });
    expect(still.status).toBe("scheduled");
  });

  it("moving it AGAIN keeps one notice, showing where it is now", async () => {
    expect((await moveTo("2098-03-16", "11:00", "13:00")).status).toBe(200);
    expect((await announce("rescheduled")).status).toBe(200);
    const res = await call("GET", "/notifications", enrolledToken);
    const mine = (res.body.data as unknown as Record<string, unknown>[]).filter(
      (n) => n["session_id"] === sessionId,
    );
    // One row, because it points at the Session and the DTO renders the
    // session's CURRENT time — a trail of old times helps nobody.
    expect(
      mine.filter((n) => n["type"] === "session_rescheduled"),
    ).toHaveLength(1);
    expect(mine[0]!["session_date"]).toBe("2098-03-16");
    expect(mine[0]!["session_start_time"]).toBe("11:00");
  });

  it("a change that is NOT a move writes nothing", async () => {
    await prisma.notification.deleteMany({ where: { sessionId } });
    const version = await versionOf();
    // Same date and times, resubmitted. The row is still marked overridden —
    // that is R43.4 — but nobody needs telling about it.
    const res = await call("PATCH", `/sessions/${sessionId}`, superAdmin, {
      version,
      date: "2098-03-16",
      start_time: "11:00",
      end_time: "13:00",
    });
    expect(res.status).toBe(200);
    expect(await prisma.notification.count({ where: { sessionId } })).toBe(0);
  });

  it("never reaches a student enrolled elsewhere", async () => {
    const res = await call("GET", "/notifications", outsiderToken);
    expect(
      (res.body.data as unknown as Record<string, unknown>[]).filter(
        (n) => n["session_id"] === sessionId,
      ),
    ).toHaveLength(0);
  });
});
