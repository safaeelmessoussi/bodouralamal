import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * **NEW B §E — the visibility authorization matrix, at the real API boundary.**
 *
 * §§A–D built the tier: the column on all three kinds (§C), the narrowing of
 * `hidden` to ownership (§C), and the forms and recurrence scopes (§D). This
 * file is the regression proof, and it is deliberately **not** a service test:
 * every assertion goes over HTTP with a real token, because the question §E
 * exists to answer is *what does the API give this person*, and a service test
 * can be right about a `where` clause while a route composes it wrongly.
 *
 * ## Three properties, and each is asserted with BOTH halves
 *
 * 1. **The tier matrix.** Who reads `public`, `private` and `hidden` of each
 *    kind — and who does not. A permission test that proves only the *yes* is
 *    not a permission test.
 * 2. **`hidden` is OWNERSHIP, not staff visibility.** The distinction §C
 *    ratified: the responsible person plus Super Admin. A teacher *in scope*, an
 *    *assistant on the very same occurrence*, and an *Admin* are each asserted
 *    to be refused — they are the three ways the old rule would have let someone
 *    through.
 * 3. **Direct access is gated independently of the list.** A list that omits a
 *    row proves nothing about `GET /calendar/sessions/{id}`, so both are
 *    exercised, and the refusal is **`404` and never `403`** (§20 rule 17): a
 *    distinguishable answer would confirm the hidden class exists.
 *
 * ## Isolation is part of the acceptance criteria
 *
 * This suite creates **every** row it touches, under one tag, and cleans up by
 * that tag alone. It never picks *the first* existing schedule, never reorders a
 * shared catalogue, never splits a development schedule, and never touches
 * seeded staffing. The one shared row it reads — the current `AcademicYear` — it
 * reads and never writes. Three P1.2 incidents in this batch came from suites
 * that did otherwise.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[r109-matrix]";

type Tier = "public" | "private" | "hidden";
const TIERS: Tier[] = ["public", "private", "hidden"];

interface Body {
  error?: { code?: string };
  data?: Record<string, unknown>[];
  occurrence?: Record<string, unknown>;
  id?: string;
  [k: string]: unknown;
}

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall<Body>(BASE, method, path, {
    ...(token ? { token } : {}),
    ...(body !== undefined ? { body } : {}),
  });

/* ── The cast ───────────────────────────────────────────────────────────── */

const ids: Record<string, string> = {};
const tokens: Record<string, string | undefined> = {};

/** Every scheduling row this suite creates, by kind and tier. */
const rows: Record<"event" | "session" | "exam", Record<Tier, string>> = {
  event: {} as Record<Tier, string>,
  session: {} as Record<Tier, string>,
  exam: {} as Record<Tier, string>,
};
/** عطلة — an ordinary Event (OD-03), asserted as its own kind because the Owner
 *  named it, and because *«a holiday is special»* is the intuition to disprove. */
let vacationId = "";
const content: Record<Tier, string> = {} as Record<Tier, string>;

const bearer = (
  userId: string,
  roleScopes: { role: string; branches: string[] | null }[],
  accountStatus = "active",
): string =>
  issueAccessToken(
    { userId, roleScopes: roleScopes as never, accountStatus: accountStatus as never },
    config.JWT_SIGNING_KEY,
  ).token;

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: { sex: "female", nameArabic: `${TAG} ${label}`, accountStatus: "active" },
  });
  return u.id;
}

