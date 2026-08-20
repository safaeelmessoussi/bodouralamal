import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import type { Actor } from "../policies/actor.js";
import { createLevel } from "./level.service.js";
import {
  createCourseSchedule,
  updateCourseSchedule,
  type CourseScheduleInput,
} from "./course-schedule.service.js";
import { overrideSession } from "./session.service.js";
import {
  createCourseScheduleSchema,
  updateCourseScheduleSchema,
} from "../validators/course-schedule.validators.js";
import { overrideSessionSchema } from "../validators/session.validators.js";
import { resolveDelivery } from "../policies/delivery.js";
import { audienceForSession } from "../policies/roster-resolution.js";

/**
 * **SRS Revision 97 — a teaching occurrence is delivered حضوري or عن بُعد.**
 *
 * What this suite is actually protecting, stated once so a future reader knows
 * which assertions are load-bearing:
 *
 * 1. **There is ONE inheritance mechanism.** Schedule default → snapshot at
 *    materialization → `overridden` protects. Delivery rides it exactly as
 *    `room_id` has since R43.4, and a test that passed while delivery had its
 *    own parallel mechanism would be worthless.
 * 2. **History is never rewritten.** The `overridden` occurrence and the past
 *    both survive a change to the schedule's default.
 * 3. **An online occurrence has NO room, by constraint rather than by filter.**
 *    That is what makes room-collision detection need no special case — so the
 *    collision test here asserts the *absence of a refusal*, which is the
 *    property, not the implementation.
 * 4. **R91 and R92 are untouched.** Delivery is a third, independent dimension,
 *    and the two proofs below exist because "obviously unrelated" is exactly
 *    how a coupling gets shipped.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[delivery-r97]";

/** Fixed "today" so every horizon and expected date is deterministic. */
const NOW = new Date("2026-06-01T08:00:00.000Z");
const at = (hh: number, mm = 0): Date =>
  new Date(Date.UTC(1970, 0, 1, hh, mm, 0));
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

let actorUserId: string;
let categoryId: string;
let branchId: string;
let levelId: string;
let groupId: string;
let roomA: string;
let roomB: string;
let subjectId: string;
let otherSubjectId: string;
let academicYearId: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor =>
  actorOf([{ role: "super_admin", branches: null }]);

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

const baseInput = (
  over: Partial<CourseScheduleInput> = {},
): CourseScheduleInput => ({
  title: `${TAG} حلقة`,
  subjectId,
  teachingMode: "administrative_group",
  targetId: groupId,
  branchId,
  roomId: roomA,
  startTime: at(15),
  endTime: at(17),
  recurrence: "weekly",
  weekdays: ["tuesday"],
  academicYearId,
  staff: [],
  ...over,
});

const sessionsOf = async (
  scheduleId: string,
): Promise<
  {
    id: string;
    date: string;
    deliveryMode: string;
    onlineMediaMode: string | null;
    roomId: string | null;
    overridden: boolean;
    version: number;
  }[]
> =>
  (
    await prisma.session.findMany({
      where: { scheduleId, deletedAt: null },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        deliveryMode: true,
        onlineMediaMode: true,
        roomId: true,
        overridden: true,
        version: true,
      },
    })
  ).map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) }));

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  return u.id;
}

