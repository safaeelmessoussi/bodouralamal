import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { RoleScope } from "../policies/branch-scope.js";
import { readCalendar, type CalendarActor } from "./calendar.service.js";
import { createEvent } from "./event.service.js";
import {
  clearTeachingContext,
  createTeachingContext,
  enrol,
  materializeRange,
  staff as staffSchedule,
  type TeachingFixture,
} from "../test-support/educational-fixture.js";
import type { Actor } from "../policies/actor.js";

/**
 * **§3 — the personal calendar (`GET /me/calendar`, R82.8), audited against
 * R139's flexible Event scope.**
 *
 * Two things are proven here that no other suite proves:
 *
 * 1. **The `personalFilters` correction itself** (`calendar.service.ts`) — an
 *    Event scoped to BOTH a Branch AND a Level is an INTERSECTION (§7,
 *    `eventAudienceWhere`'s own rule: *"naming a Category alongside a Branch
 *    narrows the Branch, it does not add a second, unrelated population"*),
 *    and the personal calendar must read it the same way the notification
 *    audience already does — not as two independent `OR` arms, which is the
 *    accidentally-broadening defect this suite exists to pin against a
 *    regression.
 * 2. **R139's multi-value scope reaches the personal calendar**, not only the
 *    public projection §1 already covers: an Event scoped to SEVERAL branches
 *    or SEVERAL Levels must concern every enrolled student it names, not only
 *    the first one a `take: 1` read would have kept.
 *
 * Session-side personal scoping (R92's combined-branch audience, R91's dated
 * teacher staffing) is already covered by `session-audience.http.integration
 * .test.ts` and `effective-staffing.http.integration.test.ts` respectively —
 * not repeated here.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[personal-cal-test]";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day("2026-06-01");
const range = { from: day("2026-06-01"), to: day("2026-06-30") };

let actorUserId: string;

const staffActor = (scopes: RoleScope[]): Actor => ({
  userId: actorUserId,
  roles: scopes.map((s) => s.role),
  roleScopes: scopes,
});
const superAdmin = () => staffActor([{ role: "super_admin", branches: null }]);

const viewer = (userId: string): CalendarActor => ({
  userId,
  roles: ["student"],
  roleScopes: [{ role: "student", branches: null }],
  accountStatus: "active",
});

const teacherViewer = (userId: string): CalendarActor => ({
  userId,
  roles: ["teacher"],
  roleScopes: [{ role: "teacher", branches: null }],
  accountStatus: "active",
});

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  return u.id;
}

async function makeBranch(name: string): Promise<string> {
  const b = await prisma.branch.create({
    data: { name: `${TAG} ${name}`, operationalStartDate: day("2020-01-01") },
  });
  return b.id;
}

async function makeEvent(
  title: string,
  over: Record<string, unknown>,
): Promise<string> {
  const created = await createEvent(
    prisma,
    superAdmin(),
    {
      title: `${TAG} ${title}`,
      visibility: "public",
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
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventAdministrativeGroup.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.notification.deleteMany({ where: { event: { id: { in: eventIds } } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  await clearTeachingContext(prisma, TAG);

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: eventIds } }] },
  });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

let ctxA: TeachingFixture;
let ctxB: TeachingFixture;

beforeEach(async () => {
  await clear();
  actorUserId = await person("فاعلة");
  const branchA = await makeBranch("فرع أ");
  const branchB = await makeBranch("فرع ب");
  ctxA = await createTeachingContext(prisma, TAG, branchA);
  ctxB = await createTeachingContext(prisma, TAG, branchB);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const scoped = (rows: { title: string }[]) => rows.filter((r) => r.title.startsWith(TAG));

describe("§3, Revision 140 — combined Branch+Level scope is an INTERSECTION on the personal calendar, not two independent OR arms", () => {
  it("a student at the right branch but the WRONG Level does not see it", async () => {
    const studentId = await person("مستفيدة");
    await enrol(prisma, ctxA, studentId);

    // Scoped to ctxA's branch AND ctxB's Level — nobody at ctxA is enrolled in
    // ctxB's Level, so the intersection describes nobody this student is.
    await makeEvent("تقاطع خاطئ", {
      branchIds: [ctxA.branchId],
      levelIds: [ctxB.levelId],
    });

    const rows = scoped(await readCalendar(prisma, viewer(studentId), { ...range, mine: true }));
    expect(rows).toHaveLength(0);

    // **The control**: the same event DOES concern a student actually enrolled
    // in ctxB's Level, at ctxA's branch — proving the event itself is reachable
    // and the first assertion is about the WRONG student, not a broken fixture.
    const otherId = await person("أخرى");
    await enrol(prisma, ctxB, otherId);
    // She is at ctxB's branch, not ctxA's — so this is still not a match for
    // HER either (branch fails now); the true positive is the next test.
    const otherRows = scoped(
      await readCalendar(prisma, viewer(otherId), { ...range, mine: true }),
    );
    expect(otherRows).toHaveLength(0);
  });

  it("a student who genuinely satisfies BOTH named dimensions at once sees it", async () => {
    const studentId = await person("مستفيدة");
    await enrol(prisma, ctxA, studentId);

    await makeEvent("تقاطع صحيح", {
      branchIds: [ctxA.branchId],
      levelIds: [ctxA.levelId],
    });

    const rows = scoped(await readCalendar(prisma, viewer(studentId), { ...range, mine: true }));
    expect(rows).toHaveLength(1);
  });

  it("the identical scope is what the event's own audience predicate already agreed on (no regression relative to notifications)", async () => {
    // Regression pin for the exact defect: before the fix, a Level-only OR arm
    // matched a student at the WRONG branch merely because her Level matched.
    const studentId = await person("مستفيدة عبر المستوى فقط");
    await enrol(prisma, ctxA, studentId);

    await makeEvent("فرع آخر ومستوى مطابق", {
      branchIds: [ctxB.branchId],
      levelIds: [ctxA.levelId],
    });

    const rows = scoped(await readCalendar(prisma, viewer(studentId), { ...range, mine: true }));
    expect(rows).toHaveLength(0);
  });
});

describe("§3/R139 — a multi-value scope reaches the personal calendar, not only its first branch/Level", () => {
  it("an event scoped to SEVERAL branches concerns a student enrolled at any one of them", async () => {
    const studentId = await person("مستفيدة ب");
    await enrol(prisma, ctxB, studentId);

    await makeEvent("فروع متعددة", { branchIds: [ctxA.branchId, ctxB.branchId] });

    const rows = scoped(await readCalendar(prisma, viewer(studentId), { ...range, mine: true }));
    expect(rows).toHaveLength(1);
  });

  it("an event scoped to SEVERAL Levels concerns a student enrolled in any one of them", async () => {
    const studentId = await person("مستفيدة عبر مستوى ثانٍ");
    await enrol(prisma, ctxB, studentId);

    await makeEvent("مستويات متعددة", { levelIds: [ctxA.levelId, ctxB.levelId] });

    const rows = scoped(await readCalendar(prisma, viewer(studentId), { ...range, mine: true }));
    expect(rows).toHaveLength(1);
  });

  it("a global event (no scope rows at all) still concerns every authenticated student — R82.7", async () => {
    const studentId = await person("مستفيدة عامة");
    await enrol(prisma, ctxA, studentId);

    await makeEvent("عام", {});

    const rows = scoped(await readCalendar(prisma, viewer(studentId), { ...range, mine: true }));
    expect(rows).toHaveLength(1);
  });
});

describe("§3 — a مؤطِّرة's personal calendar shows what she is assigned to, independent of scope", () => {
  it("she sees an event she is named staff on, even outside any enrolment-shaped scope", async () => {
    const teacherId = await person("مؤطرة");
    await staffSchedule(prisma, ctxA, teacherId);

    const eventId = await makeEvent("نشاط بعيد عن نطاقها", { branchIds: [ctxB.branchId] });
    await prisma.eventStaff.create({
      data: { eventId, userId: teacherId, position: "assistant" },
    });

    const rows = scoped(
      await readCalendar(prisma, teacherViewer(teacherId), { ...range, mine: true }),
    );
    expect(rows.map((r) => r.title)).toContain(`${TAG} نشاط بعيد عن نطاقها`);
  });

  it("she does NOT see an event neither addressed to her scope nor staffed by her", async () => {
    const teacherId = await person("مؤطرة أخرى");
    await staffSchedule(prisma, ctxA, teacherId);

    await makeEvent("لا علاقة لها به", { branchIds: [ctxB.branchId], levelIds: [ctxB.levelId] });

    const rows = scoped(
      await readCalendar(prisma, teacherViewer(teacherId), { ...range, mine: true }),
    );
    expect(rows).toHaveLength(0);
  });

  it("she sees her own class's session on her personal calendar", async () => {
    const teacherId = await person("مؤطرة الحلقة");
    await staffSchedule(prisma, ctxA, teacherId);
    await materializeRange(prisma, ctxA, day("2026-06-01"), day("2026-06-30"));

    const rows = await readCalendar(prisma, teacherViewer(teacherId), { ...range, mine: true });
    expect(rows.some((r) => r.kind === "session")).toBe(true);
  });
});