const WINDOW = { from: "2098-04-01", to: "2098-04-30" };
const ON = new Date("2098-04-15T00:00:00.000Z");
const AT_9 = new Date(Date.UTC(1970, 0, 1, 9, 0, 0));
const AT_10 = new Date(Date.UTC(1970, 0, 1, 10, 0, 0));

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  /* ── Structure, all owned by this suite ──────────────────────────────── */
  ids["branchA"] = (
    await prisma.branch.create({
      data: { name: `${TAG} فرع أ`, operationalStartDate: new Date("2026-01-01") },
    })
  ).id;
  ids["branchB"] = (
    await prisma.branch.create({
      data: { name: `${TAG} فرع ب`, operationalStartDate: new Date("2026-01-01") },
    })
  ).id;
  ids["category"] = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
  ids["level"] = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: ids["category"]!, genderRestriction: "any" },
    })
  ).id;
  ids["subject"] = (await prisma.subject.create({ data: { name: `${TAG} مادة` } })).id;
  await prisma.levelSubject.create({
    data: { levelId: ids["level"]!, subjectId: ids["subject"]! },
  });
  ids["room"] = (
    await prisma.room.create({
      data: { name: `${TAG} قاعة`, branchId: ids["branchA"]!, capacity: 20 },
    })
  ).id;
  ids["group"] = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId: ids["level"]!, branchId: ids["branchA"]! },
    })
  ).id;
  // READ ONLY — the academic year is shared reference data and this suite has
  // no business creating or changing one.
  ids["year"] = (await prisma.academicYear.findFirstOrThrow({ select: { id: true } })).id;

  // R110 requires a type on an Event; this suite creates its own rather than
  // depending on the seeded catalogue, which a developer database may have
  // renamed and which is not this suite's to rely on.
  ids["activityType"] = (
    await prisma.schedulingType.create({
      data: {
        name: `${TAG} نوع`,
        structuralKind: "activity",
        attendanceRequired: false,
        displayOrder: 990,
      },
    })
  ).id;

  /* ── People ──────────────────────────────────────────────────────────── */
  ids["student"] = await person("مستفيدة");
  ids["parent"] = await person("والدة");
  ids["responsible"] = await person("المؤطرة المسؤولة");
  ids["inScope"] = await person("مؤطرة في النطاق");
  ids["outOfScope"] = await person("مؤطرة خارج النطاق");
  ids["assistant"] = await person("مساعدة");
  ids["supervisor"] = await person("المراقبة");
  ids["eventOwner"] = await person("مسؤولة النشاط");
  ids["adminA"] = await person("إدارية أ");
  ids["adminB"] = await person("إدارية ب");
  ids["superAdmin"] = await person("مديرة عامة");
  ids["pending"] = (
    await prisma.user.create({
      data: { sex: "female", nameArabic: `${TAG} معلّقة`, accountStatus: "pending" },
    })
  ).id;

  // §4.9's private tier reaches a beneficiary through her ENROLMENT, so she is
  // enrolled — otherwise the content matrix below would measure a student with
  // no levels and every private row would be refused for the wrong reason.
  await prisma.enrollment.create({
    data: {
      studentId: ids["student"]!,
      administrativeGroupId: ids["group"]!,
      levelId: ids["level"]!,
      branchId: ids["branchA"]!,
    },
  });

  const teacherAtA = [{ role: "teacher", branches: [ids["branchA"]!] }];
  tokens["anonymous"] = undefined;
  tokens["pending"] = bearer(ids["pending"]!, [{ role: "student", branches: null }], "pending");
  tokens["student"] = bearer(ids["student"]!, [{ role: "student", branches: null }]);
  tokens["parent"] = bearer(ids["parent"]!, [{ role: "parent", branches: null }]);
  tokens["responsible"] = bearer(ids["responsible"]!, teacherAtA);
  tokens["inScope"] = bearer(ids["inScope"]!, teacherAtA);
  tokens["outOfScope"] = bearer(ids["outOfScope"]!, [
    { role: "teacher", branches: [ids["branchB"]!] },
  ]);
  tokens["assistant"] = bearer(ids["assistant"]!, teacherAtA);
  tokens["supervisor"] = bearer(ids["supervisor"]!, teacherAtA);
  tokens["eventOwner"] = bearer(ids["eventOwner"]!, teacherAtA);
  tokens["adminA"] = bearer(ids["adminA"]!, [{ role: "admin", branches: [ids["branchA"]!] }]);
  tokens["adminB"] = bearer(ids["adminB"]!, [{ role: "admin", branches: [ids["branchB"]!] }]);
  tokens["superAdmin"] = bearer(ids["superAdmin"]!, [
    { role: "super_admin", branches: null },
  ]);

  /* ── One item per kind per tier, all otherwise identical ─────────────── */
  for (const tier of TIERS) {
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط ${tier}`,
        schedulingTypeId: ids["activityType"]!,
        visibility: tier,
        startDate: ON,
        startTime: AT_9,
        recurrenceType: "none",
      },
    });
    /**
     * **Scoped to branch A explicitly.**
     *
     * §4.4: an event with NO branch rows is **global**, and a global event is in
     * scope for everyone — *"it belongs to every branch rather than to none"*.
     * The first version of this suite created its events unscoped and then
     * asserted that a branch-B Admin could not read the private one, which the
     * platform correctly refused to agree with. The rule is right; the fixture
     * was asking about branch bounding using an event that has no branch.
     *
     * The global case is a real and accepted rule, so it is asserted separately
     * below rather than lost.
     */
    await prisma.eventBranch.create({
      data: { eventId: event.id, branchId: ids["branchA"]! },
    });
    await prisma.eventStaff.create({
      data: { eventId: event.id, userId: ids["eventOwner"]!, position: "responsible" },
    });
    // The assistant is on the SAME event: R71.3 lets both positions see, and
    // R109 lets only `responsible` read a hidden one. Asserted, not assumed.
    await prisma.eventStaff.create({
      data: { eventId: event.id, userId: ids["assistant"]!, position: "assistant" },
    });
    rows.event[tier] = event.id;

    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة ${tier}`,
        subjectId: ids["subject"]!,
        teachingMode: "administrative_group",
        administrativeGroupId: ids["group"]!,
        branchId: ids["branchA"]!,
        startTime: AT_9,
        endTime: AT_10,
        recurrence: "weekly",
        weekdays: ["wednesday"],
        academicYearId: ids["year"]!,
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
    // R109/R91 — the occurrence's OWN snapshot is what resolves ownership, and
    // it is what `session.materialize` writes from the staffing effective on
    // this date. The assistant sits on the same occurrence deliberately.
    await prisma.sessionStaff.createMany({
      data: [
        { sessionId: session.id, userId: ids["responsible"]!, position: "teacher" },
        { sessionId: session.id, userId: ids["assistant"]!, position: "assistant" },
      ],
    });
    rows.session[tier] = session.id;

    const exam = await prisma.exam.create({
      data: {
        title: `${TAG} امتحان ${tier}`,
        mode: "physical",
        levelId: ids["level"]!,
        subjectId: ids["subject"]!,
        academicYearId: ids["year"]!,
        branchId: ids["branchA"]!,
        roomId: ids["room"]!,
        date: ON,
        startTime: AT_9,
        endTime: AT_10,
        maxGrade: 20,
        questions: [],
        visibility: tier,
      },
    });
    await prisma.examStaff.create({
      data: { examId: exam.id, userId: ids["supervisor"]!, position: "supervisor" },
    });
    rows.exam[tier] = exam.id;

    // §4.9 content, one per tier, linked to the PUBLIC session so the 3×3
    // independence matrix varies one axis at a time.
    const item = await prisma.educationalContent.create({
      data: {
        title: `${TAG} محتوى ${tier}`,
        subjectId: ids["subject"]!,
        levelId: ids["level"]!,
        academicYearId: ids["year"]!,
        visibility: tier,
        storageKey: `${TAG}/${tier}.pdf`,
        storageBucket: tier === "public" ? "public" : "private",
        mimeType: "application/pdf",
        originalFilename: `${tier}.pdf`,
        sizeBytes: 1024,
      },
    });
    content[tier] = item.id;
  }

  /**
   * **The 3×3 itself**: every content tier linked to every session tier.
   *
   * §4.9 makes content **referenced, never owned** — *"one semester PDF is
   * referenced by every session that uses it"* — so the two axes are genuinely
   * independent and the only way to prove it is to vary both.
   */
  for (const sessionTier of TIERS) {
    for (const contentTier of TIERS) {
      await prisma.sessionContent.create({
        data: { sessionId: rows.session[sessionTier], contentId: content[contentTier] },
      });
    }
  }

  // BR-2 — the consent gate forces non-public regardless of the chosen tier.
  // Public on its face, refused in fact: the row that proves the gate outranks
  // the tier rather than being one of its values.
  ids["forcedPrivate"] = (
    await prisma.educationalContent.create({
      data: {
        title: `${TAG} محتوى بموافقة مسحوبة`,
        subjectId: ids["subject"]!,
        levelId: ids["level"]!,
        academicYearId: ids["year"]!,
        visibility: "public",
        consentForcedPrivate: true,
        storageKey: `${TAG}/forced.pdf`,
        storageBucket: "private",
        mimeType: "application/pdf",
        originalFilename: "forced.pdf",
        sizeBytes: 1024,
      },
    })
  ).id;
  await prisma.sessionContent.create({
    data: { sessionId: rows.session.public, contentId: ids["forcedPrivate"]! },
  });

  // §4.4's accepted rule, kept as its own fixture: an event with NO branch rows
  // belongs to every branch, so its private tier reaches staff everywhere.
  ids["globalPrivateEvent"] = (
    await prisma.event.create({
      data: {
        title: `${TAG} نشاط عام الن,طاق private`,
        schedulingTypeId: ids["activityType"]!,
        visibility: "private",
        startDate: ON,
        startTime: AT_9,
        recurrenceType: "none",
      },
    })
  ).id;

  // عطلة — an ordinary schedulable Event (OD-03), public, so the assertion is
  // about the KIND and not about a tier that would explain the result anyway.
  vacationId = (
    await prisma.event.create({
      data: {
        title: `${TAG} عطلة`,
        schedulingTypeId: ids["activityType"]!,
        visibility: "public",
        startDate: ON,
        startTime: AT_9,
        recurrenceType: "none",
      },
    })
  ).id;
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
  const sessionIds = sessions.map((s) => s.id);
  await prisma.sessionContent.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.sessionStaff.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.notification.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.courseScheduleStaff.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { id: { in: scheduleIds } } });

  const events = await prisma.event.findMany({ where: { title: tagged }, select: { id: true } });
  const eventIds = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  const exams = await prisma.exam.findMany({ where: { title: tagged }, select: { id: true } });
  const examIds = exams.map((e) => e.id);
  await prisma.examStaff.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });

  await prisma.educationalContent.deleteMany({ where: { title: tagged } });
  await prisma.schedulingType.deleteMany({ where: { name: tagged } });
  await prisma.enrollment.deleteMany({ where: { administrativeGroup: { name: tagged } } });
  await prisma.administrativeGroup.deleteMany({ where: { name: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: { name: tagged } } });
  await prisma.subject.deleteMany({ where: { name: tagged } });
  await prisma.level.deleteMany({ where: { name: tagged } });
  await prisma.category.deleteMany({ where: { name: tagged } });
  await prisma.room.deleteMany({ where: { name: tagged } });

  const users = await prisma.user.findMany({
    where: { nameArabic: tagged },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: tagged } });
}

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/* ── The matrix, expressed once ─────────────────────────────────────────── */

