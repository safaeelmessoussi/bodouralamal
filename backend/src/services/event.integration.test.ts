import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import {
  clearTeachingContext,
  createTeachingContext,
  staff as staffSchedule,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";
import type { Actor } from "../policies/actor.js";
import {
  backfillAttach,
  backfillCandidates,
  createEvent,
  deleteEvent,
  updateEvent,
  type EventInput,
} from "./event.service.js";

/**
 * Events — §4.4, §7, TD-2, TD-5, TD-11.
 *
 * The property that matters most is that scope joins are **materialised at
 * creation**, so the tests count real rows in the four join tables rather than
 * trusting a wildcard to be interpreted correctly later.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[event-test]";

let levelId: string;
let categoryId: string;
let actorUserId: string;

const actorOf = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => actorOf([{ role: "super_admin", branches: null }]);
const admin = (branches: string[]) => actorOf([{ role: "admin", branches }]);
const parent = () => actorOf([{ role: "parent", branches: null }]);

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day("2026-06-01");

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

async function teacherUser(label: string): Promise<string> {
  const id = await person(label);
  const r = await prisma.role.findUnique({ where: { name: "teacher" } });
  await prisma.userBranchRole.create({
    data: { userId: id, roleId: r!.id, branchId: null },
  });
  return id;
}

/** `openedOn` in the past = operational; in the future = not yet open. */
async function makeBranch(
  name: string,
  openedOn = day("2026-01-01"),
): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: openedOn },
  });
  return b.id;
}

/** Revision 43: events scope to **Administrative Groups** (§7), and a teacher
 *  reaches one through a Course Schedule (§4.4c). The shared fixture builds
 *  both. */
const contexts = new Map<string, TeachingFixture>();

async function makeGroup(branchId: string): Promise<string> {
  const ctx = await createTeachingContext(
    prisma,
    `${TAG} ${Math.random().toString(36).slice(2, 7)}`,
    branchId,
    { levelId, categoryId },
  );
  contexts.set(ctx.administrativeGroupId, ctx);
  return ctx.administrativeGroupId;
}

function eventInput(over: Partial<EventInput> = {}): EventInput {
  return {
    title: `${TAG} نشاط`,
    visibility: "private",
    startDate: day("2026-06-15"),
    recurrenceType: "none",
    ...over,
  };
}

async function clear(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({
    where: { eventId: { in: eventIds } },
  });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventAdministrativeGroup.deleteMany({
    where: { eventId: { in: eventIds } },
  });
  // R71 — `event_staff` is RESTRICT like the other event children, so it
  // goes before the event it points at.
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  // R82 — notices RESTRICT the event they are about; teardown clears them first.
  await prisma.notification.deleteMany({ where: { event: { id: { in: eventIds } } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  await clearTeachingContext(prisma, TAG);
  contexts.clear();

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: eventIds } }],
    },
  });
  await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  const level = await prisma.level.findFirst({
    select: { id: true, categoryId: true },
  });
  levelId = level!.id;
  categoryId = level!.categoryId;
  actorUserId = await person("فاعلة");
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("§4.4 — scope joins are materialised at creation", () => {
  it("a global event attaches every ALREADY-OPERATIONAL branch", async () => {
    const open1 = await makeBranch("مراكش");
    const open2 = await makeBranch("الدار البيضاء");
    // Opens after "today" — §4.4 leaves it out, and backfill is how it joins.
    const future = await makeBranch("أكادير", day("2026-12-01"));

    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ global: true }),
      TODAY,
    );

    const ids = (
      await prisma.eventBranch.findMany({
        where: { eventId: created.event.id },
        select: { branchId: true },
      })
    ).map((a) => a.branchId);

    // Asserted on THIS test's own branches: a global event legitimately attaches
    // every operational branch in the database, so a total count would measure
    // whatever other suites happen to have created.
    expect(ids).toEqual(expect.arrayContaining([open1, open2]));
    expect(ids).not.toContain(future);
  });

  it("writes real rows in all four join tables — no wildcard", async () => {
    const branchId = await makeBranch("مراكش");
    const groupId = await makeGroup(branchId);

    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({
        branchIds: [branchId],
        categoryIds: [categoryId],
        levelIds: [levelId],
        groupIds: [groupId],
      }),
      TODAY,
    );
    const id = created.event.id;

    // §4.4 forbids runtime null/wildcard evaluation, so the reach must exist as
    // rows that a calendar query can join against.
    expect(await prisma.eventBranch.count({ where: { eventId: id } })).toBe(1);
    expect(await prisma.eventCategory.count({ where: { eventId: id } })).toBe(
      1,
    );
    expect(await prisma.eventLevel.count({ where: { eventId: id } })).toBe(1);
    expect(
      await prisma.eventAdministrativeGroup.count({ where: { eventId: id } }),
    ).toBe(1);
  });

  it("a not-yet-operational branch named explicitly is still excluded", async () => {
    const future = await makeBranch("أكادير", day("2026-12-01"));
    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [future] }),
      TODAY,
    );
    expect(created.attached.branches).toBe(0);
  });

  it("duplicate scope ids collapse rather than duplicating rows", async () => {
    const branchId = await makeBranch("مراكش");
    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId], levelIds: [levelId, levelId] }),
      TODAY,
    );
    expect(
      await prisma.eventLevel.count({ where: { eventId: created.event.id } }),
    ).toBe(1);
  });
});

