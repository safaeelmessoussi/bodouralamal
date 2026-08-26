import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * Sessions over real HTTP (TD-3.12, §4.4, TD-1).
 *
 * **What only this layer can prove.** That `PATCH` has no second entrance into
 * the state machine — a service test calls `cancelSession` directly and can
 * never observe whether the *edit* endpoint would also accept `status`. That a
 * Teacher's reach is the sessions they staff and nothing else, since that
 * depends on who holds the token. And that unlinking content leaves the content
 * itself alive, which is a claim about two rows a single service assertion tends
 * not to check.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-session-test]";
const YEAR_LABEL = "2098-2099";

const SESSION_KEYS = [
  "cancellation_reason",
  "date",
  // **R97 — this occurrence's OWN delivery**, snapshotted at materialization
  // and overridable for one date. After an override it is not the schedule's.
  "delivery_mode",
  "end_time",
  "id",
  "online_media_mode",
  "overridden",
  "room_id",
  "schedule_id",
  "start_time",
  "status",
  "version",
  // **R109 — this occurrence's OWN visibility tier**, on exactly the footing
  // `delivery_mode` above has: snapshotted at materialization and decidable for
  // one date. The list is sorted, so it belongs after `version`.
  "visibility",
];
const LINK_KEYS = ["educational_content_id", "id", "session_id"];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string; details?: Record<string, unknown> };
    schedule?: { id: string };
  };
}

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> {
  return httpCall<Res["body"]>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });
}

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

let superAdmin: string;
let outsiderTeacher: string;
let branchA: string;
let roomA: string;
let levelId: string;
let subjectId: string;
let groupA: string;
let academicYearId: string;
let scheduleId: string;
let contentId: string;