/**
 * **Who may read a `hidden` item of each kind.**
 *
 * This table IS the ratified rule (§C, TASKS *"Resolved — do NOT re-ask"*):
 * the responsible person plus Super Admin, and **nobody else**. Everyone absent
 * from a row is asserted to be refused, which is where the value is.
 */
const HIDDEN_READERS: Record<"event" | "session" | "exam", string[]> = {
  event: ["eventOwner", "superAdmin"],
  session: ["responsible", "superAdmin"],
  exam: ["supervisor", "superAdmin"],
};

/** Everyone this suite mints, so a row can be asserted against the whole cast
 *  rather than against a hand-picked subset. */
const CAST = [
  "anonymous",
  "pending",
  "student",
  "parent",
  "responsible",
  "inScope",
  "outOfScope",
  "assistant",
  "supervisor",
  "eventOwner",
  "adminA",
  "adminB",
  "superAdmin",
];

/** The tiers a caller reads on the calendar, for one kind. */
async function tiersOnCalendar(
  who: string,
  kind: "event" | "session" | "exam",
): Promise<Tier[]> {
  /**
   * **The wire parameter is `type`, not `kind`.**
   *
   * `kind` is the field name inside `CalendarQuery`; the contract spells it
   * `type` (R84). The query schema is deliberately not `.strict()` — TD-10's
   * `page`/`page_size` share the object — so sending `kind=` is **silently
   * ignored** and the response is the unfiltered union of all three kinds.
   *
   * That is worth recording rather than just fixing: the first run of this suite
   * read like an authorization leak, with the responsible person of *every* kind
   * appearing to read every other kind's hidden row. The tier was correct
   * throughout; the harness was asking a different question.
   */
  const res = await call(
    "GET",
    `/calendar?from=${WINDOW.from}&to=${WINDOW.to}&type=${kind}`,
    tokens[who],
  );
  expect(res.status).toBe(200);
  /**
   * **Keyed on the three canonical ids, not on the tag.**
   *
   * A tag filter sweeps in every other row this suite creates — and it did: the
   * global-scope activity added for §4.4's other half is legitimately `private`,
   * so a branch-B Admin reading it made the branch-bounding assertion fail
   * against behaviour that was entirely correct. Naming the three rows the
   * matrix is about makes the helper immune to any fixture added later.
   */
  const canonical = new Set(Object.values(rows[kind]));
  const mine = (res.body.data ?? []).filter((r) => canonical.has(String(r["id"])));
  return [...new Set(mine.map((r) => r["visibility"] as Tier))].sort() as Tier[];
}

