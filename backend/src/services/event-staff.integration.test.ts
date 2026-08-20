import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import type { RoleScope } from "../policies/branch-scope.js";
import { createEvent, setEventStaff, updateEvent } from "./event.service.js";
import {
  eventsStaffedBy,
  isResponsibleForEvent,
} from "../policies/roster-resolution.js";

/**
 * **Event responsibility as event scope (§4.4, SRS Revision 71).**
 *
 * The gap this closes is authorization, not cosmetics: a Teacher's event scope
 * derived from **teaching schedules**, so a مؤطرة responsible for a celebration
 * who teaches nothing had empty scope and could manage nothing — the
 * association's own way of running an event was unrepresentable.
 *
 * Every case is asserted from **both** sides, because a scope test that only
 * proves the positive proves nothing about containment.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[event-staff-test]";

let categoryId: string;
let levelId: string;
let branchA: string;
let groupA: string;
let adminId: string;

const actorOf = (userId: string, scopes: RoleScope[]): Actor => ({
  userId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = (): Actor =>
  actorOf(adminId, [{ role: "super_admin", branches: null }]);
const teacher = (id: string): Actor =>
  actorOf(id, [{ role: "teacher", branches: null }]);

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code?: string }> {
  try {
    await run();
    return {};
  } catch (e) {
    return e as { code?: string };
  }
}

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

async function clear(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = events.map((e) => e.id);
  if (ids.length > 0) {
    await prisma.eventStaff.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.eventAdministrativeGroup.deleteMany({
      where: { eventId: { in: ids } },
    });
    await prisma.eventBranch.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.eventCategory.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.eventLevel.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { targetId: { in: ids } } });
    // R82 — notices RESTRICT the event they are about; teardown clears them first.
    await prisma.notification.deleteMany({ where: { event: { id: { in: ids } } } });
    await prisma.event.deleteMany({ where: { id: { in: ids } } });
  }

  const schedules = await prisma.recurringCourseSchedule.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const scheduleIds = schedules.map((s) => s.id);
  if (scheduleIds.length > 0) {
    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: { in: scheduleIds } },
    });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: { in: scheduleIds } },
    });
  }

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.eventStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: userIds } },
    });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.administrativeGroup.deleteMany({
    where: { levelId: { in: levels.map((l) => l.id) } },
  });
  await prisma.level.deleteMany({
    where: { id: { in: levels.map((l) => l.id) } },
  });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  adminId = await person("مسؤولة");
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } }))
    .id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: "any" },
    })
  ).id;
  branchA = (
    await prisma.branch.create({
      data: {
        name: `${TAG} فرع أ`,
        operationalStartDate: new Date("2020-01-01"),
      },
    })
  ).id;
  groupA = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة أ`, levelId, branchId: branchA },
    })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** An event an Admin set up, scoped to one group. */
async function adminEvent(title: string): Promise<string> {
  const { event } = await createEvent(prisma, superAdmin(), {
    title: `${TAG} ${title}`,
    startDate: new Date("2098-06-01"),
    visibility: "private",
    recurrenceType: "none",
    groupIds: [groupA],
  } as never);
  return event.id;
}

describe("R71 — a مؤطرة responsible for an event may manage it", () => {
  it("with NO teaching assignment at all", async () => {
    // **The case the audit found unrepresentable.** Her event scope derived
    // from teaching schedules, of which she has none, so before R71 she could
    // not touch the celebration she answers for.
    const eventId = await adminEvent("حفل");
    const her = await person("مؤطرة الحفل");

    const before = await failure(() =>
      updateEvent(prisma, teacher(her), eventId, 0, {
        title: `${TAG} حفل معدّل`,
      }),
    );
    expect(before.code).toBe("NOT_FOUND");

    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: her, position: "responsible" },
    ]);

    await updateEvent(prisma, teacher(her), eventId, 0, {
      title: `${TAG} حفل معدّل`,
    });
    const row = await prisma.event.findUnique({ where: { id: eventId } });
    expect(row?.title).toBe(`${TAG} حفل معدّل`);
  });

  it("an ASSISTANT may not edit it", async () => {
    // R71.3 — the one place a `*Staff` position is authorization-bearing. An
    // event names ONE answerable person, where a class has co-teachers who
    // deliver it equally and R43 deliberately gave them one rule.
    const eventId = await adminEvent("حفل بمساعدة");
    const helper = await person("مؤطرة مساعدة");

    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: helper, position: "assistant" },
    ]);

    const denied = await failure(() =>
      updateEvent(prisma, teacher(helper), eventId, 0, {
        title: `${TAG} محاولة`,
      }),
    );
    expect(denied.code).toBe("NOT_FOUND");
    // …but she IS on the event, which is what makes it visible to her.
    expect((await eventsStaffedBy(prisma, helper)).get(eventId)).toBe(
      "assistant",
    );
    expect(await isResponsibleForEvent(prisma, helper, eventId)).toBe(false);
  });

  it("an unrelated مؤطرة reaches nothing", async () => {
    const eventId = await adminEvent("حفل بعيد");
    const stranger = await person("مؤطرة أخرى");

    const denied = await failure(() =>
      updateEvent(prisma, teacher(stranger), eventId, 0, {
        title: `${TAG} تسلل`,
      }),
    );
    expect(denied.code).toBe("NOT_FOUND");
    expect((await eventsStaffedBy(prisma, stranger)).size).toBe(0);
  });
});