async function clear(): Promise<void> {
  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { branch: { name: { startsWith: TAG } } },
    select: { id: true },
  });
  const ids = schedules.map((s) => s.id);
  // `session_content` and `session_staff` are RESTRICT against `session`
  // (TD-5) — a session's materials and staffing are part of the record of what
  // happened, so they never vanish beneath it. The fixture unwinds in that order.
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
  roomA = (
    await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: branchA },
    })
  ).id;
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
  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId: branchA },
    })
  ).id;
  academicYearId = (
    await prisma.academicYear.create({ data: { label: YEAR_LABEL } })
  ).id;

  superAdmin = bearer(await makeUser("مدير عام"), [
    { role: "super_admin", branches: null },
  ]);
  // Staffs nothing — TD-2 gives a Teacher the sessions they staff and no others.
  outsiderTeacher = bearer(await makeUser("أستاذة أخرى"), [
    { role: "teacher", branches: null },
  ]);

  contentId = (
    await prisma.educationalContent.create({
      data: {
        title: `${TAG} مادة تعليمية`,
        levelId,
        subjectId,
        academicYearId,
        storageBucket: "content",
        storageKey: `${TAG}/object-${Date.now()}`,
        originalFilename: "lesson.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(1024),
      },
    })
  ).id;

  // Sessions exist only as the materialization of a schedule, so the fixture
  // creates one through the API it already trusts rather than hand-rolling rows
  // the real path would never produce.
  const created = await call("POST", "/admin/course-schedules", superAdmin, {
    // R57 — a class carries its own name.
    title: `${TAG} حلقة`,
    subject_id: subjectId,
    teaching_mode: "administrative_group",
    target_id: groupA,
    branch_id: branchA,
    room_id: roomA,
    start_time: "09:00",
    end_time: "10:00",
    recurrence: "weekly",
    weekdays: ["wednesday"],
    academic_year_id: academicYearId,
  });
  if (created.status !== 201) {
    throw new Error(
      `fixture schedule failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  scheduleId = created.body.schedule!.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** A future occurrence nobody has touched yet. */
async function freshSession(): Promise<{ id: string; version: number }> {
  const row = await prisma.session.findFirstOrThrow({
    where: {
      scheduleId,
      status: "scheduled",
      overridden: false,
      deletedAt: null,
    },
    orderBy: { date: "asc" },
    select: { id: true, version: true },
  });
  return row;
}

describe("the response is an explicit contract DTO (§16.2)", () => {
  it("PATCH returns exactly the documented keys", async () => {
    const s = await freshSession();
    const res = await call("PATCH", `/sessions/${s.id}`, superAdmin, {
      version: s.version,
      start_time: "11:00",
      end_time: "12:00",
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(SESSION_KEYS);
    expect(res.body.start_time).toBe("11:00");
    // TD-11: a wall-clock reading, never an instant.
    expect(String(res.body.start_time)).not.toContain("Z");
    // A date is a calendar date for the same reason.
    expect(String(res.body.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("exposes no internal column and no camelCase original", async () => {
    const s = await freshSession();
    const res = await call("PATCH", `/sessions/${s.id}`, superAdmin, {
      version: s.version,
    });
    for (const internal of [
      "created_at",
      "updated_at",
      "deleted_at",
      "deleted_by",
    ]) {
      expect(res.body).not.toHaveProperty(internal);
    }
    for (const camel of ["scheduleId", "startTime", "cancellationReason"]) {
      expect(res.body).not.toHaveProperty(camel);
    }
  });
});

describe("PATCH is a field edit, not a second entrance to the state machine", () => {
  it("refuses `status` rather than dropping it", async () => {
    // Cancelling carries obligations a field assignment cannot: a mandatory
    // reason, and an audience size recorded while it is still answerable.
    const s = await freshSession();
    const res = await call("PATCH", `/sessions/${s.id}`, superAdmin, {
      version: s.version,
      status: "cancelled",
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");

    const row = await prisma.session.findUniqueOrThrow({
      where: { id: s.id },
      select: { status: true },
    });
    expect(row.status).toBe("scheduled");
  });

  it("refuses to move an occurrence to another schedule", async () => {
    const s = await freshSession();
    const res = await call("PATCH", `/sessions/${s.id}`, superAdmin, {
      version: s.version,
      schedule_id: scheduleId,
    });
    expect(res.status).toBe(400);
  });

  it("marks `overridden` even when the values are unchanged (R43.4)", async () => {
    // The flag records that A HUMAN DECIDED about this occurrence. Inferring it
    // from "differs from the schedule" would silently un-protect a session whose
    // schedule later moved to match it.
    const s = await freshSession();
    const res = await call("PATCH", `/sessions/${s.id}`, superAdmin, {
      version: s.version,
    });
    expect(res.status).toBe(200);
    expect(res.body.overridden).toBe(true);
  });

  it("TD-15: a stale version is a 409", async () => {
    const s = await freshSession();
    const first = await call("PATCH", `/sessions/${s.id}`, superAdmin, {
      version: s.version,
      room_id: roomA,
    });
    expect(first.status).toBe(200);

    const stale = await call("PATCH", `/sessions/${s.id}`, superAdmin, {
      version: s.version,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");
  });
});

describe("the TD-1 transitions own their obligations", () => {
  /**
   * **Reversed by R83.2, and kept because the risk moved rather than vanished.**
   *
   * This asserted that a blank reason is refused — *the reason is the only
   * record of WHY a class did not happen; a blank one is indistinguishable
   * later from a reason that was lost.* The Owner decided a class is sometimes
   * simply not held, and that demanding a sentence first is a gate with no
   * purpose. So a blank reason is now **accepted and normalised to absent**,
   * which is what keeps *«»* and *nothing* one state rather than two that
   * render differently — the half of the old concern that survives.
   */
  it("accepts a cancellation with NO reason, storing absence rather than emptiness (R83.2)", async () => {
    for (const reason of ["", "   ", undefined]) {
      const s = await freshSession();
      const res = await call("POST", `/sessions/${s.id}/cancel`, superAdmin, {
        version: s.version,
        ...(reason === undefined ? {} : { reason }),
      });
      expect(res.status).toBe(200);

      const row = await prisma.session.findUniqueOrThrow({
        where: { id: s.id },
        select: { status: true, cancellationReason: true },
      });
      expect(row.status).toBe("cancelled");
      // Never the empty string: one state, not two.
      expect(row.cancellationReason).toBeNull();
    }
  });

  it("still records a reason when one is given", async () => {
    const s = await freshSession();
    const res = await call("POST", `/sessions/${s.id}/cancel`, superAdmin, {
      version: s.version,
      reason: "الأستاذة مريضة",
    });
    expect(res.status).toBe(200);
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: s.id },
      select: { cancellationReason: true },
    });
    expect(row.cancellationReason).toBe("الأستاذة مريضة");
  });

  it("cancels with a reason, and the reason travels on the DTO", async () => {
    const s = await freshSession();
    const res = await call("POST", `/sessions/${s.id}/cancel`, superAdmin, {
      version: s.version,
      reason: `${TAG} عطلة`,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.cancellation_reason).toBe(`${TAG} عطلة`);
    expect(Object.keys(res.body).sort()).toEqual(SESSION_KEYS);
  });

  it("restores a cancelled future session, and refuses a past one", async () => {
    const s = await freshSession();
    const cancelled = await call(
      "POST",
      `/sessions/${s.id}/cancel`,
      superAdmin,
      {
        version: s.version,
        reason: `${TAG} سبب`,
      },
    );
    expect(cancelled.status).toBe(200);

    const restored = await call(
      "POST",
      `/sessions/${s.id}/restore`,
      superAdmin,
      {
        version: cancelled.body.version,
      },
    );
    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe("scheduled");

    // A past class that did not happen cannot be asserted back onto the
    // timetable — that is a false historical record, not a recoverable mistake.
    const past = await prisma.session.create({
      data: {
        scheduleId,
        date: new Date("2020-01-01T00:00:00Z"),
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        status: "cancelled",
        cancellationReason: `${TAG} قديم`,
      },
      select: { id: true, version: true },
    });
    const res = await call("POST", `/sessions/${past.id}/restore`, superAdmin, {
      version: past.version,
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("SESSION_IN_PAST");
  });

  it("refuses a transition TD-1 does not allow", async () => {
    // Restoring something already scheduled is not a recoverable no-op; it is a
    // transition the state machine does not define.
    const s = await freshSession();
    const res = await call("POST", `/sessions/${s.id}/restore`, superAdmin, {
      version: s.version,
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("STATE_CONFLICT");
  });
});

describe("content links never destroy the file (TD-3.12, §4.9)", () => {
  it("links, refuses a duplicate, and unlinks leaving the content alive", async () => {
    const s = await freshSession();

    const linked = await call("POST", `/sessions/${s.id}/content`, superAdmin, {
      educational_content_id: contentId,
    });
    expect(linked.status).toBe(201);
    expect(Object.keys(linked.body).sort()).toEqual(LINK_KEYS);
    // The link is its own row — this id addresses the association, not the file.
    expect(linked.body.id).not.toBe(contentId);
    expect(linked.body.educational_content_id).toBe(contentId);

    const again = await call("POST", `/sessions/${s.id}/content`, superAdmin, {
      educational_content_id: contentId,
    });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("DUPLICATE");

    const unlinked = await call(
      "DELETE",
      `/sessions/${s.id}/content/${contentId}`,
      superAdmin,
    );
    expect(unlinked.status).toBe(204);

    // The whole point: the content outlives the link. Destroying it here would
    // remove it from every other session, screen and download URL.
    const content = await prisma.educationalContent.findUniqueOrThrow({
      where: { id: contentId },
      select: { deletedAt: true },
    });
    expect(content.deletedAt).toBeNull();

    // TD-5: the link row survives tombstoned, so the fact it once existed does too.
    const link = await prisma.sessionContent.findFirstOrThrow({
      where: { sessionId: s.id, contentId },
      select: { deletedAt: true },
    });
    expect(link.deletedAt).not.toBeNull();
  });

  it("unlinking something that is not linked is a 404", async () => {
    const s = await freshSession();
    const res = await call(
      "DELETE",
      `/sessions/${s.id}/content/${contentId}`,
      superAdmin,
    );
    expect(res.status).toBe(404);
  });
});

describe("the routes are mounted and guarded (TD-2)", () => {
  it("refuses an anonymous caller with the TD-3.8 envelope", async () => {
    const s = await freshSession();
    const res = await call("PATCH", `/sessions/${s.id}`, undefined, {
      version: s.version,
    });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("a teacher who staffs nothing cannot reach the session — 404, never 403", async () => {
    // A 403 would confirm the session exists (§20 rule 17). TD-2 gives a Teacher
    // the sessions they staff, which is why the route is not under `/admin/`:
    // the prefix would misdescribe the audience.
    const s = await freshSession();
    for (const [method, path, body] of [
      ["PATCH", `/sessions/${s.id}`, { version: s.version }],
      ["POST", `/sessions/${s.id}/cancel`, { version: s.version, reason: "x" }],
      [
        "POST",
        `/sessions/${s.id}/content`,
        { educational_content_id: contentId },
      ],
    ] as const) {
      const res = await call(method, path, outsiderTeacher, body);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
    }
  });
});