describe("§E — the public tier is public, for every kind", () => {
  for (const kind of ["event", "session", "exam"] as const) {
    it(`${kind}: an anonymous visitor reads the public tier and NOTHING else`, async () => {
      expect(await tiersOnCalendar("anonymous", kind)).toEqual(["public"]);
    });

    it(`${kind}: a PENDING account is exactly an anonymous visitor (TD-1)`, async () => {
      // The account exists and grants nothing. Asserted rather than assumed:
      // "signed in" and "approved" are two different facts.
      expect(await tiersOnCalendar("pending", kind)).toEqual(["public"]);
    });
  }

  it("عطلة is an ordinary schedulable activity, visible like any other (OD-03)", async () => {
    const res = await call(
      "GET",
      `/calendar?from=${WINDOW.from}&to=${WINDOW.to}&kind=event`,
    );
    const seen = (res.body.data ?? []).map((r) => String(r["id"]));
    // The intuition to disprove is that a holiday is special. It is not: it is
    // an Event with `attendance_required = false`, and it appears on the public
    // calendar exactly as a حفل does. Asserted by **id**, so a title collision
    // could not make this pass.
    expect(seen).toContain(vacationId);
  });
});

describe("§E — the private tier: approved accounts yes, anonymous no, staff by branch", () => {
  for (const kind of ["event", "session", "exam"] as const) {
    it(`${kind}: an approved Student and Parent read private, never hidden`, async () => {
      expect(await tiersOnCalendar("student", kind)).toEqual(["private", "public"]);
      expect(await tiersOnCalendar("parent", kind)).toEqual(["private", "public"]);
    });

    it(`${kind}: an Admin OUTSIDE the branch does not read private (§4.4)`, async () => {
      // The accepted asymmetry, pinned: §4.4 bounds staff by branch scope and
      // does not bound students at all, so a scoped Admin sees LESS private
      // material than any approved beneficiary. Unchanged by R109.
      expect(await tiersOnCalendar("adminB", kind)).toEqual(["public"]);
    });

    it(`${kind}: an Admin INSIDE the branch does read private`, async () => {
      expect(await tiersOnCalendar("adminA", kind)).toContain("private");
    });
  }

  it("a GLOBAL private activity reaches staff at every branch (§4.4, accepted)", async () => {
    // The other half of the branch rule, and the reason the assertion above
    // needed a scoped fixture: an event with no branch rows belongs to every
    // branch rather than to none, so a branch-B Admin reads it.
    const res = await call(
      "GET",
      `/calendar?from=${WINDOW.from}&to=${WINDOW.to}&type=event`,
      tokens["adminB"],
    );
    const ids_ = (res.body.data ?? []).map((r) => String(r["id"]));
    expect(ids_).toContain(ids["globalPrivateEvent"]);
  });
});

