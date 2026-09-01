import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { createStorageClients } from "../lib/storage.js";
import { issueNewSession } from "../services/refresh-token.service.js";
import {
  DELETED_ACCOUNT_NAME,
  deIdentifyAccount,
  deleteOwnAccount,
  purgeUserAccount,
} from "../services/account-deletion.service.js";
import { setEventStaff } from "../services/event.service.js";
import { initiateUpload } from "../services/content.service.js";
import { notifyEventStaffAssigned } from "../services/notification.service.js";
import { writeProfile } from "../services/social-profile.service.js";
import { replaceTeachingProfile } from "../services/teaching-profile.service.js";
import { restoreEntry } from "../services/trash.service.js";
import * as userRepository from "../repositories/user.repository.js";
import { actorFor } from "../test-support/actor.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * User management over HTTP — §5.6 *"edit, deactivate, role/branch-scope
 * assignment"*, §14.2, TD-1, TD-4.15, TD-12, TD-15.
 *
 * The properties worth pinning are the ones that make this surface *safe* rather
 * than merely present: that a suspension actually revokes credentials, that the
 * refused keys are refused rather than dropped, that privilege cannot propagate
 * sideways, and that the platform cannot be locked out of its own back office
 * with one click.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = `[http-usermgmt-test:${randomUUID()}]`;

interface Res {
  status: number;
  body: {
    error?: { code?: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>;
  };
}

const call = (
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Res> =>
  httpCall<Res["body"]>(BASE, method, path, {
    ...(token !== undefined ? { token } : {}),
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

let superAdminId: string;
let superAdmin: string;
let branchAdmin: string;
let branchId: string;
let otherBranchId: string;
/** A second live Super Admin, so the last-administrator guard is not the thing
 *  under test in every other case. */
let spareSuperAdminId: string;

/**
 * **Every user this suite creates, by id.**
 *
 * The teardown used to find its rows by the `TAG` name prefix, which R111 broke:
 * a de-identified account is renamed «حساب محذوف», so a deleted one stopped
 * matching and was left behind — accumulating across runs and, worse, changing
 * the all-table snapshot the isolation guard compares (P1.2).
 *
 * An id never changes. The name was only ever a convenience.
 */
const createdUserIds: string[] = [];
/** Stable email-lock rows deliberately outlive ownership; tests record the
 * addresses they introduce so teardown removes only their own infrastructure. */
const createdEmails: string[] = [];

async function makeUser(
  label: string,
  status = "active",
  sex: "female" | "male" | null = null,
  beneficiary = false,
): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: status as never,
      ...(sex === null ? {} : { sex }),
      isBeneficiary: beneficiary,
    },
  });
  createdUserIds.push(u.id);
  return u.id;
}

async function grant(
  userId: string,
  role: string,
  branch: string | null,
): Promise<void> {
  const roleRow = await prisma.role.findUniqueOrThrow({
    where: { name: role },
  });
  await prisma.userBranchRole.create({
    data: { userId, roleId: roleRow.id, branchId: branch },
  });
}

/**
 * A live recurring class staffed by `userId` — the R111 BLOCK fixture.
 *
 * Built directly rather than through the API because the property under test is
 * the deletion refusal, not schedule creation: a fixture that had to satisfy the
 * scheduling validators would fail for reasons that are not this test's subject.
 */
async function liveScheduleStaffedBy(
  userId: string,
  bounds: { scheduleUntil?: Date; staffUntil?: Date } = {},
): Promise<string> {
  const subject = await prisma.subject.findFirstOrThrow({ where: { deletedAt: null } });
  const level = await prisma.level.findFirstOrThrow({ where: { deletedAt: null } });
  // AcademicYear carries no soft-delete column — it is a period, not a record
  // that can be withdrawn.
  const year = await prisma.academicYear.findFirstOrThrow({});
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
      title: `${TAG} حصة حية`,
      subjectId: subject.id,
      levelId: level.id,
      teachingMode: "entire_level",
      branchId,
      academicYearId: year.id,
      recurrence: "weekly",
      weekdays: ["monday"],
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T10:00:00Z"),
      ...(bounds.scheduleUntil === undefined
        ? {}
        : { effectiveUntil: bounds.scheduleUntil }),
    },
  });
  await prisma.courseScheduleStaff.create({
    data: {
      scheduleId: schedule.id,
      userId,
      position: "teacher",
      ...(bounds.staffUntil === undefined ? {} : { effectiveUntil: bounds.staffUntil }),
    },
  });
  return schedule.id;
}

async function responsibleForEvent(userId: string, startDate: Date): Promise<string> {
  const event = await prisma.event.create({
    data: {
      title: `${TAG} نشاط مسؤولية`,
      visibility: "hidden",
      startDate,
      recurrenceType: "none",
    },
  });
  await prisma.eventStaff.create({
    data: { eventId: event.id, userId, position: "responsible" },
  });
  return event.id;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  // The name prefix AND the ids this suite recorded — a de-identified account
  // answers to neither its old name nor the TAG.
  const ids = [...new Set([...users.map((u) => u.id), ...createdUserIds])];
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
    });
    // Enrolments are RESTRICT against `user` (TD-5) — a placement is part of
    // the record of what happened, so it never vanishes beneath a person. The
    // R79 suite creates one, so the teardown unwinds it first.
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.familyLink.deleteMany({
      where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    });
    await prisma.rateLimitCounter.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
    });
    await prisma.studentSocialProfile.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.teacherAvailability.deleteMany({ where: { userId: { in: ids } } });
    await prisma.teacherSubjectCapability.deleteMany({ where: { userId: { in: ids } } });
    await prisma.teacherCategoryCapability.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    // **R111's own residue** (2026-08-28). Deleting an account writes a Trash
    // row, revokes sessions and staffs nothing — but the BLOCK fixture staffs a
    // real schedule, and all of it is RESTRICT against `user`. Removed here in
    // dependency order so the suite leaves the all-table snapshot as it found
    // it (P1.2); the schedule itself goes below, once its staffing is gone.
    await prisma.trash.deleteMany({
      where: { OR: [{ deletedById: { in: ids } }, { targetId: { in: ids } }] },
    });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.eventStaff.deleteMany({ where: { userId: { in: ids } } });
    await prisma.courseScheduleStaff.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (createdEmails.length > 0) {
    await prisma.normalizedEmailLock.deleteMany({ where: { email: { in: createdEmails } } });
  }
  await prisma.recurringCourseSchedule.deleteMany({
    where: { title: { startsWith: TAG } },
  });
  await prisma.event.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.enrollment.deleteMany({
    where: { level: { name: { startsWith: TAG } } },
  });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  // The R79 suite creates a Level and its Category; Levels are
  // RESTRICT-referenced by their Category, so they unwind in that order.
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  otherBranchId = (
    await prisma.branch.create({ data: { name: `${TAG} فرع آخر` } })
  ).id;

  superAdminId = await makeUser("مدير عام");
  await grant(superAdminId, "super_admin", null);
  superAdmin = bearer(superAdminId, [{ role: "super_admin", branches: null }]);

  // A second fixture-owned administrator lets role-mutation tests restore their
  // own caller without ever borrowing or parking the seeded Platform Owner.
  spareSuperAdminId = await makeUser("مدير عام احتياطي");
  await grant(spareSuperAdminId, "super_admin", null);

  const adminId = await makeUser("مسؤولة الفرع");
  await grant(adminId, "admin", branchId);
  branchAdmin = bearer(adminId, [{ role: "admin", branches: [branchId] }]);
});

afterAll(async () => {
  await clear();

  // **The cheap approximation of "this suite borrowed nothing it did not
  // return".** R115 means a seeded Platform Owner is always an active Global
  // Super Admin. This suite never parks that ambient account; it changes only
  // TAG-owned fixtures and still asserts the platform remains administrable.
  const administrable = await prisma.user.count({
    where: {
      accountStatus: "active",
      deletedAt: null,
      branchRoles: { some: { deletedAt: null, role: { name: "super_admin" } } },
    },
  });
  await prisma.$disconnect();
  expect(administrable).toBeGreaterThan(0);
});