describe("§4.4 — recurrence is stored and validated", () => {
  it("accepts all five recurrence types, including biweekly-alternating", async () => {
    const branchId = await makeBranch("مراكش");
    for (const recurrenceType of [
      "daily",
      "weekly",
      "biweekly_alternating",
      "yearly",
    ] as const) {
      const created = await createEvent(
        prisma,
        superAdmin(),
        eventInput({
          branchIds: [branchId],
          recurrenceType,
          recurrenceEndDate: day("2026-12-31"),
        }),
        TODAY,
      );
      expect(created.event.recurrenceType).toBe(recurrenceType);
    }
    const once = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId] }),
      TODAY,
    );
    expect(once.event.recurrenceType).toBe("none");
  });

  it("a recurring event without an end date is refused", async () => {
    const branchId = await makeBranch("مراكش");
    // Unbounded recurrence would expand forever in every calendar query.
    await expect(
      createEvent(
        prisma,
        superAdmin(),
        eventInput({ branchIds: [branchId], recurrenceType: "weekly" }),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("a recurrence end date on a one-off event is refused", async () => {
    const branchId = await makeBranch("مراكش");
    await expect(
      createEvent(
        prisma,
        superAdmin(),
        eventInput({
          branchIds: [branchId],
          recurrenceEndDate: day("2026-12-31"),
        }),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("an end date before the start is refused", async () => {
    const branchId = await makeBranch("مراكش");
    await expect(
      createEvent(
        prisma,
        superAdmin(),
        eventInput({ branchIds: [branchId], endDate: day("2026-06-01") }),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("TD-2 — who may schedule", () => {
  it("a Teacher may create an event scoped to their OWN group, hidden included", async () => {
    const branchId = await makeBranch("مراكش");
    const groupId = await makeGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(groupId)!, t);

    const actor: Actor = {
      userId: t,
      roles: ["teacher"],
      roleScopes: [{ role: "teacher", branches: null }],
    };
    const created = await createEvent(
      prisma,
      actor,
      eventInput({ visibility: "hidden", groupIds: [groupId] }),
      TODAY,
    );
    expect(created.event.visibility).toBe("hidden");
  });

  it("a Teacher cannot scope an event beyond their groups", async () => {
    const branchId = await makeBranch("مراكش");
    const groupId = await makeGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(groupId)!, t);
    const actor: Actor = {
      userId: t,
      roles: ["teacher"],
      roleScopes: [{ role: "teacher", branches: null }],
    };

    await expect(
      createEvent(prisma, actor, eventInput({ global: true }), TODAY),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createEvent(prisma, actor, eventInput({ branchIds: [branchId] }), TODAY),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a Teacher cannot widen scope by pairing their own group with a branch", async () => {
    // The escalation path: naming a legitimate group satisfies the "must name a
    // group" rule, so the wider scope has to be refused on its own. Without
    // that, a teacher could attach an event to an entire branch.
    const branchId = await makeBranch("مراكش");
    const groupId = await makeGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(groupId)!, t);
    const actor: Actor = {
      userId: t,
      roles: ["teacher"],
      roleScopes: [{ role: "teacher", branches: null }],
    };

    await expect(
      createEvent(
        prisma,
        actor,
        eventInput({ groupIds: [groupId], branchIds: [branchId] }),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createEvent(
        prisma,
        actor,
        eventInput({ groupIds: [groupId], global: true }),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createEvent(
        prisma,
        actor,
        eventInput({ groupIds: [groupId], levelIds: [levelId] }),
        TODAY,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a Teacher naming another teacher's group gets 404, not 403", async () => {
    const branchId = await makeBranch("مراكش");
    const mine = await makeGroup(branchId);
    const theirs = await makeGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(mine)!, t);
    const actor: Actor = {
      userId: t,
      roles: ["teacher"],
      roleScopes: [{ role: "teacher", branches: null }],
    };

    await expect(
      createEvent(prisma, actor, eventInput({ groupIds: [theirs] }), TODAY),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a branch Admin's global event covers only their OWN branches", async () => {
    const mine = await makeBranch("مراكش");
    const theirs = await makeBranch("الدار البيضاء");

    const created = await createEvent(
      prisma,
      admin([mine]),
      eventInput({ global: true }),
      TODAY,
    );
    const attached = (
      await prisma.eventBranch.findMany({
        where: { eventId: created.event.id },
      })
    ).map((a) => a.branchId);

    expect(attached).toEqual([mine]);
    expect(attached).not.toContain(theirs);
  });

  it("a parent cannot schedule anything", async () => {
    await expect(
      createEvent(prisma, parent(), eventInput({ global: true }), TODAY),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("TD-5 — deletion removes the scope joins", () => {
  it("soft-deletes the event and REMOVES its join rows", async () => {
    const branchId = await makeBranch("مراكش");
    const groupId = await makeGroup(branchId);
    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({
        branchIds: [branchId],
        groupIds: [groupId],
        levelIds: [levelId],
      }),
      TODAY,
    );
    const id = created.event.id;

    await deleteEvent(prisma, superAdmin(), id);

    expect(
      (await prisma.event.findUnique({ where: { id } }))?.deletedAt,
    ).toBeInstanceOf(Date);
    // TD-5: the joins are the materialised reach of an event that no longer
    // applies, so they go rather than lingering as soft-deleted rows.
    expect(await prisma.eventBranch.count({ where: { eventId: id } })).toBe(0);
    expect(
      await prisma.eventAdministrativeGroup.count({ where: { eventId: id } }),
    ).toBe(0);
    expect(await prisma.eventLevel.count({ where: { eventId: id } })).toBe(0);
  });
});

describe("§4.4 — branch-activation backfill", () => {
  it("lists events a late-opening branch missed, and attaches them on request", async () => {
    const open = await makeBranch("مراكش");
    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ global: true }),
      TODAY,
    );
    // The branch opens later, so it was deliberately excluded at creation.
    const late = await makeBranch("أكادير", day("2026-12-01"));

    const candidates = (await backfillCandidates(prisma, superAdmin(), late))
      .data;
    expect(candidates.map((c) => c.id)).toContain(created.event.id);

    const attached = await backfillAttach(prisma, superAdmin(), late, [
      created.event.id,
    ]);
    expect(attached).toBe(1);
    expect(
      await prisma.eventBranch.count({
        where: { eventId: created.event.id, branchId: late },
      }),
    ).toBe(1);
    // The originally-attached branch is untouched.
    expect(
      await prisma.eventBranch.count({
        where: { eventId: created.event.id, branchId: open },
      }),
    ).toBe(1);
  });

  it("attaching twice is idempotent, never a duplicate row", async () => {
    await makeBranch("مراكش");
    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ global: true }),
      TODAY,
    );
    const late = await makeBranch("أكادير", day("2026-12-01"));

    await backfillAttach(prisma, superAdmin(), late, [created.event.id]);
    const second = await backfillAttach(prisma, superAdmin(), late, [
      created.event.id,
    ]);

    expect(second).toBe(0);
    expect(
      await prisma.eventBranch.count({
        where: { eventId: created.event.id, branchId: late },
      }),
    ).toBe(1);
  });

  it("an event already covering the branch is not a candidate", async () => {
    const branchId = await makeBranch("مراكش");
    const created = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ global: true }),
      TODAY,
    );

    const candidates = (
      await backfillCandidates(prisma, superAdmin(), branchId)
    ).data;
    expect(candidates.map((c) => c.id)).not.toContain(created.event.id);
  });

  it("a branch Admin cannot backfill a branch outside their scope", async () => {
    const mine = await makeBranch("مراكش");
    const theirs = await makeBranch("الدار البيضاء", day("2026-12-01"));

    await expect(
      backfillCandidates(prisma, admin([mine]), theirs),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("TD-15 / §4.4 — editing an event", () => {
  const teacherActor = (userId: string): Actor => ({
    userId,
    roles: ["teacher"],
    roleScopes: [{ role: "teacher", branches: null }],
  });

  it("edits attributes and increments the version", async () => {
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId] }),
      TODAY,
    );

    const updated = await updateEvent(
      prisma,
      superAdmin(),
      event.id,
      event.version,
      {
        title: `${TAG} نشاط معدّل`,
        visibility: "public",
      },
    );

    expect(updated.title).toBe(`${TAG} نشاط معدّل`);
    expect(updated.visibility).toBe("public");
    expect(updated.version).toBe(event.version + 1);
  });

  it("TD-15: a stale version is VERSION_CONFLICT, not a silent overwrite", async () => {
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId] }),
      TODAY,
    );
    const stale = event.version;
    await updateEvent(prisma, superAdmin(), event.id, stale, {
      title: `${TAG} أولى`,
    });

    await expect(
      updateEvent(prisma, superAdmin(), event.id, stale, {
        title: `${TAG} ثانية`,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    // The first writer's value survives — nothing is merged, nothing is lost.
    const row = await prisma.event.findUnique({ where: { id: event.id } });
    expect(row!.title).toBe(`${TAG} أولى`);
  });

  it("validates the MERGED event, not the patch in isolation", async () => {
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({
        branchIds: [branchId],
        recurrenceType: "weekly",
        recurrenceEndDate: day("2026-08-01"),
      }),
      TODAY,
    );

    // Clearing the end date while the recurrence stays weekly leaves an
    // unbounded recurrence, which would expand forever in every calendar read.
    await expect(
      updateEvent(prisma, superAdmin(), event.id, event.version, {
        recurrenceEndDate: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // Dropping the recurrence along with it is coherent, and accepted.
    const ok = await updateEvent(
      prisma,
      superAdmin(),
      event.id,
      event.version,
      {
        recurrenceType: "none",
        recurrenceEndDate: null,
      },
    );
    expect(ok.recurrenceType).toBe("none");
  });

  it("§4.4: scope is untouched by an edit", async () => {
    // The joins are materialised at creation and changed only by backfill; an
    // edit must not re-resolve them.
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId] }),
      TODAY,
    );
    await updateEvent(prisma, superAdmin(), event.id, event.version, {
      title: `${TAG} جديد`,
    });

    const rows = await prisma.eventBranch.findMany({
      where: { eventId: event.id },
    });
    expect(rows.map((r) => r.branchId)).toEqual([branchId]);
  });

  it("a branch-scoped Admin cannot edit an event reaching a branch they do not manage", async () => {
    const mine = await makeBranch("مراكش");
    const theirs = await makeBranch("الدار البيضاء");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [mine, theirs] }),
      TODAY,
    );

    // §20 rule 17: 404, not 403 — its existence is not theirs to learn.
    await expect(
      updateEvent(prisma, admin([mine]), event.id, event.version, {
        title: `${TAG} محاولة`,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await prisma.event.findUnique({ where: { id: event.id } });
    expect(row!.title).toBe(`${TAG} نشاط`);
  });

  it("a branch-scoped Admin edits an event confined to their own branches", async () => {
    const mine = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [mine] }),
      TODAY,
    );

    const updated = await updateEvent(
      prisma,
      admin([mine]),
      event.id,
      event.version,
      {
        title: `${TAG} مسموح`,
      },
    );
    expect(updated.title).toBe(`${TAG} مسموح`);
  });

  it("a Teacher edits their own group event but not another group’s", async () => {
    const branchId = await makeBranch("مراكش");
    const ownGroup = await makeGroup(branchId);
    const otherGroup = await makeGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(ownGroup)!, t);

    const own = await createEvent(
      prisma,
      teacherActor(t),
      eventInput({ visibility: "hidden", groupIds: [ownGroup] }),
      TODAY,
    );
    const foreign = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ groupIds: [otherGroup] }),
      TODAY,
    );

    const updated = await updateEvent(
      prisma,
      teacherActor(t),
      own.event.id,
      own.event.version,
      {
        title: `${TAG} تعديل المعلمة`,
      },
    );
    expect(updated.title).toBe(`${TAG} تعديل المعلمة`);

    await expect(
      updateEvent(
        prisma,
        teacherActor(t),
        foreign.event.id,
        foreign.event.version,
        {
          title: `${TAG} محاولة`,
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a Teacher cannot edit a branch-wide event even when it reaches their group", async () => {
    // The escalation mirror of the creation guard: a wider scope row puts the
    // event beyond a teacher regardless of which groups it also names.
    const branchId = await makeBranch("مراكش");
    const groupId = await makeGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(groupId)!, t);

    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId], groupIds: [groupId] }),
      TODAY,
    );

    await expect(
      updateEvent(prisma, teacherActor(t), event.id, event.version, {
        visibility: "public",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a branch-scoped Admin cannot edit an event carrying NO branch rows", async () => {
    // A teacher's group-only event has no branch scope at all, so no branch
    // Admin can show it is theirs. Without this, "none of its branches are
    // outside my scope" would be vacuously true and any Admin could edit it.
    const branchId = await makeBranch("مراكش");
    const groupId = await makeGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(groupId)!, t);
    const { event } = await createEvent(
      prisma,
      teacherActor(t),
      eventInput({ groupIds: [groupId] }),
      TODAY,
    );
    expect(
      await prisma.eventBranch.count({ where: { eventId: event.id } }),
    ).toBe(0);

    await expect(
      updateEvent(prisma, admin([branchId]), event.id, event.version, {
        title: `${TAG} محاولة`,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an explicit null clears the description; an omitted key leaves it alone", async () => {
    // `undefined` and `null` mean different things in a PATCH — "leave it" and
    // "clear it" — and collapsing them makes a field impossible to empty.
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId], description: "وصف" }),
      TODAY,
    );

    const kept = await updateEvent(
      prisma,
      superAdmin(),
      event.id,
      event.version,
      {
        title: `${TAG} بلا لمس الوصف`,
      },
    );
    expect(kept.description).toBe("وصف");

    const cleared = await updateEvent(
      prisma,
      superAdmin(),
      event.id,
      kept.version,
      {
        description: null,
      },
    );
    expect(cleared.description).toBeNull();
  });

  it("a Parent cannot edit an event at all", async () => {
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId] }),
      TODAY,
    );

    await expect(
      updateEvent(prisma, parent(), event.id, event.version, {
        title: `${TAG} محاولة`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a soft-deleted event is NOT_FOUND rather than editable", async () => {
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId] }),
      TODAY,
    );
    await deleteEvent(prisma, superAdmin(), event.id);

    await expect(
      updateEvent(prisma, superAdmin(), event.id, event.version, {
        title: `${TAG} محاولة`,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records a visibility change explicitly in the audit detail", async () => {
    const branchId = await makeBranch("مراكش");
    const { event } = await createEvent(
      prisma,
      superAdmin(),
      eventInput({ branchIds: [branchId], visibility: "hidden" }),
      TODAY,
    );
    await updateEvent(prisma, superAdmin(), event.id, event.version, {
      visibility: "public",
    });

    const row = await prisma.auditLog.findFirst({
      where: { actionType: "event.update", targetId: event.id },
      orderBy: { createdAt: "desc" },
    });
    const detail = row!.detail as Record<string, unknown>;
    expect(detail["visibility_from"]).toBe("hidden");
    expect(detail["visibility_to"]).toBe("public");
  });
});