describe("§E — hidden is OWNERSHIP, and this is the whole of the claim", () => {
  for (const kind of ["event", "session", "exam"] as const) {
    it(`${kind}: exactly the responsible person and Super Admin read it — nobody else`, async () => {
      const readers: string[] = [];
      for (const who of CAST) {
        if ((await tiersOnCalendar(who, kind)).includes("hidden")) readers.push(who);
      }
      // Asserted as a SET over the whole cast rather than as a handful of spot
      // checks: the failure this guards against is somebody NEW being let in,
      // and a spot check cannot see that.
      expect(readers.sort()).toEqual([...HIDDEN_READERS[kind]].sort());
    });
  }

  it("an assistant on the very same occurrence is refused (R87 §G is about ACTING)", async () => {
    // R87 §G makes an assistant the main teacher for operational authorization
    // on the class she staffs. `hidden` is not an operation on the class; it is
    // who the item belongs to, and the Owner named the responsible position for
    // each kind. This is the arm most likely to be "fixed" by mistake later.
    expect(await tiersOnCalendar("assistant", "session")).not.toContain("hidden");
    expect(await tiersOnCalendar("assistant", "event")).not.toContain("hidden");
  });

  it("a teacher IN SCOPE but not responsible is refused", async () => {
    expect(await tiersOnCalendar("inScope", "session")).not.toContain("hidden");
  });

  it("an Admin in the item's own branch is refused — R109 narrowed §4.4", async () => {
    // §4.4 read "and to ALL Admins regardless of branch scope". This assertion
    // fails on the pre-R109 filter, which is what makes it a test of the rule.
    expect(await tiersOnCalendar("adminA", "event")).not.toContain("hidden");
    expect(await tiersOnCalendar("adminA", "session")).not.toContain("hidden");
    expect(await tiersOnCalendar("adminA", "exam")).not.toContain("hidden");
  });
});

