import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import {
  expandEvent,
  readCalendar,
  type CalendarActor,
  type Occurrence,
} from "./calendar.service.js";
import { createEvent } from "./event.service.js";
import {
  clearTeachingContext,
  createTeachingContext,
  materializeRange,
  staff as staffSchedule,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";
import type { Actor } from "../policies/actor.js";

/**
 * Calendar read — §4.4, TD-3.4, TD-11, §19.2.
 *
 * Two things are proven here that nothing else covers: the **three visibility
 * tiers** resolved server-side for every kind of caller including anonymous, and
 * the **§19.2 Ramadan DST regression** — a wall-clock time must survive
 * Morocco's clock shift unchanged.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[calendar-test]";

let levelId: string;
let categoryId: string;
let actorUserId: string;

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day("2026-06-01");

const staffActor = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => staffActor([{ role: "super_admin", branches: null }]);

const viewer = (
  userId: string,
  roles: string[],
  branches: string[] | null = null,
  accountStatus = "active",
): CalendarActor => ({
  userId,
  roles,
  roleScopes: roles.map((role) => ({ role, branches })),
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

async function teacherUser(label: string): Promise<string> {
  const id = await person(label);
  const r = await prisma.role.findUnique({ where: { name: "teacher" } });
  await prisma.userBranchRole.create({
    data: { userId: id, roleId: r!.id, branchId: null },
  });
  return id;
}

async function makeBranch(
  name: string,
  opened = "2020-01-01",
): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: day(opened) },
  });
  return b.id;
}

/**
 * A timetable entry, Revision 43 style: an Administrative Group, a Course
 * Schedule on the given weekday and hour, and its materialized Sessions.
 *
 * The retired `Group` carried its weekly slot in columns and the calendar
 * expanded them on read. A schedule now *materializes* dated occurrences, so a
 * fixture must create them — which is also why the range is explicit here.
 */
async function makeGroup(
  branchId: string,
  dayOfWeek = "monday",
  hour = 9,
  materializeYear = 2026,
): Promise<string> {
  const ctx = await createTeachingContext(
    prisma,
    `${TAG} ${Math.random().toString(36).slice(2, 7)}`,
    branchId,
    { levelId, categoryId, weekday: dayOfWeek, hour },
  );
  contexts.set(ctx.administrativeGroupId, ctx);
  // Wide enough to cover every range the suite reads. The optional year lets
  // the Hijri tests use a remote, test-owned Gregorian timeline instead of
  // colliding with an operator-recorded local calendar.
  await materializeRange(
    prisma,
    ctx,
    day(`${materializeYear}-01-01`),
    day(`${materializeYear}-12-31`),
  );
  return ctx.administrativeGroupId;
}

/**
 * Revision 43: **event scoping** and **teacher reach** both moved to the new
 * model — events scope to Administrative Groups (§7), and a teacher reaches one
 * through a Course Schedule (§4.4c). `makeGroup` above still creates a retiring
 * `Group`, because the calendar's *timetable* half has not been migrated yet;
 * the two coexist during the expand phase by design.
 */
const contexts = new Map<string, TeachingFixture>();

async function makeAdminGroup(branchId: string): Promise<string> {
  const ctx = await createTeachingContext(
    prisma,
    `${TAG} ${Math.random().toString(36).slice(2, 7)}`,
    branchId,
    { levelId, categoryId },
  );
  contexts.set(ctx.administrativeGroupId, ctx);
  return ctx.administrativeGroupId;
}

async function makeEvent(
  visibility: "public" | "private" | "hidden",
  over: Record<string, unknown> = {},
): Promise<string> {
  const created = await createEvent(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${visibility}`,
      visibility,
      startDate: day("2026-06-15"),
      recurrenceType: "none",
      ...over,
    } as never,
    TODAY,
  );
  return created.event.id;
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
  await prisma.userBranchRole.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  const level = await prisma.level.findFirstOrThrow({
    select: { id: true, categoryId: true },
  });
  levelId = level.id;
  categoryId = level.categoryId;
  actorUserId = await person("فاعلة");
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const range = { from: day("2026-06-01"), to: day("2026-06-30") };

/**
 * The suites share one database, so every assertion is scoped to rows this file
 * created. Asserting on a global result set measures whatever other suites
 * happen to have left behind — a mistake this project has made before.
 */
function scoped(rows: Occurrence[]): Occurrence[] {
  return rows.filter((r) => r.title.startsWith(TAG));
}
const titles = (rows: Occurrence[]): string[] =>
  scoped(rows).map((r) => r.title);

describe("§19.2 — Ramadan DST wall-clock stability (TD-11)", () => {
  it("a weekly 09:00 class stays at 09:00 across Morocco's Ramadan clock shift", async () => {
    const branchId = await makeBranch("مراكش");
    await makeGroup(branchId, "monday", 9);

    // Morocco is UTC+1 year-round but returns to UTC+0 for Ramadan — in 2026
    // roughly mid-February to late March. This range spans BOTH transitions.
    const occurrences = await readCalendar(
      prisma,
      viewer(actorUserId, ["super_admin"]),
      {
        from: day("2026-02-01"),
        to: day("2026-04-05"),
      },
    );
    const classes = scoped(occurrences).filter((o) => o.kind === "session");

    expect(classes.length).toBeGreaterThan(6);
    // Every single occurrence, on both sides of both shifts, reads 09:00. This
    // holds because dates and times are stored as `date`/`time` and never
    // converted to an instant — the property TD-11 exists to guarantee.
    for (const c of classes) {
      expect(c.startTime).toBe("09:00");
      expect(c.endTime).toBe("10:30");
    }
  });

  it("an event's time is unchanged across the same span", async () => {
    const branchId = await makeBranch("مراكش");
    await makeEvent("public", {
      startDate: day("2026-02-10"),
      startTime: new Date(Date.UTC(1970, 0, 1, 18, 30)),
      recurrenceType: "weekly",
      recurrenceEndDate: day("2026-04-05"),
      branchIds: [branchId],
    });

    const rows = await readCalendar(prisma, null, {
      from: day("2026-02-01"),
      to: day("2026-04-05"),
    });
    const ours = scoped(rows);
    expect(ours.length).toBeGreaterThan(5);
    for (const r of ours) expect(r.startTime).toBe("18:30");
  });
});

describe("§4.4 — recurrence expansion", () => {
  const base = {
    startDate: day("2026-06-01"),
    endDate: null,
    recurrenceEndDate: day("2026-06-30"),
  };

  it("none yields a single date; a multi-day span yields every day", () => {
    expect(
      expandEvent(
        { ...base, recurrenceType: "none", recurrenceEndDate: null },
        range.from,
        range.to,
      ),
    ).toHaveLength(1);
    expect(
      expandEvent(
        {
          startDate: day("2026-06-01"),
          endDate: day("2026-06-03"),
          recurrenceType: "none",
          recurrenceEndDate: null,
        },
        range.from,
        range.to,
      ),
    ).toHaveLength(3);
  });

  it("daily, weekly and yearly expand as expected", () => {
    expect(
      expandEvent({ ...base, recurrenceType: "daily" }, range.from, range.to),
    ).toHaveLength(30);
    expect(
      expandEvent({ ...base, recurrenceType: "weekly" }, range.from, range.to),
    ).toHaveLength(5);
    expect(
      expandEvent(
        {
          ...base,
          recurrenceType: "yearly",
          recurrenceEndDate: day("2029-01-01"),
        },
        day("2026-01-01"),
        day("2029-01-01"),
      ),
      // 2026, 2027, 2028 — the 2029 occurrence falls on 2029-06-01, after the
      // range ends on 2029-01-01.
    ).toHaveLength(3);
  });

  it("biweekly-alternating is week-on/week-off, not weekly", () => {
    const dates = expandEvent(
      { ...base, recurrenceType: "biweekly_alternating" },
      range.from,
      range.to,
    );
    // June 1, 15, 29 — every fourteenth day, half as many as weekly.
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-06-01",
      "2026-06-15",
      "2026-06-29",
    ]);
  });

  it("recurrence stops at recurrence_end_date, not at the range end", () => {
    const dates = expandEvent(
      {
        ...base,
        recurrenceType: "daily",
        recurrenceEndDate: day("2026-06-05"),
      },
      range.from,
      range.to,
    );
    expect(dates).toHaveLength(5);
  });

  // The retired `expandGroup` is gone with the `Group` it expanded. Schedule
  // recurrence — including the alternating-week case — is unit-tested in
  // `lib/recurrence.test.ts`, where it needs no database.
});

describe("§4.4 — three-tier visibility", () => {
  it("an ANONYMOUS caller sees the public EVENT tier — and the timetable, which is public (R43)", async () => {
    const branchId = await makeBranch("مراكش");
    await makeGroup(branchId);
    await makeEvent("public", { branchIds: [branchId] });
    await makeEvent("private", { branchIds: [branchId] });
    await makeEvent("hidden", { branchIds: [branchId] });

    const rows = await readCalendar(prisma, null, range);

    // Events still obey the three tiers: only the public one appears. Filtered
    // by KIND rather than by title prefix — a session's title is its subject
    // name, which shares the fixture tag.
    expect(
      rows
        .filter((r) => r.kind === "event" && r.title.startsWith(`${TAG} `))
        .map((r) => r.title),
    ).toEqual([`${TAG} public`]);

    // **This assertion is INVERTED from the retired model, deliberately.**
    // §4.4 (Revision 43): "The calendar is PUBLIC. Anonymous visitors browse it
    // without authenticating." A Group timetable used to be staff-only; a
    // Session timetable is the association's public offering — the thing a
    // prospective family looks at before enrolling. The visibility tiers still
    // govern EVENTS, and a private session's recordings remain private (§4.9);
    // what changed is that the existence of a class is no longer secret.
    expect(scoped(rows).some((r) => r.kind === "session")).toBe(true);
  });

  it("a PENDING account sees exactly what an anonymous visitor sees (TD-1)", async () => {
    const branchId = await makeBranch("مراكش");
    await makeEvent("public", { branchIds: [branchId] });
    await makeEvent("private", { branchIds: [branchId] });

    const pending = viewer(
      await person("قيد الموافقة"),
      ["student"],
      null,
      "pending",
    );
    expect(titles(await readCalendar(prisma, pending, range))).toEqual([
      `${TAG} public`,
    ]);
  });

  it("an approved STUDENT sees public and private, never hidden", async () => {
    const branchId = await makeBranch("مراكش");
    await makeEvent("public", { branchIds: [branchId] });
    await makeEvent("private", { branchIds: [branchId] });
    await makeEvent("hidden", { branchIds: [branchId] });

    const rows = await readCalendar(
      prisma,
      viewer(await person("طالبة"), ["student"]),
      range,
    );
    expect(titles(rows).sort()).toEqual([`${TAG} private`, `${TAG} public`]);
  });

  it("an active account with no calendar role receives only the public tier", async () => {
    const branchId = await makeBranch("مراكش");
    await makeEvent("public", { branchIds: [branchId] });
    await makeEvent("private", { branchIds: [branchId] });

    const rows = await readCalendar(
      prisma,
      viewer(await person("بلا دور"), []),
      range,
    );
    expect(titles(rows)).toEqual([`${TAG} public`]);
  });

  it("§4.4 Risk R-6: a student's private tier is NOT filtered by their branch", async () => {
    const elsewhere = await makeBranch("الدار البيضاء");
    await makeEvent("private", { branchIds: [elsewhere] });

    // A deliberate, recorded trade-off — the student sees it regardless.
    const rows = await readCalendar(
      prisma,
      viewer(await person("طالبة"), ["student"]),
      range,
    );
    expect(titles(rows)).toContain(`${TAG} private`);
  });

  /**
   * **RESTATED for R109 — the property moved, so the assertion moved with it.**
   *
   * These three cases pinned §4.4's *"Teachers whose scope intersects … and ALL
   * Admins regardless of branch scope"*. R109 supersedes both arms: `hidden` is
   * now **ownership** — the responsible person plus Super Admins. The tests are
   * not deleted, because the question they ask (*who reads a hidden activity?*)
   * is still exactly the right question; only the answer changed.
   */
  it("R109: teaching scope no longer reaches a hidden activity — ownership does", async () => {
    const branchId = await makeBranch("مراكش");
    const mine = await makeAdminGroup(branchId);
    const theirs = await makeAdminGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(mine)!, t);

    // Scoped to a group she teaches — which used to be enough and no longer is.
    const byScope = await makeEvent("hidden", { groupIds: [mine] });
    const otherHidden = await prisma.event.findUnique({
      where: { id: await makeEvent("hidden", { groupIds: [theirs] }) },
    });
    // The one she actually answers for (R71.3).
    const hers = await makeEvent("hidden", { groupIds: [theirs] });
    await prisma.eventStaff.create({
      data: { eventId: hers, userId: t, position: "responsible" },
    });

    const rows = await readCalendar(prisma, viewer(t, ["teacher"]), range);
    const ids = scoped(rows).map((r) => r.id);

    // Exactly one hidden activity, and it is the one she is responsible for —
    // note that it is scoped to a group she does NOT teach, which is what makes
    // this a test of ownership rather than of scope by another name.
    expect(ids).toContain(hers);
    expect(ids).not.toContain(byScope);
    expect(ids).not.toContain(otherHidden!.id);
    expect(scoped(rows).filter((r) => r.visibility === "hidden")).toHaveLength(
      1,
    );
  });

  it("R109: a hidden activity scoped to her group's LEVEL no longer reaches her", async () => {
    const branchId = await makeBranch("مراكش");
    const mine = await makeAdminGroup(branchId);
    const t = await teacherUser("معلمة");
    await staffSchedule(prisma, contexts.get(mine)!, t);
    await makeEvent("hidden", { levelIds: [levelId] });

    // §4.4 listed the group, its level, category, branch and a global event.
    // R109 withdrew that whole arm: none of them is ownership.
    const rows = await readCalendar(prisma, viewer(t, ["teacher"]), range);
    expect(scoped(rows).some((r) => r.visibility === "hidden")).toBe(false);
  });

  it("R109 SUPERSEDES §4.4: an Admin no longer sees every hidden activity", async () => {
    const mine = await makeBranch("مراكش");
    const elsewhere = await makeBranch("الدار البيضاء");
    const hidden = await makeEvent("hidden", { branchIds: [elsewhere] });

    // Out of her branch scope — and, since R109, that is no longer the reason.
    const scopedAdmin = await person("مشرفة");
    expect(
      scoped(
        await readCalendar(
          prisma,
          viewer(scopedAdmin, ["admin"], [mine]),
          range,
        ),
      ).some((r) => r.visibility === "hidden"),
    ).toBe(false);

    // An ALL-BRANCHES Admin is the case the old filter short-circuited to `{}`,
    // handing back every hidden activity in the platform. Pinned separately,
    // because it was a different code path and not merely a wider scope.
    expect(
      scoped(
        await readCalendar(prisma, viewer(await person("مديرة"), ["admin"]), range),
      ).some((r) => r.visibility === "hidden"),
    ).toBe(false);

    // The positive half: the person responsible for it does read it. Without
    // this the two assertions above would also pass on a filter that had simply
    // stopped returning hidden activities to anyone.
    const owner = await person("مسؤولة");
    await prisma.eventStaff.create({
      data: { eventId: hidden, userId: owner, position: "responsible" },
    });
    expect(
      scoped(
        await readCalendar(prisma, viewer(owner, ["teacher"]), range),
      ).map((r) => r.id),
    ).toContain(hidden);
  });

  it("a branch admin's PRIVATE tier IS limited to their scope", async () => {
    const mine = await makeBranch("مراكش");
    const elsewhere = await makeBranch("الدار البيضاء");
    await makeEvent("private", { branchIds: [elsewhere] });

    // The asymmetry is the SRS's own: hidden is unscoped for admins, private is not.
    const rows = await readCalendar(
      prisma,
      viewer(await person("مشرفة"), ["admin"], [mine]),
      range,
    );
    expect(scoped(rows).some((r) => r.visibility === "private")).toBe(false);
  });

  it("a Super Admin sees every tier", async () => {
    const branchId = await makeBranch("مراكش");
    await makeEvent("public", { branchIds: [branchId] });
    await makeEvent("private", { branchIds: [branchId] });
    await makeEvent("hidden", { branchIds: [branchId] });

    const rows = await readCalendar(
      prisma,
      viewer(await person("مشرف عام"), ["super_admin"]),
      range,
    );
    expect(titles(rows).sort()).toEqual([
      `${TAG} hidden`,
      `${TAG} private`,
      `${TAG} public`,
    ]);
  });
});

describe("§4.4 — operational boundary and range guards", () => {
  it("nothing before a branch's operational_start_date is rendered", async () => {
    const branchId = await makeBranch("أكادير", "2026-06-15");
    await makeGroup(branchId);
    await makeEvent("public", {
      startDate: day("2026-06-02"),
      branchIds: [branchId],
    });

    const rows = await readCalendar(
      prisma,
      viewer(actorUserId, ["super_admin"]),
      {
        ...range,
        branchId,
      },
    );

    const ours = scoped(rows);
    // `[].every()` is true, so the boundary assertion alone would pass if the
    // filter removed EVERYTHING. Prove the after-side survives first.
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.some((r) => r.kind === "session")).toBe(true);
    // §4.4: no scheduling data or events before the branch opens.
    expect(ours.every((r) => r.date >= "2026-06-15")).toBe(true);
    // And the event deliberately placed before the boundary is genuinely gone,
    // rather than merely absent from a list that is empty for another reason.
    expect(ours.some((r) => r.date === "2026-06-02")).toBe(false);
  });

  it("refuses an inverted or oversized range", async () => {
    const actor = viewer(actorUserId, ["super_admin"]);
    await expect(
      readCalendar(prisma, actor, {
        from: day("2026-06-30"),
        to: day("2026-06-01"),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      readCalendar(prisma, actor, {
        from: day("2026-01-01"),
        to: day("2028-01-01"),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("returns a unified, deterministically ordered grid of groups and events", async () => {
    const branchId = await makeBranch("مراكش");
    await makeGroup(branchId, "monday", 9);
    await makeEvent("public", {
      startDate: day("2026-06-01"),
      branchIds: [branchId],
    });

    const rows = await readCalendar(
      prisma,
      viewer(actorUserId, ["super_admin"]),
      range,
    );
    const ours = scoped(rows);
    expect(ours.some((r) => r.kind === "session")).toBe(true);
    expect(ours.some((r) => r.kind === "event")).toBe(true);

    const dates = rows.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("§4.4/§5.7 — the Hijri overlay from official recorded data (Revision 31)", () => {
  /** Reserved fixture coordinates, deliberately outside the Production seed. */
  const TEST_PREVIOUS_YEAR = 1557;
  const TEST_HIJRI_YEAR = 1558;
  const OFFICIAL: [number, number, string][] = [
    [TEST_PREVIOUS_YEAR, 12, "2046-05-18"],
    [TEST_HIJRI_YEAR, 1, "2046-06-17"],
    [TEST_HIJRI_YEAR, 2, "2046-07-16"],
  ];

  async function record(published: boolean): Promise<void> {
    for (const [y, m, iso] of OFFICIAL) {
      await prisma.hijriMonthStart.create({
        data: {
          hijriYear: y,
          hijriMonth: m,
          gregorianStartDate: day(iso),
          status: published ? "published" : "draft",
        },
      });
    }
  }

  async function clearMonths(): Promise<void> {
    await prisma.hijriMonthStart.deleteMany({
      where: { hijriYear: { in: [TEST_PREVIOUS_YEAR, TEST_HIJRI_YEAR] } },
    });
  }

  beforeEach(clearMonths);
  afterEach(clearMonths);

  it("labels occurrences from the recorded official calendar", async () => {
    await record(true);
    await makeEvent("public", { startDate: day("2046-06-20") });

    const rows = scoped(
      await readCalendar(prisma, null, {
        from: day("2046-06-01"),
        to: day("2046-06-30"),
      }),
    );
    const event = rows.find((r) => r.kind === "event");

    // 20 June is the fourth day of Muharram, counting from the announced 17th.
    expect(event!.hijriDate).toBe(`${TEST_HIJRI_YEAR}-01-04`);
    expect(event!.hijriMonthArabic).toBe("محرم");
    // Decorative only (§4.4): the Gregorian date is untouched.
    expect(event!.date).toBe("2046-06-20");
  });

  it("reproduces the OFFICIAL date rather than the algorithmic one", async () => {
    // The recorded start is the 17th. On the 16th the answer is still the
    // previous month; a computed conversion could not reproduce this reserved
    // fixture coordinate and would therefore expose an algorithmic fallback.
    await record(true);
    await makeEvent("public", { startDate: day("2046-06-16") });

    const rows = scoped(
      await readCalendar(prisma, null, {
        from: day("2046-06-01"),
        to: day("2046-06-30"),
      }),
    );
    const event = rows.find((r) => r.kind === "event");

    expect(event!.hijriDate).toBe(`${TEST_PREVIOUS_YEAR}-12-30`);
    expect(event!.hijriMonthArabic).toBe("ذو الحجة");
  });

  it("renders NO overlay for a month that is recorded but not yet published", async () => {
    await record(false);
    await makeEvent("public", { startDate: day("2046-06-20") });

    const rows = scoped(
      await readCalendar(prisma, null, {
        from: day("2046-06-01"),
        to: day("2046-06-30"),
      }),
    );
    const event = rows.find((r) => r.kind === "event");

    // Publishing is what makes a month visible; a draft must not leak out.
    expect(event!.hijriDate).toBeNull();
    expect(event!.hijriMonthArabic).toBeNull();
  });

  it("renders NO overlay for a month the Ministry has not announced", async () => {
    // §18/Revision 31: silence where the official answer is genuinely unknown,
    // never a computed guess. The Gregorian date still renders.
    await makeEvent("public", { startDate: day("2046-06-20") });

    const rows = scoped(
      await readCalendar(prisma, null, {
        from: day("2046-06-01"),
        to: day("2046-06-30"),
      }),
    );
    const event = rows.find((r) => r.kind === "event");

    expect(event!.hijriDate).toBeNull();
    expect(event!.date).toBe("2046-06-20");
  });

  it("group occurrences carry the overlay too, not only events", async () => {
    await record(true);
    const branchId = await makeBranch("مراكش");
    await makeGroup(branchId, "monday", 9, 2046);
    const student = await person("طالبة");

    const rows = scoped(
      await readCalendar(prisma, viewer(student, ["student"]), {
        from: day("2046-06-18"),
        to: day("2046-06-30"),
      }),
    );
    const session = rows.find((r) => r.kind === "session");

    expect(session!.hijriDate).toMatch(new RegExp(`^${TEST_HIJRI_YEAR}-01-\\d{2}$`));
    expect(session!.hijriMonthArabic).toBe("محرم");
  });

  it("crosses the Hijri year boundary on the recorded date", async () => {
    await record(true);
    await makeEvent("public", { startDate: day("2046-06-17") });

    const rows = scoped(
      await readCalendar(prisma, null, {
        from: day("2046-06-01"),
        to: day("2046-06-30"),
      }),
    );
    expect(rows.find((r) => r.kind === "event")!.hijriDate).toBe(
      `${TEST_HIJRI_YEAR}-01-01`,
    );
  });
});