describe("PATCH /admin/users/{id} — the person's own fields", () => {
  it("edits, and answers with the shape the list already renders", async () => {
    const id = await makeUser("طالبة");
    await grant(id, "student", branchId);

    const list = await call(
      "GET",
      `/admin/users?q=${encodeURIComponent(TAG)}`,
      superAdmin,
    );
    expect(list.status).toBe(200);
    const row = (
      list.body as unknown as { data: Record<string, unknown>[] }
    ).data.find((r) => r["id"] === id)!;
    // The version travels on the LIST, which is why there is no separate
    // single-user read for the edit dialog to call.
    expect(typeof row["version"]).toBe("number");

    const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: row["version"],
      nickname: "أم عبد الله",
      phone: "0600000000",
    });
    expect(res.status).toBe(200);
    expect(res.body.data!["nickname"]).toBe("أم عبد الله");
    expect(res.body.data!["version"]).toBe((row["version"] as number) + 1);
  });

  it("prefills the name PARTS on a row that only carries the composed name", async () => {
    /**
     * **The defect this pins** (2026-08-28). `تعديل بيانات المستخدم` opened
     * with الاسم الشخصي and الاسم العائلي empty for every account created
     * before Revisions 40–41, and `حفظ` then did nothing at all: both fields
     * are required, so the form failed validation and returned without a word.
     *
     * `makeUser` writes ONLY `nameArabic` — exactly the production shape — so
     * this fixture is the defect. The list must hand the dialog something to
     * prefill, and what it hands back must survive being saved.
     */
    const id = await makeUser("سعاد المسوسي");
    await grant(id, "student", branchId);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    // Guard the guard: if a later migration backfills the parts, this test
    // stops exercising the case it was written for and must be revisited.
    expect(stored.firstNameArabic).toBeNull();
    expect(stored.lastNameArabic).toBeNull();

    const list = await call(
      "GET",
      `/admin/users?q=${encodeURIComponent(TAG)}`,
      superAdmin,
    );
    const row = (
      list.body as unknown as { data: Record<string, unknown>[] }
    ).data.find((r) => r["id"] === id)!;
    expect(row["first_name_arabic"]).toBe(TAG);
    expect(row["last_name_arabic"]).toBe("سعاد المسوسي");

    // Derived for READING only — the row itself is untouched until she saves.
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(untouched.firstNameArabic).toBeNull();

    // And saving the prefilled form persists the parts, which is the half that
    // silently did nothing before.
    const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: row["version"],
      first_name_arabic: "سعاد",
      last_name_arabic: "المسوسي",
    });
    expect(res.status).toBe(200);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(saved.firstNameArabic).toBe("سعاد");
    expect(saved.lastNameArabic).toBe("المسوسي");
    // §1.1 — the composed name is the server's, recomposed from the parts.
    expect(saved.nameArabic).toBe("سعاد المسوسي");
  });

  it("sorts by EITHER name part, and legacy rows sort by their real family name", async () => {
    /**
     * **The trap this pins** (Owner, 2026-08-30). Ordering by
     * `last_name_arabic` would put every row predating Revisions 40–41 under
     * NULL — sorting by *whether anybody has edited this person*, not by her
     * family name. The order runs through the GENERATED columns instead, which
     * carry the same derivation `splitComposedName` applies on read.
     *
     * The fixture mixes both shapes deliberately: two rows with **no stored
     * parts** — what `makeUser` writes, and what production rows look like —
     * and one with them. If the sort read the stored columns, the two legacy
     * rows would collect at one end whatever their names, and this order could
     * not hold.
     *
     * **Named without the TAG**, because the tag is a token of `name_arabic`
     * and would therefore *be* the derived personal name. Ids are recorded so
     * the teardown still collects them (it deletes the union of the tag query
     * and `createdUserIds`), and the assertions read the **relative** order of
     * these three rows only — never the whole table, which other suites share.
     */
    const named = async (
      composed: string,
      parts: { first: string; last: string } | null,
    ): Promise<string> => {
      const u = await prisma.user.create({
        data: {
          sex: "female",
          nameArabic: composed,
          accountStatus: "active",
          ...(parts === null
            ? {}
            : { firstNameArabic: parts.first, lastNameArabic: parts.last }),
        },
      });
      createdUserIds.push(u.id);
      return u.id;
    };

    const yousfi = await named("زينب اليوسفي", null); // legacy: parts NULL
    const baqali = await named("مريم البقالي", null); // legacy: parts NULL
    const tazi = await named("هدى التازي", { first: "هدى", last: "التازي" });
    const mine = [yousfi, baqali, tazi];
    for (const id of mine) await grant(id, "student", branchId);

    const order = async (by: string, dir: string): Promise<string[]> => {
      const res = await call(
        "GET",
        `/admin/users?sort_by=${by}&sort_dir=${dir}&page_size=100`,
        superAdmin,
      );
      if (res.status !== 200) throw new Error(JSON.stringify(res.body));
      return (res.body as unknown as { data: Record<string, unknown>[] }).data
        .filter((r) => mine.includes(String(r["id"])))
        .map((r) => String(r["last_name_arabic"]));
    };

    // البقالي · التازي · اليوسفي — Arabic collation, with the two DERIVED family
    // names interleaved WITH the stored one rather than parked beside it.
    expect(await order("last_name", "asc")).toEqual(["البقالي", "التازي", "اليوسفي"]);
    expect(await order("last_name", "desc")).toEqual(["اليوسفي", "التازي", "البقالي"]);

    // And the personal name orders INDEPENDENTLY. Arabic collation puts
    // ز before م before ه, so the personal order is زينب · مريم · هدى — while
    // the family order above is البقالي · التازي · اليوسفي, i.e. مريم · هدى ·
    // زينب. **The two orders are different**, which is the whole point: a
    // single sort serving both columns could not produce both.
    const byFirst = async (dir: string): Promise<string[]> => {
      const res = await call(
        "GET",
        `/admin/users?sort_by=first_name&sort_dir=${dir}&page_size=100`,
        superAdmin,
      );
      if (res.status !== 200) throw new Error(JSON.stringify(res.body));
      return (res.body as unknown as { data: Record<string, unknown>[] }).data
        .filter((r) => mine.includes(String(r["id"])))
        .map((r) => String(r["first_name_arabic"]));
    };
    expect(await byFirst("asc")).toEqual(["زينب", "مريم", "هدى"]);
    expect(await byFirst("desc")).toEqual(["هدى", "مريم", "زينب"]);
  });

  it("refuses a sort field outside the allow-list rather than passing it on", async () => {
    // R76 — `sort_by` names a contract field, never a column. Restated because
    // two fields were just added to that list, and the column they order by is
    // NOT one of them: the generated columns are an implementation detail and
    // naming one must still be refused.
    const res = await call("GET", "/admin/users?sort_by=first_name_sort&sort_dir=asc", superAdmin);
    expect(res.status).toBe(400);
  });

  it("refuses account_status rather than dropping it", async () => {
    // The whole reason suspension is its own verb: TD-4.15 requires session
    // revocation in the same transaction, and a client that set this field and
    // received 200 would believe access had been withdrawn while a 30-day
    // credential was still live.
    const id = await makeUser("طالبة أخرى");
    await grant(id, "student", branchId);
    const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: 0,
      account_status: "suspended",
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id } })).accountStatus,
    ).toBe("active");
  });

  it("refuses pre_provisioned_email and public_display_name", async () => {
    // The first authorises CLAIMING an account (§7 R15); the second is resolved
    // server-side (§20 rule 21), and a back-office form is exactly where a
    // second answer to "which name did this person publish" would appear.
    const id = await makeUser("طالبة ثالثة");
    await grant(id, "student", branchId);
    for (const key of ["pre_provisioned_email", "public_display_name"]) {
      const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
        version: 0,
        [key]: "x@example.com",
      });
      expect(res.status).toBe(400);
    }
  });

  it("refuses a stale version with 409 rather than overwriting", async () => {
    const id = await makeUser("طالبة رابعة");
    await grant(id, "student", branchId);
    const res = await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: 99,
      nickname: "x",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("VERSION_CONFLICT");
  });

  it("discloses nothing to a branch Admin — the refusal is UNIFORM (restated 2026-08-28)", async () => {
    /**
     * **§20 rule 17's property survives; its shape changed with the Owner's
     * clarification.**
     *
     * This asserted `404`, never `403`, because *"exists, but not yours"* is
     * itself the disclosure §4.2 R25 prevents — and that was right while an
     * Admin could edit SOME accounts and had to be told nothing about the rest.
     *
     * Account administration is now Super Admin's alone, so an Admin is refused
     * the capability rather than the row. **`403` is now the non-disclosing
     * answer, and uniformity is what makes it so**: the same status comes back
     * for a real out-of-scope user, a user inside their own branch, and an id
     * that does not exist at all. Nothing in the response varies with the
     * target, so nothing about the target is learnable.
     *
     * The scope-based rule has not gone away — it moved to `/admin/directory`,
     * where a branch-scoped Admin IS authorized and out-of-scope people simply
     * do not appear. That is asserted below.
     */
    const outOfScope = await makeUser("طالبة في فرع آخر");
    await grant(outOfScope, "student", otherBranchId);
    const inScope = await makeUser("طالبة في فرعها");
    await grant(inScope, "student", branchId);
    const absent = "00000000-0000-4000-8000-0000000000ff";

    const statuses: number[] = [];
    for (const id of [outOfScope, inScope, absent]) {
      const res = await call("PATCH", `/admin/users/${id}`, branchAdmin, {
        version: 0,
        nickname: "x",
      });
      statuses.push(res.status);
      expect(res.body.error?.code).toBe("FORBIDDEN");
    }
    // The whole property in one line: three very different targets, one answer.
    expect(statuses).toEqual([403, 403, 403]);
  });

  it("records which fields changed, never their values", async () => {
    // A name and a phone number are personal data; TD-8's record must not
    // become a second copy of them.
    const id = await makeUser("طالبة خامسة");
    await grant(id, "student", branchId);
    await call("PATCH", `/admin/users/${id}`, superAdmin, {
      version: 0,
      nickname: "سرّي",
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { targetEntity: "User", targetId: id, actionType: "user.update" },
    });
    expect(row.detail).toEqual({ fields: ["nickname"] });
    expect(JSON.stringify(row.detail)).not.toContain("سرّي");
  });
});