/* ── Direct-by-id, which a list test cannot stand in for ────────────────── */

describe("§E — direct access is gated independently, and answers 404", () => {
  it("a hidden occurrence is 404 for everyone but its own teacher and a Super Admin", async () => {
    for (const who of CAST) {
      const res = await call(
        "GET",
        `/calendar/sessions/${rows.session.hidden}`,
        tokens[who],
      );
      const permitted = HIDDEN_READERS.session.includes(who);
      expect({ who, status: res.status }).toEqual({
        who,
        status: permitted ? 200 : 404,
      });
      if (!permitted) {
        // **404, never 403** (§20 rule 17): a distinguishable refusal confirms
        // the class exists, which is exactly what the tier prevents.
        expect(res.body.error?.code).toBe("NOT_FOUND");
      }
    }
  });

  it("a private occurrence is 404 for an anonymous caller and 200 for an approved one", async () => {
    // The pair that proves the by-id gate reads the TIER rather than merely
    // requiring a token.
    expect((await call("GET", `/calendar/sessions/${rows.session.private}`)).status).toBe(404);
    expect(
      (await call("GET", `/calendar/sessions/${rows.session.private}`, tokens["student"]))
        .status,
    ).toBe(200);
  });

  it("a public occurrence opens for an anonymous caller", async () => {
    const res = await call("GET", `/calendar/sessions/${rows.session.public}`);
    expect(res.status).toBe(200);
    expect(res.body.occurrence?.["visibility"]).toBe("public");
  });

  it("the management list is NOT gated by the tier — a hidden class stays administrable", async () => {
    // The boundary §C drew deliberately: `hidden` is a PUBLICATION tier, not an
    // administration one. An Admin who could not see a hidden class in the
    // management list could not un-hide it, so the tier would make hidden items
    // unadministrable rather than confidential.
    const res = await call("GET", "/admin/course-schedules?page_size=200", tokens["adminA"]);
    const titles = (res.body.data ?? []).map((r) => String(r["title"]));
    expect(titles).toContain(`${TAG} حصة hidden`);
  });
});