describe("R71 — creating an event is what makes a مؤطرة answerable", () => {
  it("records the creating مؤطرة as responsible, in the same transaction", async () => {
    // Structural rather than a grant: assigning staff is otherwise Admin-only,
    // and without this a مؤطرة would need an Admin to hand back the event she
    // had just created before she could edit it.
    const her = await person("مؤطرة منشئة");
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة`,
        subjectId: (
          await prisma.subject.create({ data: { name: `${TAG} مادة` } })
        ).id,
        teachingMode: "administrative_group",
        administrativeGroupId: groupA,
        branchId: branchA,
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        recurrence: "weekly",
        weekdays: ["monday"],
        academicYearId: (
          await prisma.academicYear.findFirstOrThrow({
            where: { isCurrent: true },
          })
        ).id,
      },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: schedule.id, userId: her, position: "teacher" },
    });

    const { event } = await createEvent(prisma, teacher(her), {
      title: `${TAG} نشاط من تنظيمها`,
      startDate: new Date("2098-07-01"),
      visibility: "private",
      recurrenceType: "none",
      groupIds: [groupA],
    } as never);

    expect(await isResponsibleForEvent(prisma, her, event.id)).toBe(true);

    // `course_schedule_staff` is RESTRICT — the staff row goes before the
    // schedule it points at, the same ordering `clear()` uses.
    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: schedule.id },
    });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: schedule.id },
    });
    await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  it("an Admin creating one is NOT recorded — their authority is their branch", async () => {
    // A row saying an Admin personally answers for every event they set up
    // would be a fiction, and it would make «من المسؤولة عن هذا الحفل؟»
    // unanswerable by putting the wrong name in it.
    const eventId = await adminEvent("نشاط إداري");
    expect(await prisma.eventStaff.count({ where: { eventId } })).toBe(0);
  });
});

describe("R71.4 as narrowed 2026-08-20 — she staffs her OWN event, and only that", () => {
  /**
   * **Restated, because the rule changed and the reason it existed did not.**
   *
   * R71.4 kept all event staffing with Admins, on the reasoning that *being
   * answerable for an event is not authority over who else answers for it*.
   * That is right about the **responsible** position and was wrong about
   * assistants: a مؤطرة who may create a celebration in her own scope could not
   * name the two people helping her run it, so she had to ask an Admin.
   *
   * What survives unchanged, and is asserted below: she may not hand the event
   * to somebody else, and she may not staff one she does not answer for.
   */
  it("may now name her assistants on the event she answers for", async () => {
    const eventId = await adminEvent("حفل بمسؤولة");
    const her = await person("مؤطرة مسؤولة");
    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: her, position: "responsible" },
    ]);

    await setEventStaff(prisma, teacher(her), eventId, [
      { userId: her, position: "responsible" },
      { userId: adminId, position: "assistant" },
    ]);

    const rows = await prisma.eventStaff.findMany({
      where: { eventId, deletedAt: null },
      select: { userId: true, position: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.userId === adminId)?.position).toBe("assistant");
  });

  it("may NOT hand the event to somebody else", async () => {
    const eventId = await adminEvent("حفل لا يُسلَّم");
    const her = await person("مسؤولة أخرى");
    const other = await person("مؤطرة ثالثة");
    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: her, position: "responsible" },
    ]);

    // **A forged body, not a hidden control.** The screen offers her only
    // herself; this is the request that never opens a screen.
    const denied = await failure(() =>
      setEventStaff(prisma, teacher(her), eventId, [
        { userId: other, position: "responsible" },
      ]),
    );
    expect(denied.code).toBe("FORBIDDEN");
    expect(denied.details?.["reason"]).toBe("RESPONSIBLE_MUST_BE_SELF");

    // And nothing moved.
    const still = await prisma.eventStaff.findFirst({
      where: { eventId, position: "responsible", deletedAt: null },
      select: { userId: true },
    });
    expect(still?.userId).toBe(her);
  });

  it("may NOT staff an event she does not answer for", async () => {
    const eventId = await adminEvent("حفل زميلة");
    const her = await person("مؤطرة بلا مسؤولية");
    const denied = await failure(() =>
      setEventStaff(prisma, teacher(her), eventId, [
        { userId: her, position: "responsible" },
      ]),
    );
    /**
     * **`NOT_FOUND`, and that is the stricter answer.** `assertMayEdit` refuses
     * her before the ownership check is reached, because a celebration outside
     * her teaching scope is one she may not know exists (§20 rule 17). The
     * ownership check behind it covers the narrower case — an event she CAN
     * edit but does not answer for — and `assertMayEdit` running first is why
     * this fixture cannot reach it. Both refusals are the same property: she
     * staffs her own event and nothing else.
     */
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(denied.code);

    // And nothing moved.
    const rows = await prisma.eventStaff.findMany({
      where: { eventId, deletedAt: null },
    });
    expect(rows.filter((r) => r.userId === her)).toHaveLength(0);
  });

  it("and an Admin's reach is untouched", async () => {
    const eventId = await adminEvent("حفل إداري");
    const one = await person("مؤطرة أ");
    const two = await person("مؤطرة ب");
    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: one, position: "responsible" },
      { userId: two, position: "assistant" },
    ]);
    const rows = await prisma.eventStaff.findMany({
      where: { eventId, deletedAt: null },
      select: { userId: true },
    });
    expect(rows).toHaveLength(2);
  });

  it("refuses two responsible مؤطرات", async () => {
    const eventId = await adminEvent("حفل بمسؤولتين");
    const one = await person("أولى");
    const two = await person("ثانية");
    const denied = await failure(() =>
      setEventStaff(prisma, superAdmin(), eventId, [
        { userId: one, position: "responsible" },
        { userId: two, position: "responsible" },
      ]),
    );
    expect(denied.code).toBe("VALIDATION_FAILED");
  });
});

describe("R71 — reconciliation is tombstone-and-revive (R59)", () => {
  it("tombstones a removed assistant and REVIVES her on return", async () => {
    // The `@@unique([event_id, user_id])` pair is deliberately not filtered on
    // `deleted_at`, so re-inserting would be refused by the constraint — which
    // is exactly what makes revive the only correct reconciliation.
    const eventId = await adminEvent("حفل متكرر");
    const helper = await person("مساعدة عائدة");

    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: helper, position: "assistant" },
    ]);
    const first = await prisma.eventStaff.findFirstOrThrow({
      where: { eventId, userId: helper },
    });

    await setEventStaff(prisma, superAdmin(), eventId, []);
    const tombstoned = await prisma.eventStaff.findFirstOrThrow({
      where: { id: first.id },
    });
    expect(tombstoned.deletedAt).not.toBeNull();
    expect(tombstoned.deletedById).toBe(adminId);

    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: helper, position: "responsible" },
    ]);
    const revived = await prisma.eventStaff.findFirstOrThrow({
      where: { id: first.id },
    });
    // The SAME row — not a second one beside a tombstone.
    expect(revived.deletedAt).toBeNull();
    expect(revived.position).toBe("responsible");
    expect(
      await prisma.eventStaff.count({ where: { eventId, userId: helper } }),
    ).toBe(1);
  });

  it("earns no Trash entry — it is one field of an update (R59)", async () => {
    const eventId = await adminEvent("حفل بلا سلة");
    const helper = await person("مساعدة");
    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: helper, position: "assistant" },
    ]);
    await setEventStaff(prisma, superAdmin(), eventId, []);

    expect(
      await prisma.trash.count({ where: { targetEntity: "EventStaff" } }),
    ).toBe(0);
  });

  it("writes its own audit action, distinct from event.update", async () => {
    const eventId = await adminEvent("حفل مدقّق");
    const helper = await person("مساعدة مدققة");
    await setEventStaff(prisma, superAdmin(), eventId, [
      { userId: helper, position: "assistant" },
    ]);
    // *Who answers for this celebration* is not an attribute edit (R71.4).
    expect(
      await prisma.auditLog.count({
        where: { targetId: eventId, actionType: "event.staff_change" },
      }),
    ).toBe(1);
  });
});

describe("R71 — educational authorization is unchanged", () => {
  it("a مؤطرة still reaches an event through her TEACHING scope alone", async () => {
    // The pre-R71 arm, asserted so the union is a union rather than a
    // replacement: no `EventStaff` row exists for her here.
    const eventId = await adminEvent("نشاط لمجموعتها");
    const her = await person("مؤطرة المجموعة");
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة تدريس` },
    });
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة تدريس`,
        subjectId: subject.id,
        teachingMode: "administrative_group",
        administrativeGroupId: groupA,
        branchId: branchA,
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T10:00:00Z"),
        recurrence: "weekly",
        weekdays: ["tuesday"],
        academicYearId: (
          await prisma.academicYear.findFirstOrThrow({
            where: { isCurrent: true },
          })
        ).id,
      },
    });
    await prisma.courseScheduleStaff.create({
      data: { scheduleId: schedule.id, userId: her, position: "teacher" },
    });

    expect((await eventsStaffedBy(prisma, her)).size).toBe(0);
    await updateEvent(prisma, teacher(her), eventId, 0, {
      title: `${TAG} نشاط معدّل`,
    });

    await prisma.courseScheduleStaff.deleteMany({
      where: { scheduleId: schedule.id },
    });
    await prisma.recurringCourseSchedule.deleteMany({
      where: { id: schedule.id },
    });
    await prisma.subject.deleteMany({ where: { id: subject.id } });
  });

  it("a Super Admin is unaffected in either direction", async () => {
    const eventId = await adminEvent("نشاط للمشرفة");
    await updateEvent(prisma, superAdmin(), eventId, 0, {
      title: `${TAG} نشاط مشرفة`,
    });
    expect(
      (await prisma.event.findUnique({ where: { id: eventId } }))?.title,
    ).toBe(`${TAG} نشاط مشرفة`);
  });
});