async function cleanup(): Promise<void> {
  const tagged = { name: { startsWith: TAG } };
  const taggedPerson = { nameArabic: { startsWith: TAG } };
  const scheduleWhere = { schedule: { subject: tagged } };

  await prisma.sessionAudienceBranch.deleteMany({
    where: { session: scheduleWhere },
  });
  await prisma.sessionContent.deleteMany({ where: { session: scheduleWhere } });
  await prisma.sessionStaff.deleteMany({ where: { session: scheduleWhere } });
  await prisma.notification.deleteMany({ where: { session: scheduleWhere } });
  await prisma.session.deleteMany({ where: scheduleWhere });
  await prisma.courseScheduleStaff.deleteMany({
    where: { schedule: { subject: tagged } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { subject: tagged },
  });
  await prisma.enrollment.deleteMany({ where: { student: taggedPerson } });
  await prisma.administrativeGroup.deleteMany({ where: { level: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
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
  actorUserId = await person("المسؤولة");
  categoryId = (
    await prisma.category.create({ data: { name: `${TAG} الكبار` } })
  ).id;
  branchId = (
    await prisma.branch.create({
      data: { name: `${TAG} تاركة`, operationalStartDate: day("2026-01-01") },
    })
  ).id;
  levelId = (
    await createLevel(prisma, superAdmin(), {
      name: `${TAG} المستوى 1`,
      categoryId,
      genderRestriction: "any",
    })
  ).level.id;
  groupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} المجموعة 1`, levelId, branchId, displayOrder: 0 },
    })
  ).id;
  roomA = (
    await prisma.room.create({ data: { name: `${TAG} قاعة 5`, branchId } })
  ).id;
  roomB = (
    await prisma.room.create({ data: { name: `${TAG} قاعة 6`, branchId } })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} تفسير` } }))
    .id;
  otherSubjectId = (
    await prisma.subject.create({ data: { name: `${TAG} فقه` } })
  ).id;
  await prisma.levelSubject.createMany({
    data: [
      { levelId, subjectId },
      { levelId, subjectId: otherSubjectId },
    ],
  });
  academicYearId = (
    await prisma.academicYear.findFirstOrThrow({ select: { id: true } })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/* ── The migration's own claim ───────────────────────────────────────────── */

describe("existing data (R97.8)", () => {
  it("every pre-R97 row reads as in_person with no media mode", async () => {
    // The backfill's claim, asserted against the LIVE database rather than
    // against the migration file: `NOT NULL DEFAULT 'in_person'` is only
    // preserving behaviour if no row escaped it.
    const stray = await prisma.recurringCourseSchedule.count({
      where: {
        OR: [
          { deliveryMode: "online", onlineMediaMode: null },
          { deliveryMode: "in_person", onlineMediaMode: { not: null } },
          { deliveryMode: "online", roomId: { not: null } },
        ],
      },
    });
    const straySessions = await prisma.session.count({
      where: {
        OR: [
          { deliveryMode: "online", onlineMediaMode: null },
          { deliveryMode: "in_person", onlineMediaMode: { not: null } },
          { deliveryMode: "online", roomId: { not: null } },
        ],
      },
    });
    expect({ stray, straySessions }).toEqual({ stray: 0, straySessions: 0 });
  });
});

/* ── Creation ────────────────────────────────────────────────────────────── */

describe("creating a class with a delivery mode (R97.1)", () => {
  it("defaults to in_person when the caller says nothing", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput(),
      NOW,
    );
    const row = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id },
      select: { deliveryMode: true, onlineMediaMode: true, roomId: true },
    });
    expect(row).toEqual({
      deliveryMode: "in_person",
      onlineMediaMode: null,
      roomId: roomA,
    });
  });

  it("creates an online audio+video class", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_video",
      }),
      NOW,
    );
    const row = await prisma.recurringCourseSchedule.findUniqueOrThrow({
      where: { id },
      select: { deliveryMode: true, onlineMediaMode: true, branchId: true },
    });
    expect(row).toEqual({
      deliveryMode: "online",
      onlineMediaMode: "audio_video",
      // **R97.6 — the Branch SURVIVES going online.** It is the class's
      // administrative and educational scope, not its venue.
      branchId,
    });
  });

  it("creates an online audio-only class", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_only",
      }),
      NOW,
    );
    await expect(
      prisma.recurringCourseSchedule.findUniqueOrThrow({
        where: { id },
        select: { onlineMediaMode: true },
      }),
    ).resolves.toEqual({ onlineMediaMode: "audio_only" });
  });

  it("CLEARS a room submitted alongside online rather than storing it", async () => {
    // The service resolves the three columns together, so a caller that sends
    // a stale room gets a class with no venue — not a CHECK violation and not a
    // silently stored room the calendar would then render.
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: roomA,
        deliveryMode: "online",
        onlineMediaMode: "audio_video",
      }),
      NOW,
    );
    await expect(
      prisma.recurringCourseSchedule.findUniqueOrThrow({
        where: { id },
        select: { roomId: true },
      }),
    ).resolves.toEqual({ roomId: null });
  });
});