describe("POST /admin/users/{id}/suspend — TD-1 Active → Suspended", () => {
  it("revokes every live session in the same transaction (TD-4.15)", async () => {
    const id = await makeUser("أستاذة موقوفة");
    await grant(id, "teacher", branchId);
    // A live credential, which the suspension must invalidate immediately —
    // otherwise a 30-day refresh token outlives the decision.
    await issueNewSession(prisma, id);

    const res = await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
      version: 0,
      reason: "اختبار",
    });
    expect(res.status).toBe(200);
    expect(res.body.data!["account_status"]).toBe("suspended");

    const live = await prisma.refreshToken.count({
      where: { userId: id, revokedAt: null },
    });
    expect(live).toBe(0);
    // The revocation is attributable, not merely counted (§7).
    const revocation = await prisma.auditLog.findFirst({
      where: {
        targetEntity: "User",
        targetId: id,
        actionType: "auth.token_revoked",
      },
    });
    expect(revocation).not.toBeNull();
  });

  it("demands a reason, and refuses a blank one", async () => {
    const id = await makeUser("أستاذة ثانية");
    await grant(id, "teacher", branchId);
    for (const reason of [undefined, "", "   "]) {
      const res = await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
        version: 0,
        ...(reason === undefined ? {} : { reason }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("refuses any starting status but Active (TD-1)", async () => {
    const id = await makeUser("حساب معلّق", "pending");
    await grant(id, "student", branchId);
    const res = await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
      version: 0,
      reason: "اختبار",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("INVALID_TRANSITION");
  });

  it("refuses self-suspension", async () => {
    // Not paternalism: the administrator is locked out by their own next
    // request, and the recovery path is a VPS shell.
    const res = await call(
      "POST",
      `/admin/users/${superAdminId}/suspend`,
      superAdmin,
      {
        version: 0,
        reason: "اختبار",
      },
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("SELF_SUSPENSION");
  });

  it("reactivates, and leaves the sessions revoked", async () => {
    const id = await makeUser("أستاذة معادة");
    await grant(id, "teacher", branchId);
    await call("POST", `/admin/users/${id}/suspend`, superAdmin, {
      version: 0,
      reason: "اختبار",
    });

    const res = await call(
      "POST",
      `/admin/users/${id}/reactivate`,
      superAdmin,
      { version: 1 },
    );
    expect(res.status).toBe(200);
    expect(res.body.data!["account_status"]).toBe("active");
    // Signing in again is the only way the new state is proven rather than
    // assumed, so nothing un-revokes.
    expect(
      await prisma.refreshToken.count({
        where: { userId: id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it("will not reactivate a Rejected account — that status is terminal", async () => {
    // Re-admitting a rejected applicant is a fresh registration decision, not
    // the undo of a suspension (TD-1, §4.1b step 4a).
    const id = await makeUser("حساب مرفوض", "rejected");
    await grant(id, "student", branchId);
    const res = await call(
      "POST",
      `/admin/users/${id}/reactivate`,
      superAdmin,
      { version: 0 },
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("INVALID_TRANSITION");
  });
});

describe("PUT /admin/users/{id}/roles — the complete assignment set", () => {
  it("replaces the set, tombstoning what it removes (TD-5)", async () => {
    const id = await makeUser("أستاذة تنتقل");
    await grant(id, "teacher", branchId);

    const res = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "teacher", branch_id: otherBranchId }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data!["roles"]).toEqual([
      {
        role: "teacher",
        branch_id: otherBranchId,
        branch_name: `${TAG} فرع آخر`,
      },
    ]);

    // The revoked assignment is soft-deleted, not erased: "who taught at this
    // branch in March" stays answerable.
    const removed = await prisma.userBranchRole.findFirst({
      where: { userId: id, branchId, deletedAt: { not: null } },
    });
    expect(removed).not.toBeNull();
  });

  it("revives a tombstoned assignment rather than colliding with the unique index", async () => {
    // `(user_id, role_id, branch_id)` is unique across deleted rows too, so an
    // insert here would fail outright.
    const id = await makeUser("أستاذة تعود");
    await grant(id, "teacher", branchId);
    await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [],
    });
    const res = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "teacher", branch_id: branchId }],
    });
    expect(res.status).toBe(200);
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, branchId, deletedAt: null },
      }),
    ).toBe(1);
  });

  it("refuses an Admin granting an administrator role — privilege propagation", async () => {
    const id = await makeUser("مرشحة للإدارة");
    await grant(id, "teacher", branchId);
    const res = await call("PUT", `/admin/users/${id}/roles`, branchAdmin, {
      assignments: [
        { role: "teacher", branch_id: branchId },
        { role: "admin", branch_id: branchId },
      ],
    });
    expect(res.status).toBe(403);
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, deletedAt: null, role: { name: "admin" } },
      }),
    ).toBe(0);
  });

  it("lets a Super Admin grant super_admin (Revision 22)", async () => {
    // Revision 22: after bootstrap, every change of administrators happens
    // EXCLUSIVELY through the application. Refusing the role here would leave a
    // VPS shell as the only route to a second Super Admin.
    const id = await makeUser("مديرة عامة جديدة");
    await grant(id, "admin", branchId);
    const res = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "super_admin", branch_id: null }],
    });
    expect(res.status).toBe(200);
    expect((res.body.data!["roles"] as { role: string }[])[0]!.role).toBe(
      "super_admin",
    );
  });

  it("keeps global administration continuous while a non-owner Super Admin is demoted", async () => {
    // R115 supersedes the old test setup that suspended every other Super Admin
    // to manufacture a zero-administrator state. The protected Owner is now a
    // permanent active Global Super Admin until atomic transfer, so the honest
    // reachable case is that an ordinary Super Admin may be demoted while that
    // Owner keeps continuity. The LAST_SUPER_ADMIN production guard is retained
    // for a pre-bootstrap database; this integration test does not weaken or
    // bypass it, and never mutates an ambient account.
    const owner = await prisma.platformOwner.findUniqueOrThrow({
      where: { singletonKey: "platform" },
      include: {
        ownerUser: {
          include: {
            branchRoles: {
              where: { deletedAt: null, branchId: null, role: { name: "super_admin" } },
            },
          },
        },
      },
    });
    expect(owner.ownerUserId).not.toBe(superAdminId);
    expect(owner.ownerUser.accountStatus).toBe("active");
    expect(owner.ownerUser.deletedAt).toBeNull();
    expect(owner.ownerUser.branchRoles).toHaveLength(1);

    const restoreToken = bearer(spareSuperAdminId, [
      { role: "super_admin", branches: null },
    ]);
    try {
      const res = await call(
        "PUT",
        `/admin/users/${superAdminId}/roles`,
        superAdmin,
        {
          assignments: [],
        },
      );
      expect(res.status).toBe(200);
      expect(
        await prisma.userBranchRole.count({
          where: {
            userId: superAdminId,
            deletedAt: null,
            role: { name: "super_admin" },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.platformOwner.findUniqueOrThrow({
          where: { singletonKey: "platform" },
          select: { ownerUserId: true },
        }),
      ).toEqual({ ownerUserId: owner.ownerUserId });
    } finally {
      const restored = await call(
        "PUT",
        `/admin/users/${superAdminId}/roles`,
        restoreToken,
        { assignments: [{ role: "super_admin", branch_id: null }] },
      );
      if (restored.status !== 200) {
        throw new Error(`failed to restore fixture Super Admin: HTTP ${restored.status}`);
      }
    }

    expect(
      await prisma.userBranchRole.count({
        where: {
          userId: superAdminId,
          deletedAt: null,
          branchId: null,
          role: { name: "super_admin" },
        },
      }),
    ).toBe(1);
  });

  it("refuses an unknown role and an unknown branch", async () => {
    const id = await makeUser("حالة خاطئة");
    await grant(id, "student", branchId);
    const unknownRole = await call(
      "PUT",
      `/admin/users/${id}/roles`,
      superAdmin,
      {
        assignments: [{ role: "headmistress", branch_id: null }],
      },
    );
    expect(unknownRole.status).toBe(400);

    const unknownBranch = await call(
      "PUT",
      `/admin/users/${id}/roles`,
      superAdmin,
      {
        assignments: [
          {
            role: "student",
            branch_id: "00000000-0000-4000-8000-000000000000",
          },
        ],
      },
    );
    expect(unknownBranch.status).toBe(404);
  });
});

describe("who may manage users at all", () => {
  it("refuses a Teacher every verb", async () => {
    const teacherId = await makeUser("أستاذة بلا صلاحية");
    await grant(teacherId, "teacher", branchId);
    const teacher = bearer(teacherId, [
      { role: "teacher", branches: [branchId] },
    ]);
    const target = await makeUser("هدف");
    await grant(target, "student", branchId);

    expect(
      (await call("PATCH", `/admin/users/${target}`, teacher, { version: 0 }))
        .status,
    ).toBe(403);
    expect(
      (
        await call("POST", `/admin/users/${target}/suspend`, teacher, {
          version: 0,
          reason: "x",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("PUT", `/admin/users/${target}/roles`, teacher, {
          assignments: [],
        })
      ).status,
    ).toBe(403);
  });

  it("refuses an anonymous caller with the TD-3.8 envelope", async () => {
    const res = await call("PATCH", `/admin/users/${superAdminId}`, undefined, {
      version: 0,
    });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_REQUIRED");
  });
});

/**
 * **R79 — beneficiary status is a durable fact, independent of every role.**
 *
 * ## What these prove that nothing else could
 *
 * Before R79 the enrolment selector offered every active account, because the
 * platform had no way to answer *is this person a beneficiary*. Each substitute
 * fails on one of the rows below, and that is why they are all here:
 *
 * * the **student role** fails on the minor, who holds none at all (§4.3), and
 *   on the مؤطرة who studies;
 * * an existing **enrolment** fails on the accepted-but-unplaced beneficiary,
 *   and would make enrolment the precondition for being enrollable;
 * * a **staff role** fails as an exclusion, because staff may be beneficiaries.
 */
describe("R79 — who the enrolment selector offers", () => {
  let beneficiaryNoRole: string;
  let staffOnly: string;
  let adminOnly: string;
  let guardianOnly: string;
  let staffAndBeneficiary: string;
  let unplacedBeneficiary: string;
  let levelId: string;
  let branchId: string;

  const offered = async (): Promise<string[]> => {
    const res = await call(
      "GET",
      "/admin/users?page_size=100&beneficiaries_only=true",
      superAdmin,
    );
    expect(res.status).toBe(200);
    return (res.body.data as unknown as Record<string, unknown>[]).map((u) =>
      String(u["id"]),
    );
  };

  beforeAll(async () => {
    beneficiaryNoRole = await makeUser(
      "قاصر مستفيدة",
      "active",
      "female",
      true,
    );
    staffOnly = await makeUser("مؤطرة فقط", "active", "female", false);
    adminOnly = await makeUser("مسؤولة فقط", "active", "female", false);
    guardianOnly = await makeUser("ولية أمر فقط", "active", "female", false);
    staffAndBeneficiary = await makeUser(
      "مؤطرة ودارسة",
      "active",
      "female",
      true,
    );
    unplacedBeneficiary = await makeUser(
      "مستفيدة بلا تسجيل",
      "active",
      "female",
      true,
    );
    await grant(staffOnly, "teacher", null);
    await grant(adminOnly, "admin", null);
    // The decisive pair: the SAME role, opposite beneficiary status.
    await grant(staffAndBeneficiary, "teacher", null);

    // Test J needs a placement to end. Created here rather than assumed from
    // another suite's fixtures: a test that borrows somebody else's rows fails
    // for reasons that have nothing to do with what it asserts.
    const category = await prisma.category.create({
      data: { name: `${TAG} فئة R79` },
    });
    levelId = (
      await prisma.level.create({
        data: {
          name: `${TAG} مستوى R79`,
          categoryId: category.id,
          genderRestriction: "any",
        },
      })
    ).id;
    branchId = (
      await prisma.branch.create({ data: { name: `${TAG} فرع R79` } })
    ).id;
  });

  it("A · a beneficiary with NO ROLE appears", async () => {
    expect(await offered()).toContain(beneficiaryNoRole);
  });

  it("B/C/D · staff-only, admin-only and guardian-only do NOT appear", async () => {
    const list = await offered();
    expect(list).not.toContain(staffOnly);
    expect(list).not.toContain(adminOnly);
    expect(list).not.toContain(guardianOnly);
  });

  it("E · staff WHO ARE ALSO beneficiaries DO appear", async () => {
    // She holds the same `teacher` role as the excluded one. No role
    // distinguishes them — only the durable fact does, which is the whole point.
    expect(await offered()).toContain(staffAndBeneficiary);
  });

  it("F · a beneficiary with ZERO enrolments appears", async () => {
    // The case that makes enrolment unusable as the definition: she has been
    // accepted and not yet placed.
    expect(
      await prisma.enrollment.count({
        where: { studentId: unplacedBeneficiary },
      }),
    ).toBe(0);
    expect(await offered()).toContain(unplacedBeneficiary);
  });

  it("J · ending every enrolment does NOT erase the fact", async () => {
    const enrolment = await prisma.enrollment.create({
      data: { studentId: beneficiaryNoRole, levelId, branchId },
    });
    await prisma.enrollment.update({
      where: { id: enrolment.id },
      data: { deletedAt: new Date() },
    });
    // R79.4 — durable. A beneficiary between placements is still a beneficiary.
    expect(await offered()).toContain(beneficiaryNoRole);
  });

  it("L · a StudentSocialProfile is NOT required for beneficiary identity", async () => {
    // §4.10's case file is created by staff later, and most beneficiaries never
    // have one. Requiring it would have hidden nearly everybody.
    const withProfile = await prisma.studentSocialProfile.count({
      where: { studentId: { in: [beneficiaryNoRole, unplacedBeneficiary] } },
    });
    expect(withProfile).toBe(0);
    const list = await offered();
    expect(list).toContain(beneficiaryNoRole);
    expect(list).toContain(unplacedBeneficiary);
  });

  it("offers everybody when the parameter is absent, so it narrows nothing by default", async () => {
    const res = await call(
      "GET",
      `/admin/users?page_size=100&q=${encodeURIComponent(TAG)}`,
      superAdmin,
    );
    const all = (res.body.data as unknown as Record<string, unknown>[]).map(
      (u) => String(u["id"]),
    );
    expect(all).toContain(staffOnly);
    expect(all).toContain(beneficiaryNoRole);
  });

  it("never publishes the flag on the contract", async () => {
    // R79.8 — `is_beneficiary` is a fact about a person's relationship with the
    // institute, and the screens that need it read it server-side.
    //
    // **`sex` was asserted here too and no longer is** (Owner, 2026-08-28). It
    // was bundled in under R80 point 6, which the Owner amended once R112 had
    // made this read Super-Admin-only: a Super Admin reads and edits everything
    // about an account. R79.8's own rule is untouched.
    const res = await call(
      "GET",
      `/admin/users?q=${encodeURIComponent(TAG)}`,
      superAdmin,
    );
    for (const row of res.body.data as unknown as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty("is_beneficiary");
    }
  });
});

/**
 * R88 — who **إدارة المؤطِّرات** lists.
 *
 * The teaching profile used to be a row action on the generic account screen,
 * which offered it to guardians, minors and administrators alike. Its own screen
 * needs an authoritative answer to *who may act as a مؤطِّرة*, and the answer is
 * a **live `teacher` assignment** — asked of this endpoint through the `role`
 * filter §14.2 already defines, so the page filters nothing client-side.
 *
 * The decisive case is the pair below: **`is_beneficiary` must play no part**.
 * R79 made it a durable fact independent of every role precisely so a مؤطِّرة may
 * also study; using it as an exclusion here would hide a real member of teaching
 * staff. `beneficiaries_only=true` selects the opposite population — the two
 * filters are complements, not variants, and this pins that.
 */
describe("R88 — who إدارة المؤطِّرات lists", () => {
  let teacherOnly: string;
  let teacherAndBeneficiary: string;
  let beneficiaryOnly: string;
  let guardianOnly: string;
  let adminOnly: string;

  const listed = async (): Promise<string[]> => {
    const res = await call(
      "GET",
      "/admin/users?page_size=100&role=teacher",
      superAdmin,
    );
    expect(res.status).toBe(200);
    return (res.body.data as unknown as Record<string, unknown>[]).map((u) =>
      String(u["id"]),
    );
  };

  beforeAll(async () => {
    // Its own rows: a test that borrows another suite's fixtures fails for
    // reasons that have nothing to do with what it asserts.
    teacherOnly = await makeUser("R88 مؤطرة", "active", "female", false);
    teacherAndBeneficiary = await makeUser(
      "R88 مؤطرة ودارسة",
      "active",
      "female",
      true,
    );
    beneficiaryOnly = await makeUser("R88 مستفيدة", "active", "female", true);
    guardianOnly = await makeUser("R88 ولية أمر", "active", "female", false);
    adminOnly = await makeUser("R88 مسؤولة", "active", "female", false);

    await grant(teacherOnly, "teacher", null);
    await grant(teacherAndBeneficiary, "teacher", null);
    await grant(beneficiaryOnly, "student", null);
    await grant(guardianOnly, "parent", null);
    await grant(adminOnly, "admin", null);
  });

  it("lists a مؤطِّرة", async () => {
    expect(await listed()).toContain(teacherOnly);
  });

  it("lists a مؤطِّرة WHO IS ALSO a beneficiary", async () => {
    // The whole reason the page must not exclude beneficiaries: she teaches.
    expect(await listed()).toContain(teacherAndBeneficiary);
  });

  it("omits beneficiary-only, guardian-only and admin-only accounts", async () => {
    const list = await listed();
    expect(list).not.toContain(beneficiaryOnly);
    expect(list).not.toContain(guardianOnly);
    expect(list).not.toContain(adminOnly);
  });

  it("selects the complement of beneficiaries_only, not a variant of it", async () => {
    const teaching = await listed();
    const res = await call(
      "GET",
      "/admin/users?page_size=100&beneficiaries_only=true",
      superAdmin,
    );
    const beneficiaries = (
      res.body.data as unknown as Record<string, unknown>[]
    ).map((u) => String(u["id"]));

    // She is in BOTH lists. Neither filter is derivable from the other, which
    // is why neither screen may be built from the other's population.
    expect(teaching).toContain(teacherAndBeneficiary);
    expect(beneficiaries).toContain(teacherAndBeneficiary);
    expect(teaching).not.toContain(beneficiaryOnly);
    expect(beneficiaries).not.toContain(teacherOnly);
  });

  it("survives a revoked role — the list follows LIVE assignments", async () => {
    const spare = await makeUser("R88 مؤطرة سابقة", "active", "female", false);
    await grant(spare, "teacher", null);
    expect(await listed()).toContain(spare);
    await prisma.userBranchRole.updateMany({
      where: { userId: spare },
      data: { deletedAt: new Date() },
    });
    // A مؤطِّرة who has stopped teaching leaves the planning screen; her profile
    // rows are untouched, because history is not rewritten by a role change.
    expect(await listed()).not.toContain(spare);
  });
});

/* ── Account administration is Super Admin's (Owner, 2026-08-28) ─────────── */

/**
 * **The separation, proved at the API boundary.**
 *
 * The Owner's clarification splits two things that used to share one endpoint
 * and one role list:
 *
 * * **global ACCOUNT administration** — every person, their address, their
 *   status, their roles, and the power to delete the account. Super Admin's.
 * * **picking a person while doing operational work** — staffing, enrolling,
 *   rostering. An Admin's, and not account administration at all.
 *
 * These are HTTP assertions on purpose. *"Do not rely on hiding the page in the
 * frontend; enforce it server-side"* is the instruction, and a menu test cannot
 * show that a forged request is refused — only a forged request can.
 */
describe("account administration is Super Admin's, the directory is not", () => {
  it("keeps pending/rejected requests out of both operational populations", async () => {
    const pending = await makeUser("طلب قيد المراجعة", "pending");
    const rejected = await makeUser("طلب مرفوض", "rejected");
    const active = await makeUser("حساب مقبول", "active");

    const accounts = await call("GET", "/admin/users?page_size=100", superAdmin);
    expect(accounts.status).toBe(200);
    const accountIds = (accounts.body.data as unknown as { id: string }[]).map((row) => row.id);
    expect(accountIds).toContain(active);
    expect(accountIds).not.toContain(pending);
    expect(accountIds).not.toContain(rejected);

    const directory = await call("GET", "/admin/directory?page_size=100", superAdmin);
    expect(directory.status).toBe(200);
    const directoryIds = (directory.body.data as unknown as { id: string }[]).map(
      (row) => row.id,
    );
    expect(directoryIds).toContain(active);
    expect(directoryIds).not.toContain(pending);
    expect(directoryIds).not.toContain(rejected);

    const forgedPendingFilter = await call("GET", "/admin/users?status=pending", superAdmin);
    expect(forgedPendingFilter.status).toBe(400);
    expect(forgedPendingFilter.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a branch Admin the global account list", async () => {
    const res = await call("GET", "/admin/users", branchAdmin);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a branch Admin every account WRITE, not only the list", async () => {
    // A read-only refusal would leave the dangerous half reachable.
    const target = await makeUser("هدف الإدارة", "active", "female", false);
    const writes: [string, string, Record<string, unknown> | undefined][] = [
      ["PATCH", `/admin/users/${target}`, { version: 0, nickname: "س" }],
      ["POST", `/admin/users/${target}/suspend`, { version: 0, reason: "اختبار" }],
      ["POST", `/admin/users/${target}/reactivate`, { version: 0 }],
      ["PUT", `/admin/users/${target}/roles`, { assignments: [] }],
      ["POST", "/admin/users", { email: "x@example.com", name_arabic: "س", sex: "female" }],
    ];
    for (const [method, path, body] of writes) {
      const res = await call(method, path, branchAdmin, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("still lets that Admin reach the operational directory", async () => {
    // The point of the split: a screen that needs to pick a person keeps
    // working. Withdrawing the account page must not withdraw an Admin's work.
    const res = await call("GET", "/admin/directory", branchAdmin);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("sends the directory NO account fields — the projection is the rule", async () => {
    /**
     * The reason the split is two endpoints rather than one with a relaxed role:
     * an Admin rendering a list of names has no use for an address, a phone, an
     * account status or a TD-15 `version`, and five screens were receiving all
     * four. Asserted as an exact key set so a field added to the account
     * projection cannot arrive here unnoticed.
     */
    const res = await call("GET", "/admin/directory?page_size=1", superAdmin);
    expect(res.status).toBe(200);
    const row = (res.body.data as unknown as Record<string, unknown>[])[0];
    if (!row) throw new Error("the directory returned no rows to inspect");
    // The parts joined 2026-08-28: §14.2's tables show الاسم الشخصي and
    // الاسم العائلي separately, and the parts ARE the composed name — they
    // disclose nothing it does not.
    expect(Object.keys(row).sort()).toEqual([
      "first_name_arabic",
      "id",
      "last_name_arabic",
      "name_arabic",
      "nickname",
      "roles",
    ]);
  });

  it("does not widen what a branch-scoped Admin may see", async () => {
    // The projection is narrower; the SCOPE rule is identical. A picker that
    // reached outside its branches would be a worse leak than the fields it no
    // longer carries.
    const res = await call("GET", "/admin/directory?page_size=100", branchAdmin);
    expect(res.status).toBe(200);
    const ids = (res.body.data as unknown as Record<string, unknown>[]).map((u) => String(u["id"]));
    const outsider = await makeUser("خارج النطاق", "active", "female", false);
    const after = await call("GET", "/admin/directory?page_size=100", branchAdmin);
    const idsAfter = (after.body.data as unknown as Record<string, unknown>[]).map((u) =>
      String(u["id"]),
    );
    // Unassigned to any branch, so invisible to a branch-scoped Admin — the
    // same rule `listUsers` applies, reached through the shared query.
    expect(ids).not.toContain(outsider);
    expect(idsAfter).not.toContain(outsider);
  });
});

/* ── R111 account deletion (Owner decisions, 2026-08-27/28) ──────────────── */

/**
 * **Deleting an account, proved at the API boundary.**
 *
 * The property that matters most is not that the row goes — it is that **it does
 * not**, and that everything filed against it survives. R111 §2: twenty-six of
 * the thirty-five relationships referencing `"user"` must outlive the account,
 * so deletion is the de-identification of a row that continues to exist.
 */
describe("R111 — deleting an account keeps the record", () => {
  it("lets ANY authenticated user delete their own account", async () => {
    // Owner, 2026-08-28: Student, Teacher, Admin and Super Admin alike. A role
    // is never a reason to be unable to leave.
    const id = await makeUser("مغادرة بنفسها", "active", "female", false);
    await grant(id, "student", branchId);
    const token = bearer(id, [{ role: "student", branches: [branchId] }]);

    const res = await call("DELETE", "/profile", token);
    expect(res.status).toBe(204);

    const after = await prisma.user.findUnique({ where: { id } });
    // **The row is still there.** That is the whole design, not an implementation
    // detail: twenty-six relationships point at it.
    expect(after).not.toBeNull();
    /**
     * **`deleted_at`, not a fifth `account_status` value.** The schema records
     * that decision at the enum itself — TD-1's Deleted state is
     * `deleted_at IS NOT NULL`, so a soft-deleted user has one source of truth
     * rather than two that can disagree. A `deleted` status was drafted here and
     * reverted; this asserts the rule that actually holds.
     */
    expect(after?.deletedAt).not.toBeNull();
  });

  it("files the account on a THREE-day window, leaving BR-15's ninety alone", async () => {
    const id = await makeUser("نافذة ثلاثة أيام", "active", "female", false);
    await grant(id, "student", branchId);
    await call("DELETE", "/profile", bearer(id, [{ role: "student", branches: [branchId] }]));

    const row = await prisma.trash.findFirst({
      where: { targetEntity: "User", targetId: id },
      orderBy: { deletedAt: "desc" },
    });
    if (!row) throw new Error("no Trash row was written for the deleted account");
    const days = Math.round(
      (row.purgeAfter.getTime() - row.deletedAt.getTime()) / 86_400_000,
    );
    // Three, and NOT ninety. A second window for one entity type; merging the
    // two would silently move one of them.
    expect(days).toBe(3);
  });

  it("can restore the SAME complete account during the three-day window", async () => {
    const id = await makeUser("قابلة للاسترجاع", "active", "female", true);
    await grant(id, "student", branchId);
    const email = `restore-${id}@example.test`;
    createdEmails.push(email);
    await prisma.normalizedEmailLock.createMany({ data: [{ email }], skipDuplicates: true });
    await prisma.userIdentity.create({
      data: {
        userId: id,
        provider: "google",
        providerSubjectId: `restore-${id}`,
        email,
      },
    });

    await call("DELETE", "/profile", bearer(id, [{ role: "student", branches: [branchId] }]));
    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: "User", targetId: id },
    });

    const restored = await call("POST", `/admin/trash/${entry.id}/restore`, superAdmin);
    expect(restored.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(after.deletedAt).toBeNull();
    expect(after.nameArabic).toContain("قابلة للاسترجاع");
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(1);
    expect(await prisma.userBranchRole.count({ where: { userId: id } })).toBe(1);
    expect(await prisma.trash.count({ where: { id: entry.id } })).toBe(0);
  });

  it("signs the person out at once — not when the window expires", async () => {
    const id = await makeUser("مسجَّلة الخروج", "active", "female", false);
    await grant(id, "student", branchId);
    const token = bearer(id, [{ role: "student", branches: [branchId] }]);
    expect((await call("GET", "/profile", token)).status).toBe(200);

    await call("DELETE", "/profile", token);
    // TD-12 freshness: the token is still cryptographically valid and the
    // account is not. **Locked out is the property**; whether 401 or 403 says so
    // depends on which of the session lookup and the freshness check refuses
    // first, and pinning one would pin an ordering this test does not care
    // about. What must never happen is a 200.
    const locked = await call("GET", "/profile", token);
    expect([401, 403]).toContain(locked.status);
  });

  it("REFUSES the last active Super Admin, naming why", async () => {
    // The platform's existing LAST_SUPER_ADMIN guard, applied to deletion.
    // Revision 22's lockout recovery needs DATABASE_URL and a manual seed run —
    // a sanctioned recovery, not something one click may produce.
    const others = await prisma.user.count({
      where: {
        id: { not: superAdminId },
        accountStatus: "active",
        deletedAt: null,
        branchRoles: { some: { deletedAt: null, role: { name: "super_admin" } } },
      },
    });
    if (others > 0) return; // another Super Admin exists; this case cannot arise

    const res = await call("DELETE", "/profile", superAdmin);
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("LAST_SUPER_ADMIN");

    const after = await prisma.user.findUnique({ where: { id: superAdminId } });
    expect(after?.deletedAt).toBeNull();
  });

  it("uses one database row to serialize platform-wide last-Super-Admin checks", async () => {
    /**
     * Locking only the target User cannot protect a platform-wide count: two
     * different administrators mean two different User rows. Prove that the
     * shared Role row really conflicts in PostgreSQL rather than accepting a
     * comment or a mocked repository call as evidence.
     */
    const holderClient = createPrismaClient(config.DATABASE_URL, 1);
    const contenderClient = createPrismaClient(config.DATABASE_URL, 1);
    const held = deferred();
    const release = deferred();
    let holder: Promise<void> | undefined;

    try {
      holder = holderClient.$transaction(async (tx) => {
        expect(await userRepository.lockRole(tx, "super_admin")).toBe(true);
        held.resolve();
        await release.promise;
      });
      await held.promise;

      await expect(
        contenderClient.$transaction(async (tx) => {
          // Static test-only SQL: fail promptly instead of making a timing
          // assertion about how long a blocked lock should wait.
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
          await userRepository.lockRole(tx, "super_admin");
        }),
      ).rejects.toThrow();

      release.resolve();
      await holder;

      await contenderClient.$transaction(async (tx) => {
        expect(await userRepository.lockRole(tx, "super_admin")).toBe(true);
      });
    } finally {
      release.resolve();
      await holder?.catch(() => undefined);
      await Promise.allSettled([
        holderClient.$disconnect(),
        contenderClient.$disconnect(),
      ]);
    }
  });

  it("BLOCKS a مؤطِّرة with a live class, and names what to reassign", async () => {
    const teacher = await makeUser("مؤطرة بحصص", "active", "female", false);
    await grant(teacher, "teacher", branchId);
    const schedule = await liveScheduleStaffedBy(teacher);

    const res = await call(
      "DELETE",
      "/profile",
      bearer(teacher, [{ role: "teacher", branches: [branchId] }]),
    );
    expect(res.status).toBe(409);
    expect(res.body.error?.details?.["reason"]).toBe("RESPONSIBILITIES_ASSIGNED");
    // The refusal NAMES what must move — the Owner chose explanation over
    // reassigning in the same action.
    expect(res.body.error?.details?.["blocked_by"]).toMatchObject({
      course_schedules: 1,
    });

    const after = await prisma.user.findUnique({ where: { id: teacher } });
    expect(after?.deletedAt).toBeNull();

    // ...and it succeeds once the responsibility is gone. A block that could not
    // be cleared would be a refusal wearing a block's clothes.
    await prisma.courseScheduleStaff.updateMany({
      where: { scheduleId: schedule, userId: teacher },
      data: { deletedAt: new Date() },
    });
    const retry = await call(
      "DELETE",
      "/profile",
      bearer(teacher, [{ role: "teacher", branches: [branchId] }]),
    );
    expect(retry.status).toBe(204);
  });

  it("does not call an ended effective-dated assignment a live responsibility", async () => {
    const teacher = await makeUser("مؤطرة انتهى تكليفها", "active", "female", false);
    await grant(teacher, "teacher", branchId);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await liveScheduleStaffedBy(teacher, {
      scheduleUntil: yesterday,
      staffUntil: yesterday,
    });

    const res = await call(
      "DELETE",
      "/profile",
      bearer(teacher, [{ role: "teacher", branches: [branchId] }]),
    );
    expect(res.status).toBe(204);
  });

  it("uses Event.start_date: future responsibility blocks and past history survives", async () => {
    const futureOwner = await makeUser("مسؤولة نشاط قادم", "active", "female", false);
    await grant(futureOwner, "teacher", branchId);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const futureEvent = await responsibleForEvent(futureOwner, tomorrow);

    const blocked = await call(
      "DELETE",
      "/profile",
      bearer(futureOwner, [{ role: "teacher", branches: [branchId] }]),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.details?.["blocked_by"]).toMatchObject({
      responsible_for_events: 1,
    });

    await prisma.eventStaff.updateMany({
      where: { eventId: futureEvent, userId: futureOwner },
      data: { deletedAt: new Date() },
    });
    expect(
      (
        await call(
          "DELETE",
          "/profile",
          bearer(futureOwner, [{ role: "teacher", branches: [branchId] }]),
        )
      ).status,
    ).toBe(204);

    const pastOwner = await makeUser("مسؤولة نشاط سابق", "active", "female", false);
    await grant(pastOwner, "teacher", branchId);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const pastEvent = await responsibleForEvent(pastOwner, yesterday);
    expect(
      (
        await call(
          "DELETE",
          "/profile",
          bearer(pastOwner, [{ role: "teacher", branches: [branchId] }]),
        )
      ).status,
    ).toBe(204);
    expect(
      await prisma.eventStaff.count({ where: { eventId: pastEvent, userId: pastOwner } }),
    ).toBe(1);
  });

  it("serializes a future staffing assignment against account deletion", async () => {
    const victim = await makeUser("سباق التكليف والحذف", "active", "female", false);
    await grant(victim, "teacher", branchId);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const event = await prisma.event.create({
      data: {
        title: `${TAG} سباق مسؤولية`,
        visibility: "hidden",
        startDate: tomorrow,
        recurrenceType: "none",
      },
    });
    const bothAtBoundary = deferred();
    let arrivals = 0;
    const realLock = userRepository.lockUser;
    const lock = vi.spyOn(userRepository, "lockUser").mockImplementation(async (tx, id) => {
      if (id === victim && arrivals < 2) {
        arrivals += 1;
        if (arrivals === 2) bothAtBoundary.resolve();
        await bothAtBoundary.promise;
      }
      return realLock(tx, id);
    });

    try {
      const outcomes = await Promise.allSettled([
        deleteOwnAccount(prisma, {
          userId: victim,
          activeRole: "teacher",
        }),
        setEventStaff(
          prisma,
          {
            userId: superAdminId,
            roles: ["super_admin"],
            roleScopes: [{ role: "super_admin", branches: null }],
            accountStatus: "active",
            activeRole: "super_admin",
          } as never,
          event.id,
          [{ userId: victim, position: "responsible" }],
        ),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: victim } });
      const liveStaff = await prisma.eventStaff.count({
        where: { eventId: event.id, userId: victim, deletedAt: null },
      });
      // Both valid serial orders converge on one of these states. The forbidden
      // state — deleted with a live future responsibility — is unreachable.
      expect(
        (user.deletedAt !== null && liveStaff === 0) ||
          (user.deletedAt === null && liveStaff === 1),
      ).toBe(true);
    } finally {
      lock.mockRestore();
    }
  });

  it("refuses a branch Admin the deletion of somebody else's account", async () => {
    const victim = await makeUser("هدف الحذف", "active", "female", false);
    const res = await call("DELETE", `/admin/users/${victim}`, branchAdmin);
    expect(res.status).toBe(403);
    const after = await prisma.user.findUnique({ where: { id: victim } });
    expect(after?.deletedAt).toBeNull();
  });

  it("lets a Super Admin delete another account, on the SAME 3-day window", async () => {
    const victim = await makeUser("محذوفة إدارياً", "active", "female", false);
    const res = await call("DELETE", `/admin/users/${victim}`, superAdmin);
    expect(res.status).toBe(204);

    const row = await prisma.trash.findFirst({
      where: { targetEntity: "User", targetId: victim },
      orderBy: { deletedAt: "desc" },
    });
    const days = Math.round(
      ((row?.purgeAfter.getTime() ?? 0) - (row?.deletedAt.getTime() ?? 0)) / 86_400_000,
    );
    expect(days).toBe(3);
  });

  it("permanent delete DE-IDENTIFIES and preserves — it removes no row", async () => {
    /**
     * The assertion this whole design exists for. A safeguarding relationship
     * is filed against the account; after a permanent delete the person is
     * unidentifiable and the relationship still points at the same tombstone.
     */
    const victim = await makeUser("محذوفة نهائياً", "active", "female", false);
    const parent = await makeUser("ولي سجل محفوظ", "active", "female", false);
    const email = `erase-${victim}@example.test`;
    const intendedCategory = await prisma.category.findFirstOrThrow({});
    createdEmails.push(email);
    await prisma.user.update({
      where: { id: victim },
      data: {
        firstNameArabic: "اسم شخصي سري",
        lastNameArabic: "اسم عائلي سري",
        nameFrench: "Nom Secret",
        firstNameFrench: "Nom",
        lastNameFrench: "Secret",
        nickname: "كنية سرية",
        publicDisplayName: "اسم منشور قديم",
        phone: "0600000000",
        notes: "ملاحظة شخصية سرية",
        referenceCode: "BA-TEST2",
        schoolingStage: "post_secondary",
        intendedBranchId: branchId,
        intendedCategoryId: intendedCategory.id,
        requestedRole: "teacher",
        preProvisionedEmail: email,
      },
    });
    await grant(victim, "student", branchId);
    await prisma.normalizedEmailLock.createMany({ data: [{ email }], skipDuplicates: true });
    await prisma.userIdentity.create({
      data: {
        userId: victim,
        provider: "google",
        providerSubjectId: `erase-${victim}`,
        email,
      },
    });
    await issueNewSession(prisma, victim);
    await prisma.rateLimitCounter.create({
      data: { userId: victim, bucket: "upload.initiate", windowStart: new Date(0), count: 1 },
    });
    const familyLink = await prisma.familyLink.create({
      data: { parentId: parent, studentId: victim, status: "approved", relationshipType: "mother" },
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: victim } });

    const res = await call("DELETE", `/admin/users/${victim}?permanent=true`, superAdmin);
    expect(res.status).toBe(204);

    const after = await prisma.user.findUnique({ where: { id: victim } });
    expect(after).not.toBeNull();
    expect(after?.nameArabic).toBe("حساب محذوف");
    for (const value of [
      after?.firstNameArabic,
      after?.lastNameArabic,
      after?.nameFrench,
      after?.firstNameFrench,
      after?.lastNameFrench,
      after?.nickname,
      after?.publicDisplayName,
      after?.phone,
      after?.notes,
      after?.referenceCode,
      after?.schoolingStage,
      after?.intendedBranchId,
      after?.intendedCategoryId,
      after?.requestedRole,
      after?.preProvisionedEmail,
    ]) {
      expect(value).toBeNull();
    }
    expect(after?.qrRef).not.toBe(before.qrRef);
    /**
     * **The TD-10 search shadows no longer carry the original.**
     *
     * This is the one place the omission would show on no screen: a cleared
     * `name_arabic` beside a populated `name_arabic_normalized` leaves the person
     * findable by search. They are trigger-maintained
     * (`user_search_shadow_sync_trigger`), so the assertion is not that they are
     * null — they track the marker — but that **the original name is gone from
     * them**, which is what a search would otherwise find.
     */
    expect(after?.nameArabicNormalized ?? "").not.toContain("محذوفة نهائياً");
    expect(after?.phoneNormalized ?? "").toBe("");
    // Structural columns survive: §4.4b evaluates Level restrictions against
    // `sex`, so a preserved enrolment must still make sense.
    expect(after?.sex).toBe(before.sex);
    expect(after?.createdAt.getTime()).toBe(before.createdAt.getTime());
    // Credentials are gone, which is what lets the identity register again.
    expect(await prisma.userIdentity.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.userBranchRole.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.rateLimitCounter.count({ where: { userId: victim } })).toBe(0);
    // The stable lock carries no owner and remains to serialize the next
    // claimant. The two ownership channels above are what release the address.
    expect(await prisma.normalizedEmailLock.count({ where: { email } })).toBe(1);
    const reclaimed = await call("POST", "/admin/users", superAdmin, {
      name_arabic: `${TAG} صاحبة بريد جديد`,
      email,
      sex: "female",
    });
    expect(reclaimed.status).toBe(201);
    // Safeguarding/history survives and still points at the tombstone.
    expect(await prisma.familyLink.count({ where: { id: familyLink.id } })).toBe(1);
    // The recoverable snapshot held the original PII. It must disappear in the
    // same transaction as de-identification or the erasure is only cosmetic.
    expect(
      await prisma.trash.count({ where: { targetEntity: "User", targetId: victim } }),
    ).toBe(0);
  });

  it("is idempotent — running the permanent delete twice changes nothing", async () => {
    // The purge job must be safe to execute twice: a de-identification that
    // half-ran is worse than one that has not run.
    const victim = await makeUser("مكرَّرة", "active", "female", false);
    await call("DELETE", `/admin/users/${victim}?permanent=true`, superAdmin);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: victim } });
    const firstAudits = await prisma.auditLog.count({
      where: { actionType: "user.deidentify", targetId: victim },
    });
    const res = await call("DELETE", `/admin/users/${victim}?permanent=true`, superAdmin);
    expect(res.status).toBe(204);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: victim } });
    expect(second.nameArabic).toBe(first.nameArabic);
    expect(second.accountStatus).toBe(first.accountStatus);
    expect(second.qrRef).toBe(first.qrRef);
    expect(
      await prisma.auditLog.count({
        where: { actionType: "user.deidentify", targetId: victim },
      }),
    ).toBe(firstAudits);
  });

  it("rotates the QR even when the person's real name already equals the tombstone label", async () => {
    const row = await prisma.user.create({
      data: {
        nameArabic: DELETED_ACCOUNT_NAME,
        sex: "female",
        accountStatus: "active",
      },
    });
    createdUserIds.push(row.id);

    const res = await call(
      "DELETE",
      `/admin/users/${row.id}?permanent=true`,
      superAdmin,
    );
    expect(res.status).toBe(204);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: row.id } })).qrRef,
    ).not.toBe(row.qrRef);
  });

  it("a purge that loses to Trash restoration refuses instead of erasing the restored account", async () => {
    const victim = await makeUser("سباق الاسترجاع", "active", "female", false);
    await call("DELETE", `/admin/users/${victim}`, superAdmin);
    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: "User", targetId: victim },
      orderBy: { deletedAt: "desc" },
    });
    const reachedUserLock = deferred();
    const allowPurgeToContinue = deferred();
    const realLock = userRepository.lockUser;
    const lock = vi.spyOn(userRepository, "lockUser").mockImplementation(
      async (tx, id) => {
        if (id === victim) {
          reachedUserLock.resolve();
          await allowPurgeToContinue.promise;
        }
        return realLock(tx, id);
      },
    );

    try {
      const purge = deIdentifyAccount(
        prisma,
        { userId: superAdminId, activeRole: "super_admin" },
        victim,
      );
      await reachedUserLock.promise;
      await restoreEntry(prisma, await actorFor(prisma, superAdminId), entry.id);
      allowPurgeToContinue.resolve();

      await expect(purge).rejects.toMatchObject({
        code: "STATE_CONFLICT",
        details: { reason: "NOT_DELETED" },
      });
      const restored = await prisma.user.findUniqueOrThrow({
        where: { id: victim },
      });
      expect(restored.deletedAt).toBeNull();
      expect(restored.nameArabic).toContain("سباق الاسترجاع");
    } finally {
      allowPurgeToContinue.resolve();
      lock.mockRestore();
    }
  });

  it("serializes teaching-profile writes against final de-identification", async () => {
    const victim = await makeUser("سباق ملف التخطيط", "active", "female", false);
    const boundary = deferred();
    let arrivals = 0;
    const realLock = userRepository.lockUser;
    const lock = vi.spyOn(userRepository, "lockUser").mockImplementation(async (tx, id) => {
      if (id === victim && arrivals < 2) {
        arrivals += 1;
        if (arrivals === 2) boundary.resolve();
        await boundary.promise;
      }
      return realLock(tx, id);
    });

    try {
      const [purge] = await Promise.allSettled([
        purgeUserAccount(
          prisma,
          { userId: superAdminId, activeRole: "super_admin" },
          victim,
        ),
        replaceTeachingProfile(
          prisma,
          await actorFor(prisma, superAdminId),
          victim,
          {
            subjectIds: [],
            categoryIds: [],
            availability: [{ weekday: "monday", startTime: "09:00", endTime: "10:00" }],
          },
        ),
      ]);
      expect(purge.status).toBe("fulfilled");
      expect(
        await prisma.teacherAvailability.count({ where: { userId: victim } }),
      ).toBe(0);
    } finally {
      boundary.resolve();
      lock.mockRestore();
    }
  });

  it("serializes safeguarding-profile writes against final de-identification", async () => {
    const victim = await makeUser("سباق ملف اجتماعي", "active", "female", true);
    const boundary = deferred();
    let arrivals = 0;
    const realLock = userRepository.lockUser;
    const lock = vi.spyOn(userRepository, "lockUser").mockImplementation(async (tx, id) => {
      if (id === victim && arrivals < 2) {
        arrivals += 1;
        if (arrivals === 2) boundary.resolve();
        await boundary.promise;
      }
      return realLock(tx, id);
    });

    try {
      const [purge] = await Promise.allSettled([
        purgeUserAccount(
          prisma,
          { userId: superAdminId, activeRole: "super_admin" },
          victim,
        ),
        writeProfile(prisma, await actorFor(prisma, superAdminId), victim, {
          healthCondition: "بيانات يجب ألا تعود",
        }),
      ]);
      expect(purge.status).toBe("fulfilled");
      expect(
        await prisma.studentSocialProfile.count({ where: { studentId: victim } }),
      ).toBe(0);
    } finally {
      boundary.resolve();
      lock.mockRestore();
    }
  });

  it("serializes notification delivery against final de-identification", async () => {
    const victim = await makeUser("سباق صندوق الإشعار", "active", "female", false);
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط إشعار قديم`,
        visibility: "public",
        startDate: new Date("2025-01-01T00:00:00.000Z"),
        recurrenceType: "none",
      },
    });
    // The production writer intentionally refuses to announce an assignment
    // that is not present on the Event. Materialize that governing row before
    // racing notification delivery against de-identification.
    await prisma.eventStaff.create({
      data: { eventId: event.id, userId: victim, position: "responsible" },
    });
    const boundary = deferred();
    let arrivals = 0;
    const realLock = userRepository.lockUser;
    const lock = vi.spyOn(userRepository, "lockUser").mockImplementation(async (tx, id) => {
      if (id === victim && arrivals < 2) {
        arrivals += 1;
        if (arrivals === 2) boundary.resolve();
        await boundary.promise;
      }
      return realLock(tx, id);
    });

    try {
      const [purge] = await Promise.allSettled([
        purgeUserAccount(
          prisma,
          { userId: superAdminId, activeRole: "super_admin" },
          victim,
        ),
        prisma.$transaction((tx) =>
          notifyEventStaffAssigned(tx, event.id, [victim], superAdminId),
        ),
      ]);
      expect(purge.status).toBe("fulfilled");
      expect(await prisma.notification.count({ where: { userId: victim } })).toBe(0);
    } finally {
      boundary.resolve();
      lock.mockRestore();
    }
  });

  it("serializes upload capabilities and quota satellites against final de-identification", async () => {
    const victim = await makeUser("سباق صلاحية الرفع", "active", "female", false);
    await grant(victim, "admin", branchId);
    const curriculum = await prisma.levelSubject.findFirstOrThrow({
      where: { level: { deletedAt: null }, subject: { deletedAt: null } },
      select: { levelId: true, subjectId: true },
    });
    const year = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });
    const boundary = deferred();
    let arrivals = 0;
    const realLock = userRepository.lockUser;
    const lock = vi.spyOn(userRepository, "lockUser").mockImplementation(async (tx, id) => {
      if (id === victim && arrivals < 2) {
        arrivals += 1;
        if (arrivals === 2) boundary.resolve();
        await boundary.promise;
      }
      return realLock(tx, id);
    });

    try {
      const [purge] = await Promise.allSettled([
        purgeUserAccount(
          prisma,
          { userId: superAdminId, activeRole: "super_admin" },
          victim,
        ),
        initiateUpload(
          prisma,
          createStorageClients(config),
          config.JWT_SIGNING_KEY,
          {
            userId: victim,
            roles: ["admin"],
            roleScopes: [{ role: "admin", branches: [branchId] }],
            accountStatus: "active",
            activeRole: "admin",
          } as never,
          {
            filename: "r111-race.pdf",
            size: 64,
            mime: "application/pdf",
            meta: {
              levelId: curriculum.levelId,
              subjectId: curriculum.subjectId,
              academicYearId: year.id,
              branchId,
            },
          },
        ),
      ]);
      expect(purge.status).toBe("fulfilled");
      expect(await prisma.rateLimitCounter.count({ where: { userId: victim } })).toBe(0);
    } finally {
      boundary.resolve();
      lock.mockRestore();
    }
  });
});

/* ── A role's scope is editable (Owner, 2026-08-28) ──────────────────────── */

describe("an assigned role's scope can be narrowed and widened", () => {
  it("moves a scope while keeping the previous assignment as history", async () => {
    /**
     * The scope rendered as text with only a Delete beside it, so narrowing or
     * widening meant removing the role and adding it back — which loses the
     * assignment's history for a change that is not a revocation.
     *
     * One role still carries one scope: the move revokes the old row and grants
     * the new one, so *«who taught at this branch in March»* stays answerable.
     */
    const id = await makeUser("أستاذة يتغير نطاقها");
    await grant(id, "teacher", branchId);

    // Narrow → the other branch.
    const moved = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "teacher", branch_id: otherBranchId }],
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data!["roles"]).toEqual([
      { role: "teacher", branch_id: otherBranchId, branch_name: `${TAG} فرع آخر` },
    ]);
    expect(
      await prisma.userBranchRole.count({
        where: { userId: id, branchId, deletedAt: { not: null } },
      }),
    ).toBe(1);

    // Widen → all branches. `null` is every branch (§7 R24), never none.
    const widened = await call("PUT", `/admin/users/${id}/roles`, superAdmin, {
      assignments: [{ role: "teacher", branch_id: null }],
    });
    expect(widened.status).toBe(200);
    expect(widened.body.data!["roles"]).toEqual([
      { role: "teacher", branch_id: null, branch_name: null },
    ]);

    // Exactly one live assignment throughout — the index and the rule agree.
    expect(
      await prisma.userBranchRole.count({ where: { userId: id, deletedAt: null } }),
    ).toBe(1);
    // ...and every earlier scope survives as a tombstone.
    expect(
      await prisma.userBranchRole.count({ where: { userId: id, deletedAt: { not: null } } }),
    ).toBe(2);
  });
});