/* ── Event × Content independence, the full 3×3 ─────────────────────────── */

/**
 * **The two axes are independent, and the sentence that says so is §4.9's:
 * *"the content gates, the sessions do not."***
 *
 * Every content tier is linked to every session tier, so each assertion below
 * varies one axis while the other takes all three values. The failure this
 * guards against is the plausible one — somebody deciding that a hidden class
 * ought to hide its materials, or that a public class ought to publish them.
 * Both would be wrong, and in opposite directions.
 */
describe("§E — scheduling visibility and content visibility are independent", () => {
  const libraryIds = async (token?: string): Promise<string[]> => {
    const res = await call("GET", "/library?page_size=200", token);
    expect(res.status).toBe(200);
    return (res.body.data ?? []).map((r) => String(r["id"]));
  };

  it("a hidden or private class does NOT remove independently public content from the public library", async () => {
    // The public item is linked to the hidden session AND the private one. If
    // scheduling visibility leaked into §4.9, it would vanish from the anonymous
    // library — taking a genuinely public resource off the public site because
    // of a class nobody outside the office can see.
    expect(await libraryIds()).toContain(content.public);
  });

  it("a PUBLIC class does not publish content whose own tier forbids the caller", async () => {
    const anonymous = await libraryIds();
    // Both are linked to the public session; neither may be read by a visitor.
    expect(anonymous).not.toContain(content.private);
    expect(anonymous).not.toContain(content.hidden);
  });

  it("BR-2 — consent_forced_private outranks the tier, even on a public class", async () => {
    // `visibility = 'public'` and refused in fact. The gate is not one of the
    // tier's values; it overrides whatever the tier says.
    expect(await libraryIds()).not.toContain(ids["forcedPrivate"]);
  });

  it("the §5.2 session page shows each caller only the content SHE may see", async () => {
    // One request, returning some things and withholding others — §5.2's own
    // sentence, and the claim no single-list assertion can express.
    const anonymous = await call("GET", `/calendar/sessions/${rows.session.public}`);
    expect(anonymous.status).toBe(200);
    const anonIds = [
      ...((anonymous.body["linked_content"] as Record<string, unknown>[]) ?? []),
      ...((anonymous.body["recordings"] as Record<string, unknown>[]) ?? []),
    ].map((c) => String(c["id"]));
    expect(anonIds).toContain(content.public);
    expect(anonIds).not.toContain(content.private);
    expect(anonIds).not.toContain(content.hidden);
    expect(anonIds).not.toContain(ids["forcedPrivate"]);

    // The enrolled beneficiary reaches the private tier at her own Level (§4.9),
    // and still never the hidden one.
    const hers = await call(
      "GET",
      `/calendar/sessions/${rows.session.public}`,
      tokens["student"],
    );
    const herIds = [
      ...((hers.body["linked_content"] as Record<string, unknown>[]) ?? []),
      ...((hers.body["recordings"] as Record<string, unknown>[]) ?? []),
    ].map((c) => String(c["id"]));
    expect(herIds).toContain(content.private);
    expect(herIds).not.toContain(content.hidden);
  });

  it("direct content authorization stays the CONTENT's, whatever it is linked to", async () => {
    // Linked to a public session, and still refused: a caller who may not see
    // the item gets the same 404 a nonexistent id gets, because an empty list
    // would confirm the id exists (§20 rule 17).
    const refused = await call("GET", `/library/${content.hidden}/sessions`);
    expect(refused.status).toBe(404);
    expect(refused.body.error?.code).toBe("NOT_FOUND");

    // And the same id, for staff, resolves.
    const allowed = await call(
      "GET",
      `/library/${content.hidden}/sessions`,
      tokens["adminA"],
    );
    expect(allowed.status).toBe(200);
  });

  it("scheduling visibility does not weaken B-01/B-02 download authorization", async () => {
    // The storage boundary is the content's alone. Being referenced by a public
    // class must not mint a URL for an item the caller may not read.
    const refused = await call("GET", `/content/${content.private}/download-url`);
    expect([401, 403, 404]).toContain(refused.status);

    const forced = await call(
      "GET",
      `/content/${ids["forcedPrivate"]}/download-url`,
      tokens["student"],
    );
    // BR-2 again, at the storage boundary rather than the directory one.
    expect([401, 403, 404]).toContain(forced.status);
  });

  it("the sessions a content item names are filtered by the SESSION tier", async () => {
    // The other direction of the same independence: the content gates entry,
    // and then each session it names is filtered by its own tier. A visitor
    // reaching a public item must not learn that a hidden class uses it.
    const res = await call("GET", `/library/${content.public}/sessions`);
    expect(res.status).toBe(200);
    const seen = (res.body.data ?? []).map((r) => String(r["id"]));
    expect(seen).toContain(rows.session.public);
    expect(seen).not.toContain(rows.session.private);
    expect(seen).not.toContain(rows.session.hidden);
  });
});