/* ── The boundary refuses incompatible combinations (R97.1, §7/§8) ───────── */

describe("the boundary refuses what cannot be stored", () => {
  const bodyBase = {
    title: "حلقة",
    subject_id: "00000000-0000-4000-8000-000000000001",
    teaching_mode: "administrative_group" as const,
    target_id: "00000000-0000-4000-8000-000000000002",
    branch_id: "00000000-0000-4000-8000-000000000003",
    start_time: "15:00",
    end_time: "17:00",
    recurrence: "weekly" as const,
    weekdays: ["tuesday" as const],
    academic_year_id: "00000000-0000-4000-8000-000000000004",
  };

  it("refuses online with no media mode", () => {
    const r = createCourseScheduleSchema.safeParse({
      ...bodyBase,
      delivery_mode: "online",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["online_media_mode"]);
  });

  it("refuses in_person CARRYING a media mode — the half nobody remembers", () => {
    // Dropping the stray key would leave the caller believing something false
    // about the row it just wrote (§20 rule 12).
    const r = createCourseScheduleSchema.safeParse({
      ...bodyBase,
      delivery_mode: "in_person",
      online_media_mode: "audio_only",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["online_media_mode"]);
  });

  it("refuses online WITH a room", () => {
    const r = createCourseScheduleSchema.safeParse({
      ...bodyBase,
      delivery_mode: "online",
      online_media_mode: "audio_video",
      room_id: "00000000-0000-4000-8000-000000000005",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toContain("room_id");
  });

  it("refuses a media mode with no delivery mode at all", () => {
    const r = updateCourseScheduleSchema.safeParse({
      version: 0,
      online_media_mode: "audio_video",
    });
    expect(r.success).toBe(false);
  });

  it("applies the SAME rule to a session override — one copy, not two", () => {
    // The occurrence boundary shares `checkDelivery` with the schedule's, so an
    // occurrence can never reach a combination a schedule could not.
    const r = overrideSessionSchema.safeParse({
      version: 0,
      delivery_mode: "online",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["online_media_mode"]);
  });

  it("accepts the two valid shapes", () => {
    expect(
      createCourseScheduleSchema.safeParse({
        ...bodyBase,
        delivery_mode: "online",
        online_media_mode: "audio_only",
      }).success,
    ).toBe(true);
    expect(
      createCourseScheduleSchema.safeParse({
        ...bodyBase,
        delivery_mode: "in_person",
        room_id: "00000000-0000-4000-8000-000000000005",
      }).success,
    ).toBe(true);
  });
});

/* ── The database is the backstop, not merely the boundary (R97.1) ───────── */

describe("the CHECK constraints hold even against a raw write", () => {
  it("refuses an online session carrying a room", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput(),
      NOW,
    );
    const [first] = await sessionsOf(id);
    // A forged path around the service — which is exactly what a future
    // repository method could become — still cannot write the bad state.
    await expect(
      prisma.$executeRaw`UPDATE "session" SET delivery_mode = 'online', online_media_mode = 'audio_video' WHERE id = ${first!.id}::uuid`,
    ).rejects.toThrow(/session_online_no_room_check/);
  });

  it("refuses an online schedule with no media mode", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ roomId: null }),
      NOW,
    );
    await expect(
      prisma.$executeRaw`UPDATE "recurring_course_schedule" SET delivery_mode = 'online' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/course_schedule_delivery_check/);
  });
});

/* ── Materialization snapshots it (R97.2) ────────────────────────────────── */

describe("the schedule is a DEFAULT and the Session is the occurrence (R97.2)", () => {
  it("materializes every occurrence with the schedule's delivery", async () => {
    const { id, materialized } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_only",
      }),
      NOW,
    );
    expect(materialized.created).toBeGreaterThan(0);
    const rows = await sessionsOf(id);
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) =>
          r.deliveryMode === "online" &&
          r.onlineMediaMode === "audio_only" &&
          r.roomId === null,
      ),
    ).toBe(true);
  });

  it("does NOT add a second override marker — `overridden` is the one", async () => {
    // A materialized occurrence is not "overridden" merely because it carries a
    // delivery: the flag means *a human decided about this one*.
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_video",
      }),
      NOW,
    );
    expect((await sessionsOf(id)).every((r) => r.overridden === false)).toBe(
      true,
    );
  });
});

/* ── One occurrence overrides (R97.3) ────────────────────────────────────── */

describe("one occurrence may differ, and only that one (R97.3)", () => {
  it("online schedule → ONE occurrence in person, next stays online", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_video",
      }),
      NOW,
    );
    const before = await sessionsOf(id);
    const target = before[1]!;

    await overrideSession(prisma, superAdmin(), target.id, {
      version: target.version,
      deliveryMode: "in_person",
      onlineMediaMode: null,
      roomId: roomA,
    });

    const after = await sessionsOf(id);
    const changed = after.find((r) => r.id === target.id)!;
    expect({
      deliveryMode: changed.deliveryMode,
      onlineMediaMode: changed.onlineMediaMode,
      roomId: changed.roomId,
      overridden: changed.overridden,
    }).toEqual({
      deliveryMode: "in_person",
      onlineMediaMode: null,
      roomId: roomA,
      overridden: true,
    });

    // **Every OTHER occurrence is untouched** — the point of the whole feature.
    expect(
      after
        .filter((r) => r.id !== target.id)
        .every(
          (r) => r.deliveryMode === "online" && r.onlineMediaMode === "audio_video",
        ),
    ).toBe(true);
  });

  it("in-person schedule → ONE occurrence online, and its room is CLEARED", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ roomId: roomA }),
      NOW,
    );
    const before = await sessionsOf(id);
    const target = before[1]!;

    await overrideSession(prisma, superAdmin(), target.id, {
      version: target.version,
      deliveryMode: "online",
      onlineMediaMode: "audio_video",
    });

    const after = await sessionsOf(id);
    const changed = after.find((r) => r.id === target.id)!;
    // No stale venue survives the switch: a reader cannot render a room for a
    // class that has none, because there is none to render.
    expect({ mode: changed.deliveryMode, room: changed.roomId }).toEqual({
      mode: "online",
      room: null,
    });
    expect(
      after
        .filter((r) => r.id !== target.id)
        .every((r) => r.deliveryMode === "in_person" && r.roomId === roomA),
    ).toBe(true);
  });

  it("records the change on the audit row", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput(),
      NOW,
    );
    const target = (await sessionsOf(id))[1]!;
    await overrideSession(prisma, superAdmin(), target.id, {
      version: target.version,
      deliveryMode: "online",
      onlineMediaMode: "audio_only",
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: "session.override", targetId: target.id },
      orderBy: { createdAt: "desc" },
      select: { detail: true },
    });
    const changed = (row.detail as { changed: Record<string, unknown> }).changed;
    // *When did this class stop meeting in the building* must be answerable.
    expect(changed["delivery_mode"]).toEqual({
      from: "in_person",
      to: "online",
    });
  });
});

/* ── Resync and historical truth (R97.2, R97.4) ──────────────────────────── */

describe("changing the default rewrites the FUTURE only (R97.4)", () => {
  it("resyncs un-protected future occurrences", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ roomId: roomA }),
      NOW,
    );
    await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      {
        version: 0,
        deliveryMode: "online",
        onlineMediaMode: "audio_video",
      },
      NOW,
    );
    const rows = await sessionsOf(id);
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) =>
          r.deliveryMode === "online" &&
          r.onlineMediaMode === "audio_video" &&
          r.roomId === null,
      ),
    ).toBe(true);
  });

  it("LEAVES the overridden occurrence exactly as the human set it", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ roomId: roomA }),
      NOW,
    );
    const target = (await sessionsOf(id))[2]!;
    await overrideSession(prisma, superAdmin(), target.id, {
      version: target.version,
      deliveryMode: "online",
      onlineMediaMode: "audio_only",
    });

    // The schedule now moves to audio+video for everything it still governs.
    const result = await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, deliveryMode: "online", onlineMediaMode: "audio_video" },
      NOW,
    );
    expect(
      result.materialized.protectedSessions.flatMap((p) => p.reasons),
    ).toContain("OVERRIDDEN");

    const after = (await sessionsOf(id)).find((r) => r.id === target.id)!;
    // Still `audio_only`: the resync never reached it, which is precisely how
    // "this one Thursday is different" survives an edit to the class.
    expect(after.onlineMediaMode).toBe("audio_only");
  });

  it("never rewrites a PAST occurrence", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ roomId: roomA, anchorDate: day("2026-01-06") }),
      NOW,
    );
    // A past occurrence, written directly: materialization deliberately starts
    // at today, so this is the only way to have one — and editing a past
    // session through the UI is forbidden, which is why the proof is here.
    const past = await prisma.session.create({
      data: {
        scheduleId: id,
        date: day("2026-03-10"),
        startTime: at(15),
        endTime: at(17),
        // **No room, because R97.5 makes that state unrepresentable.** The
        // first draft of this fixture wrote `roomId: roomA` here and the CHECK
        // refused it — which is the constraint proving itself against a real
        // write rather than against a test that was told to expect a refusal.
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_only",
        status: "held",
      },
      select: { id: true },
    });

    await updateCourseSchedule(
      prisma,
      superAdmin(),
      id,
      { version: 0, deliveryMode: "in_person", roomId: roomB },
      NOW,
    );

    const after = await prisma.session.findUniqueOrThrow({
      where: { id: past.id },
      select: { deliveryMode: true, onlineMediaMode: true },
    });
    // October stays what October was.
    expect(after).toEqual({
      deliveryMode: "online",
      onlineMediaMode: "audio_only",
    });
  });
});

/* ── Room collisions (R97.5) ─────────────────────────────────────────────── */

describe("an online class occupies no room, so it collides over nothing", () => {
  it("two online classes at the same hour do not conflict", async () => {
    await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_video",
      }),
      NOW,
    );
    // Same branch, same weekday, same hour, a second Subject — under the old
    // model both would have needed a room and clashed. **Exercised through the
    // real create path**, so what is asserted is the absence of a 409 an
    // administrator would actually have received.
    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({
          subjectId: otherSubjectId,
          roomId: null,
          deliveryMode: "online",
          onlineMediaMode: "audio_only",
        }),
        NOW,
      ),
    );
    expect(err.code).toBeUndefined();
  });

  it("an in-person class still conflicts over its room — the guard is not weakened", async () => {
    await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ roomId: roomA }),
      NOW,
    );
    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({ subjectId: otherSubjectId, roomId: roomA }),
        NOW,
      ),
    );
    expect(err.code).toBe("SCHEDULE_CONFLICT");
    expect(
      (err.details?.["conflicts"] as { kind: string }[]).some(
        (c) => c.kind === "room",
      ),
    ).toBe(true);
  });

  it("STAFF time conflicts stay real across delivery modes (R97.7)", async () => {
    const teacher = await person("المؤطرة");
    await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: null,
        deliveryMode: "online",
        onlineMediaMode: "audio_video",
        staff: [{ userId: teacher, position: "teacher" }],
      }),
      NOW,
    );
    // She cannot deliver an online class and an in-person one in the same hour:
    // her TIME is committed even though no room is.
    const err = await failure(() =>
      createCourseSchedule(
        prisma,
        superAdmin(),
        baseInput({
          subjectId: otherSubjectId,
          roomId: roomB,
          staff: [{ userId: teacher, position: "teacher" }],
        }),
        NOW,
      ),
    );
    expect(err.code).toBe("SCHEDULE_CONFLICT");
    expect(
      (err.details?.["conflicts"] as { kind: string }[]).some(
        (c) => c.kind === "teacher",
      ),
    ).toBe(true);
  });
});

/* ── R91 and R92 are untouched (R97.7, R97.6) ────────────────────────────── */

describe("delivery is independent of staffing and of audience", () => {
  it("R91 — moving an occurrence online changes no assignment", async () => {
    const teacher = await person("سناء");
    const assistant = await person("أمينة");
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({
        roomId: roomA,
        staff: [
          { userId: teacher, position: "teacher" },
          { userId: assistant, position: "assistant" },
        ],
      }),
      NOW,
    );
    const target = (await sessionsOf(id))[1]!;
    const before = await prisma.sessionStaff.findMany({
      where: { sessionId: target.id, deletedAt: null },
      select: { userId: true, position: true },
      orderBy: { userId: "asc" },
    });

    await overrideSession(prisma, superAdmin(), target.id, {
      version: target.version,
      deliveryMode: "online",
      onlineMediaMode: "audio_video",
    });

    const after = await prisma.sessionStaff.findMany({
      where: { sessionId: target.id, deletedAt: null },
      select: { userId: true, position: true },
      orderBy: { userId: "asc" },
    });
    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
  });

  it("R92 — the audience resolves identically before and after going online", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput({ roomId: roomA, teachingMode: "entire_level", targetId: levelId }),
      NOW,
    );
    const target = (await sessionsOf(id))[1]!;
    const before = await audienceForSession(prisma, target.id);

    await overrideSession(prisma, superAdmin(), target.id, {
      version: target.version,
      deliveryMode: "online",
      onlineMediaMode: "audio_only",
    });

    const after = await audienceForSession(prisma, target.id);
    // The canonical resolver's answer, unchanged: delivery says HOW the class
    // happens and never WHO is expected at it.
    expect(after).toEqual(before);
  });
});

/* ── The policy itself ───────────────────────────────────────────────────── */

describe("resolveDelivery — the single resolution (policies/delivery.ts)", () => {
  const inPerson = {
    deliveryMode: "in_person" as const,
    onlineMediaMode: null,
    roomId: "room-a",
  };
  const online = {
    deliveryMode: "online" as const,
    onlineMediaMode: "audio_video" as const,
    roomId: null,
  };

  it("an empty patch changes nothing", () => {
    expect(resolveDelivery(inPerson, {})).toEqual(inPerson);
    expect(resolveDelivery(online, {})).toEqual(online);
  });

  it("going online clears the room", () => {
    expect(
      resolveDelivery(inPerson, {
        deliveryMode: "online",
        onlineMediaMode: "audio_only",
      }),
    ).toEqual({
      deliveryMode: "online",
      onlineMediaMode: "audio_only",
      roomId: null,
    });
  });

  it("going in person clears the media mode", () => {
    expect(
      resolveDelivery(online, { deliveryMode: "in_person", roomId: "room-b" }),
    ).toEqual({
      deliveryMode: "in_person",
      onlineMediaMode: null,
      roomId: "room-b",
    });
  });

  it("changing only the media mode keeps the class online", () => {
    // The failure this prevents: a partial patch reading as *«and make it
    // in-person»*, which would silently move a class into a room it has not
    // got.
    expect(resolveDelivery(online, { onlineMediaMode: "audio_only" })).toEqual({
      deliveryMode: "online",
      onlineMediaMode: "audio_only",
      roomId: null,
    });
  });

  it("distinguishes `undefined` (unchanged) from `null` (cleared) on the room", () => {
    expect(resolveDelivery(inPerson, {}).roomId).toBe("room-a");
    expect(resolveDelivery(inPerson, { roomId: null }).roomId).toBe(null);
  });
});

/* ── A refusal that must NOT become a silent success ─────────────────────── */

describe("negative authorization is unchanged by delivery (§20 rule 17)", () => {
  it("a stranger cannot move somebody else's occurrence online", async () => {
    const { id } = await createCourseSchedule(
      prisma,
      superAdmin(),
      baseInput(),
      NOW,
    );
    const target = (await sessionsOf(id))[1]!;
    const outsider = await person("غريبة");
    const err = await failure(() =>
      overrideSession(
        prisma,
        {
          userId: outsider,
          roles: ["teacher"],
          roleScopes: [{ role: "teacher", branches: [] }],
        },
        target.id,
        {
          version: target.version,
          deliveryMode: "online",
          onlineMediaMode: "audio_video",
        },
      ),
    );
    // Out of reach answers NOT_FOUND, never FORBIDDEN (§20 rule 17).
    expect(err.code).toBe("NOT_FOUND");
    const after = (await sessionsOf(id)).find((r) => r.id === target.id)!;
    expect(after.deliveryMode).toBe("in_person");
  });
});