/* ── The recurrence invariant §C could not prove from a list ────────────── */

describe("§E — hidden ownership follows the teacher effective on EACH occurrence's date", () => {
  it("a replaced مؤطِّرة keeps the occurrences she taught, and gains none she did not", async () => {
    /**
     * **R91's invariant, and the one defect Codex caught in R106.**
     *
     * A schedule may hold several `position = 'teacher'` rows with different
     * effective periods; *"at most one main on any given DATE"* is enforced,
     * *"one main for the series"* is not true at all. Resolving ownership as of
     * *today* would strip a replaced مؤطِّرة of the occurrences she actually
     * taught and hand her ones she did not.
     *
     * `SessionStaff` is how §C spells that resolution — the snapshot
     * `session.materialize` writes from the staffing effective on the
     * occurrence's own date — so the fixture states two occurrences of ONE
     * hidden schedule with two different main teachers, which is precisely what
     * a mid-series replacement produces.
     */
    const schedule = await prisma.recurringCourseSchedule.create({
      data: {
        title: `${TAG} حصة بتعاقب`,
        subjectId: ids["subject"]!,
        teachingMode: "administrative_group",
        administrativeGroupId: ids["group"]!,
        branchId: ids["branchA"]!,
        startTime: AT_9,
        endTime: AT_10,
        recurrence: "weekly",
        weekdays: ["thursday"],
        academicYearId: ids["year"]!,
        visibility: "hidden",
      },
    });

    const earlier = await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: new Date("2098-04-02T00:00:00.000Z"),
        startTime: AT_9,
        endTime: AT_10,
        visibility: "hidden",
      },
    });
    const later = await prisma.session.create({
      data: {
        scheduleId: schedule.id,
        date: new Date("2098-04-09T00:00:00.000Z"),
        startTime: AT_9,
        endTime: AT_10,
        visibility: "hidden",
      },
    });
    // The replacement, as the snapshot records it.
    await prisma.sessionStaff.create({
      data: { sessionId: earlier.id, userId: ids["responsible"]!, position: "teacher" },
    });
    await prisma.sessionStaff.create({
      data: { sessionId: later.id, userId: ids["inScope"]!, position: "teacher" },
    });

    const read = (sessionId: string, who: string) =>
      call("GET", `/calendar/sessions/${sessionId}`, tokens[who]);

    // Each reads her own date, and neither reads the other's. Both halves, or
    // the assertion would pass on a rule that simply let both through.
    expect((await read(earlier.id, "responsible")).status).toBe(200);
    expect((await read(later.id, "responsible")).status).toBe(404);
    expect((await read(later.id, "inScope")).status).toBe(200);
    expect((await read(earlier.id, "inScope")).status).toBe(404);

    // And a Super Admin reads both, which is the other half of the ratified rule.
    expect((await read(earlier.id, "superAdmin")).status).toBe(200);
    expect((await read(later.id, "superAdmin")).status).toBe(200);
  });
});
