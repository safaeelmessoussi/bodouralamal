import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from '../test-support/consumed-tokens.js';
import { registrationSchema } from "../validators/registration.validators.js";
import { register } from "./registration.service.js";
import {
  deleteTestConsentText,
  installTestConsentText,
  removeTestConsentText,
  type InstalledConsentText,
} from '../test-support/legal-consent-text.js';
import type { RegistrationInput } from "../validators/registration.validators.js";

/**
 * Unified registration (SRS §4.1, §4.1b step 5, TD-4.1) against the real
 * database — atomicity and the replay guard are enforced by transactions and a
 * unique constraint, so a mocked client would prove nothing.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const suiteTokens = ownedOnboardingTokens();
const issueOnboardingToken = suiteTokens.issue;
/**
 * Restored in `afterAll` — a fixture must not leave the app unrunnable.
 *
 * Captured ONCE. A `beforeEach` capture would re-save whatever the previous
 * test left behind, so by the end the suite would "restore" its own scratch
 * value rather than the developer's.
 */
let consentText: InstalledConsentText | null = null;
const KEY = config.ONBOARDING_TOKEN_KEY;
const TAG = "[reg-test]";
/** Deliberately not a prefix-extension of `TAG` — `clear()` sweeps by prefix,
 *  and a placement caught by it would be deleted before its group. */
const PLACEMENT_TAG = "[reg-test-place]";
const TEXT_VERSION = "reg-test-v1";

let counter = 0;
function identity() {
  counter += 1;
  return {
    email: `reg-${Date.now()}-${counter}@example.com`,
    providerSubjectId: `sub-${Date.now()}-${counter}`,
  };
}

/** The branch this suite's applicants choose (§4.1, Revision 39). */
let branchId = "";
/** Revision 49 — the applicant's educational stage travels with every
 *  registration, so the fixture provides one. */
let categoryId = "";

/** Typed as the parent_child variant, so a test can reach `children`. */
const parentChild = (): Extract<
  RegistrationInput,
  { kind: "parent_child" }
> => ({
  kind: "parent_child",
  parent: {
    first_name_arabic: `${TAG}`,
    last_name_arabic: `والدة`,
    phone: "+212 600 000 001",
    sex: "female" as const,
  },
  children: [
    {
      first_name_arabic: `${TAG}`,
      last_name_arabic: `طفلة`,
      sex: "female" as const,
      consent_media_release: true,
      requested_branch_id: branchId,
      requested_category_id: categoryId,
    },
  ],
  consents: { data_processing: true, consent_text_id: consentText!.id },
});

/**
 * Approves the first application of a request and returns the child it created.
 *
 * **R62 moved several of this suite's properties rather than deleting them.**
 * Name composition, sex, the login-less rule and the child's consent records all
 * still hold — they simply become true at APPROVAL, because the child `User`
 * does not exist until then. Asserting them here is what keeps the coverage
 * honest instead of dropping the assertions with the shape that carried them.
 */
async function approveFirstChild(applicationId: string): Promise<string> {
  // R64.5 — an approved child must be placed (§4.1). Provisioned here rather
  // than in `beforeEach` because only the approving tests need it.
  const { provisionPlacement } = await import("../test-support/placement.js");
  const placement = await provisionPlacement(prisma, PLACEMENT_TAG);
  const role = await prisma.role.findUnique({ where: { name: "admin" } });
  const admin = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} مسؤولة`,
      accountStatus: "active",
    },
  });
  await prisma.userBranchRole.create({
    data: { userId: admin.id, roleId: role!.id, branchId: null },
  });
  const { decideChildApplication } =
    await import("./child-application.service.js");
  const { actorFor } = await import("../test-support/actor.js");
  const result = await decideChildApplication(
    prisma,
    await actorFor(prisma, admin.id),
    applicationId,
    { approve: true, placement: { administrativeGroupId: placement.groupId } },
  );
  return result.childUserId!;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
  });
  // R62 — the approval helper creates an admin (with a role row) and a child,
  // and applications reference all three under RESTRICT. Sweeping only what the
  // registration itself wrote leaves the teardown blocked.
  await prisma.childApplication.deleteMany({
    where: {
      OR: [
        { parentId: { in: ids } },
        { childUserId: { in: ids } },
        { decidedById: { in: ids } },
      ],
    },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({
    where: {
      OR: [{ studentId: { in: ids } }, { grantedByUserId: { in: ids } }],
    },
  });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  // R64.5 — approving a child now creates an enrolment, and
  // `enrollment.student_id` is ON DELETE RESTRICT, so it goes before the
  // student it belongs to.
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearOwnedConsumedTokens(prisma, suiteTokens);
  await prisma.normalizedEmailLock.deleteMany({ where: { email: { startsWith: "reg-" } } });
  // After the users, never before: `intended_branch_id` is ON DELETE RESTRICT,
  // so a branch still referenced by a registration refuses to go — which is the
  // guarantee, working.
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  // After the users too: `intended_category_id` is ON DELETE RESTRICT, for the
  // same reason the branch is — a Category with requests pointing at it must not
  // vanish underneath them (R49).
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
    await clear();
  // **Installed ONCE**, not per test: a second install would take the
  // suite's own row as *what was there before* and lose the installation's,
  // leaving it superseded after the run (P1.2).
  consentText ??= await installTestConsentText(prisma, TEXT_VERSION);
  branchId = (await prisma.branch.create({ data: { name: `${TAG} مقر` } })).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } }))
    .id;
});

const countTagged = () =>
  prisma.user.count({ where: { nameArabic: { startsWith: TAG } } });

/** Polls rather than sleeping a fixed time: the rollback is asynchronous. */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

afterAll(async () => {
  // **Restored FIRST, not last** (B10): the restore used to sit after the
  // fixture teardown, so any failure there skipped it and left this suite's
  // scratch wording in the shared database. See `test-support/legal-consent-text`.
  await removeTestConsentText(prisma, consentText);
  await clear();
  // R64.5 — the approving tests provision a placement, and its group holds an
  // enrolment under RESTRICT, so it goes after the people it enrolled.
  const { clearPlacement } = await import("../test-support/placement.js");
  await clearPlacement(prisma, PLACEMENT_TAG);
  // Restore, never delete: deleting left the developer's database with no
  // consent text version, and registration then failed closed for everyone
  // who used the form after a test run (see test-support/consent-setting).
  // **Last, after the fixture teardown**: `consent_text_id` is RESTRICT, so a
  // row is only free to go once this suite's own consent records have gone.
  await deleteTestConsentText(prisma, consentText);
  await prisma.$disconnect();
});

/**
 * **Runs `run` with NO legal wording in force**, then puts back what was
 * (R119). Nothing is deleted — the active row is stamped `superseded` and
 * stamped back — and the restore is in a `finally`, because a failing assertion
 * must not leave the shared development database unable to accept a
 * registration.
 */
async function withNoActiveConsentText<T>(run: () => Promise<T>): Promise<T> {
  const active = await prisma.legalConsentText.findFirst({
    where: { status: "active" },
    select: { id: true },
  });
  if (active) {
    await prisma.legalConsentText.update({
      where: { id: active.id },
      data: { status: "superseded", supersededAt: new Date() },
    });
  }
  try {
    return await run();
  } finally {
    if (active) {
      await prisma.legalConsentText.update({
        where: { id: active.id },
        data: { status: "active", supersededAt: null },
      });
    }
  }
}

describe("R130 — every beneficiary carries a full date of birth (Owner, 2026-09-03)", () => {
  /**
   * **Required where a person is ADMITTED, not where a person authenticates.**
   *
   * The adult path's applicant *is* the beneficiary, so she carries one. Every
   * child on a family request carries her own. A **guardian** carries none —
   * R129 makes her guardian-only and the Owner ruled the question out for her —
   * and a **staff request** carries none either, because a مؤطِّرة is not
   * admitted to a Level and asking would collect a beneficiary's personal datum
   * from somebody who is not one.
   *
   * Stored as a full calendar date and never as an age: an age column is wrong
   * the day after it is written, so `lib/birth-date.ts` derives it on demand.
   */
  const adultBeneficiary = (over: Record<string, unknown> = {}) => ({
    kind: "adult" as const,
    applicant: {
      first_name_arabic: `${TAG}`,
      last_name_arabic: "بالغة",
      phone: "+212 600 000 111",
      sex: "female" as const,
      birth_date: "1998-03-14",
      ...over,
    },
    branch_id: branchId,
    category_id: categoryId,
    consents: { data_processing: true, consent_text_id: consentText!.id },
  });

  /**
   * **Parsed, because `birth_date` is the first field whose validator
   * transforms.** Every other registration field reaches the service as the
   * literal the test wrote, so the suite has always passed raw objects. A date
   * arrives as a `string` and leaves as a `Date`, so a raw literal would hand
   * the service a value the controller could never produce — and Prisma
   * refuses it, which is how this was found.
   */
  const parsed = (payload: unknown): RegistrationInput =>
    registrationSchema.parse(payload);

  it("1 · REFUSES an adult beneficiary registration with no date of birth", () => {
    const { birth_date: _omitted, ...applicant } = adultBeneficiary().applicant;
    const parsed = registrationSchema.safeParse({
      ...adultBeneficiary(),
      applicant,
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("birth_date");
  });

  it("2 · accepts one and preserves the EXACT calendar date", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(prisma, token, parsed(adultBeneficiary()), KEY);

    const applicant = await prisma.user.findUniqueOrThrow({
      where: { id: result.applicantId },
    });
    // TD-11 — a date, never an instant. Not shifted by a zone, not rounded.
    expect(applicant.birthDate?.toISOString().slice(0, 10)).toBe("1998-03-14");
  });

  it("3 · a STAFF request needs none, and is REFUSED if it sends one", () => {
    const staff = {
      kind: "adult" as const,
      applicant: {
        first_name_arabic: `${TAG}`,
        last_name_arabic: "مؤطرة",
        phone: "+212 600 000 112",
        sex: "female" as const,
      },
      requested_role: "teacher" as const,
      framing: { mode: "online" as const },
      consents: { data_processing: true, consent_text_id: consentText!.id },
    };
    expect(registrationSchema.safeParse(staff).success).toBe(true);

    const withDob = {
      ...staff,
      applicant: { ...staff.applicant, birth_date: "1990-01-01" },
    };
    const parsed = registrationSchema.safeParse(withDob);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("birth_date");
  });

  it("4 · EACH child on a family request must carry her own", () => {
    const base = parentChild();
    const withoutDob = registrationSchema.safeParse(base);
    expect(withoutDob.success).toBe(false);
    expect(JSON.stringify(withoutDob.error?.issues)).toContain("birth_date");

    // And the GUARDIAN needs none — the same payload passes once the child has
    // one, with nothing added for the mother.
    const withDob = {
      ...base,
      children: [{ ...base.children[0]!, birth_date: "2015-06-02" }],
    };
    expect(registrationSchema.safeParse(withDob).success).toBe(true);
  });

  it("5 · siblings' dates are independent and both preserved exactly", async () => {
    const base = parentChild();
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      parsed({
        ...base,
        children: [
          { ...base.children[0]!, birth_date: "2015-06-02" },
          {
            ...base.children[0]!,
            last_name_arabic: "أخت",
            birth_date: "2012-11-30",
          },
        ],
      }),
      KEY,
    );

    const applications = await prisma.childApplication.findMany({
      where: { id: { in: result.childApplicationIds } },
      select: { lastNameArabic: true, birthDate: true },
      orderBy: { lastNameArabic: "asc" },
    });
    expect(applications).toHaveLength(2);
    const dates = applications.map((a) => a.birthDate?.toISOString().slice(0, 10)).sort();
    expect(dates).toEqual(["2012-11-30", "2015-06-02"]);
  });

  it("6 · approval MATERIALISES the application's date onto the beneficiary", async () => {
    const base = parentChild();
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      parsed({ ...base, children: [{ ...base.children[0]!, birth_date: "2014-01-09" }] }),
      KEY,
    );

    const childId = await approveFirstChild(result.childApplicationIds[0]!);
    const child = await prisma.user.findUniqueOrThrow({ where: { id: childId } });
    // Copied, never recomputed: the application is the evidence and the `User`
    // becomes the authority, and the two must not be able to disagree.
    expect(child.birthDate?.toISOString().slice(0, 10)).toBe("2014-01-09");
  });

  it("7 · a GUARDIAN-only account is not required to have one", async () => {
    const base = parentChild();
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      parsed({ ...base, children: [{ ...base.children[0]!, birth_date: "2016-02-29" }] }),
      KEY,
    );

    const guardian = await prisma.user.findUniqueOrThrow({
      where: { id: result.applicantId },
    });
    // R129 — she authenticates to manage a child and is admitted to nothing, so
    // the question is not asked of her. `null` is the correct recorded answer.
    expect(guardian.birthDate).toBeNull();
    expect(guardian.isBeneficiary).toBe(false);
  });

  it("8 · REFUSES a date that is impossible, in the future, or malformed", () => {
    for (const bad of ["2010-02-31", "2099-01-01", "14/03/1998", "1998-3-14", "1200-01-01"]) {
      const parsed = registrationSchema.safeParse(adultBeneficiary({ birth_date: bad }));
      expect(parsed.success, bad).toBe(false);
    }
    // A leap day is a real date and is accepted.
    expect(registrationSchema.safeParse(adultBeneficiary({ birth_date: "1996-02-29" })).success).toBe(
      true,
    );
  });

  it("9 · NO stored age exists anywhere on the person", async () => {
    /**
     * The Owner's rule, asserted against the live schema rather than against a
     * memory of it: a derived value that is persisted becomes wrong the day
     * after it is written, and then two sources disagree about how old somebody
     * is.
     */
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('user', 'child_application')`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names).toContain("birth_date");
    expect(names.filter((n) => /(^|_)age($|_)/.test(n))).toEqual([]);
  });

  it("12 · a legacy beneficiary with no date is left alone, never given one", async () => {
    const legacy = await prisma.user.create({
      data: {
        sex: "female",
        nameArabic: `${TAG} مستفيدة قديمة`,
        accountStatus: "active",
        isBeneficiary: true,
      },
    });
    // Nothing in the read path fabricates, defaults or infers a value — not from
    // the Category, the schooling stage, an enrolment or the row's own age.
    const read = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(read.birthDate).toBeNull();
  });
});

describe("a PLATFORM ACCOUNT is not ASSOCIATION MEMBERSHIP (Owner, 2026-09-03)", () => {
  /**
   * **The rule, stated so nobody has to infer it from behaviour.** Fatima
   * authenticates in order to register and manage Sara. She therefore needs the
   * ordinary `User` + `UserIdentity` machinery — for authentication,
   * authorization, consent and `FamilyLink` — and that is *all* it means. In the
   * business domain she is **guardian-only**: not a beneficiary, not a Student,
   * not enrolled, not staff, not an association member.
   *
   * **This is already how the platform behaves**, through R62 and R79.3 rather
   * than through anything added here: `mustEnrol` is empty for an applicant who
   * arrived with child applications, `isBeneficiary` is written from the set the
   * approval actually *enrols*, and the `student` role is granted from that same
   * set. These tests **pin** that model, because it is stated in three services
   * and nothing asserted it end to end — and the failure would be silent and
   * severe: a guardian appearing in a beneficiary list, or handed a personal
   * educational record she never had.
   *
   * The upgrade path is Owner-approved and deliberately NOT a second account:
   * if Fatima later applies for herself, the beneficiary state attaches to
   * **this same User**.
   */
  async function registerGuardianWithChild(): Promise<{
    applicantId: string;
    childApplicationIds: string[];
  }> {
    const { token } = issueOnboardingToken(identity(), KEY);
    return register(prisma, token, parentChild(), KEY);
  }

  async function approveApplicant(applicantId: string): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "admin" } });
    const admin = await prisma.user.create({
      data: { sex: "female", nameArabic: `${TAG} مسؤولة الاعتماد`, accountStatus: "active" },
    });
    await prisma.userBranchRole.create({
      data: { userId: admin.id, roleId: role.id, branchId: null },
    });
    const { decide } = await import("./approval.service.js");
    const { actorFor } = await import("../test-support/actor.js");
    await decide(prisma, await actorFor(prisma, admin.id), applicantId, { approve: true });
  }

  it("approving a guardian activates her account and admits her to NOTHING", async () => {
    const { applicantId } = await registerGuardianWithChild();
    await approveApplicant(applicantId);

    const guardian = await prisma.user.findUniqueOrThrow({ where: { id: applicantId } });
    expect(guardian.accountStatus).toBe("active");
    // R79.3 — the durable beneficiary fact is written from the set the approval
    // ENROLS, and a guardian is not in it.
    expect(guardian.isBeneficiary).toBe(false);
    expect(await prisma.enrollment.count({ where: { studentId: applicantId } })).toBe(0);
  });

  it("she holds no student role — authentication is not admission", async () => {
    const { applicantId } = await registerGuardianWithChild();
    await approveApplicant(applicantId);

    const roles = await prisma.userBranchRole.findMany({
      where: { userId: applicantId, deletedAt: null },
      select: { role: { select: { name: true } } },
    });
    const names = roles.map((r) => r.role.name);
    expect(names).not.toContain("student");
    expect(names).not.toContain("teacher");
    expect(names).not.toContain("admin");
    expect(names).not.toContain("super_admin");
  });

  it("she does NOT appear in the beneficiaries list", async () => {
    const { applicantId } = await registerGuardianWithChild();
    await approveApplicant(applicantId);

    // The same filter every beneficiary-facing read uses (`beneficiaries_only`).
    const listed = await prisma.user.count({
      where: { id: applicantId, isBeneficiary: true, deletedAt: null },
    });
    expect(listed).toBe(0);
  });

  it("she carries no personal educational record of her own", async () => {
    const { applicantId } = await registerGuardianWithChild();
    await approveApplicant(applicantId);

    // Nothing that would populate a beneficiary dashboard for HER. The parent
    // dashboards resolve a CHILD through `X-Active-Child-ID`; there is no arm
    // that shows a guardian her own marks, because there are none.
    expect(await prisma.grade.count({ where: { studentId: applicantId } })).toBe(0);
    expect(await prisma.attendance.count({ where: { studentId: applicantId } })).toBe(0);
    expect(await prisma.studentExamSubmission.count({ where: { studentId: applicantId } })).toBe(0);
    expect(await prisma.quranProgressLog.count({ where: { studentId: applicantId } })).toBe(0);
    expect(await prisma.studentTeachingGroup.count({ where: { studentId: applicantId } })).toBe(0);
  });

  it("HER EMAIL IS HERS: it is never copied onto the child or the application", async () => {
    /**
     * Owner, 2026-09-03: a guardian's authenticated email MAY also serve as that
     * same guardian's contact address — there is no second column to duplicate
     * it into. What it must never mean is *«Sara authenticates as
     * fatima@example.com»*. The child gets no identity and no address at all,
     * and `ChildApplication` has no email column to put one in.
     */
    const { applicantId, childApplicationIds } = await registerGuardianWithChild();
    const guardianEmail = (
      await prisma.userIdentity.findFirstOrThrow({
        where: { userId: applicantId },
        select: { email: true },
      })
    ).email;

    const childId = await approveFirstChild(childApplicationIds[0]!);
    const child = await prisma.user.findUniqueOrThrow({ where: { id: childId } });

    expect(child.preProvisionedEmail).toBeNull();
    expect(await prisma.userIdentity.count({ where: { userId: childId } })).toBe(0);
    // And the address is claimed by exactly ONE account — the guardian's.
    const claimants = await prisma.userIdentity.findMany({
      where: { email: guardianEmail },
      select: { userId: true },
    });
    expect(claimants.map((c) => c.userId)).toEqual([applicantId]);
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: guardianEmail } }),
    ).toBe(0);
  });

  it("the guardian→beneficiary upgrade attaches to the SAME User, never a second one", async () => {
    /**
     * Owner, 2026-09-03: a guardian who later joins the association uses the
     * ordinary registration/approval process on her existing account. The
     * mechanism already exists — `isBeneficiary`, the `student` role and the
     * `Enrollment` are all written against a `userId`, and none of them is
     * created by registration — so admitting her is an approval acting on this
     * row. Pinned here so a future implementation of the upgrade screen cannot
     * quietly create a duplicate person instead.
     */
    const { applicantId, childApplicationIds } = await registerGuardianWithChild();
    await approveApplicant(applicantId);
    // R62 — the FamilyLink is created when the CHILD's application is decided,
    // not at registration, so her guardian history begins here.
    await approveFirstChild(childApplicationIds[0]!);

    const { provisionPlacement } = await import("../test-support/placement.js");
    const placement = await provisionPlacement(prisma, PLACEMENT_TAG);
    await prisma.enrollment.create({
      data: {
        studentId: applicantId,
        administrativeGroupId: placement.administrativeGroupId,
        levelId: placement.levelId,
        branchId: placement.branchId,
      },
    });
    await prisma.user.update({ where: { id: applicantId }, data: { isBeneficiary: true } });

    const upgraded = await prisma.user.findUniqueOrThrow({
      where: { id: applicantId },
      include: { parentLinks: true },
    });
    expect(upgraded.isBeneficiary).toBe(true);
    // Her guardian history is intact — she is one person, before and after.
    expect(upgraded.parentLinks.length).toBeGreaterThan(0);
    expect(
      await prisma.user.count({ where: { nameArabic: upgraded.nameArabic, deletedAt: null } }),
    ).toBe(1);
  });
});

describe("§7 Revision 40 — الاسم الشخصي / الاسم العائلي", () => {
  it("stores both parts AND composes name_arabic from them", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: "adult",
        applicant: {
          first_name_arabic: `${TAG} خديجة`,
          last_name_arabic: "بنعلي",
          phone: '+212600000004',
          sex: "female",
        },
        branch_id: branchId,
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );

    const user = await prisma.user.findUnique({
      where: { id: result.applicantId },
    });
    expect(user?.firstNameArabic).toBe(`${TAG} خديجة`);
    expect(user?.lastNameArabic).toBe("بنعلي");
    // Composed by the SERVER, personal name first, single space. A client doing
    // this would make it the authority on how a person's name reads (§1.1) —
    // and the wrong order is a mistake nobody reviewing a list would spot.
    expect(user?.nameArabic).toBe(`${TAG} خديجة بنعلي`);
  });

  it("composes for the CHILD too, not only the applicant", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: "parent_child",
        parent: {
          first_name_arabic: `${TAG} أمينة`,
          last_name_arabic: "بنعلي",
          phone: '+212600000005',
          sex: "female",
        },
        children: [
          {
            first_name_arabic: `${TAG} سارة`,
            last_name_arabic: "بنعلي",
            sex: "female",
            consent_media_release: true,
            requested_branch_id: branchId,
            requested_category_id: categoryId,
          },
        ],
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );
    // The composition now happens when the child is created — at approval.
    const childId = await approveFirstChild(result.childApplicationIds[0]!);
    const child = await prisma.user.findUnique({ where: { id: childId } });
    expect(child?.firstNameArabic).toBe(`${TAG} سارة`);
    expect(child?.nameArabic).toBe(`${TAG} سارة بنعلي`);
  });

  it("REFUSES a composed name_arabic from the client", () => {
    // `.strict()`: the client must not be the authority on how the name reads,
    // so sending it is a refusal rather than a silently ignored field.
    const parsed = registrationSchema.safeParse({
      kind: "adult",
      applicant: {
        first_name_arabic: "خديجة",
        last_name_arabic: "بنعلي",
        name_arabic: "شيء آخر تماماً",
        sex: "female",
      },
      branch_id: "00000000-0000-4000-8000-000000000000",
      category_id: categoryId,
      consents: { data_processing: true, consent_text_id: consentText!.id },
    });
    expect(parsed.success).toBe(false);
  });

  it("REQUIRES both parts, and refuses a blank or over-long one (TD-9)", () => {
    const base = {
      kind: "adult" as const,
      branch_id: "00000000-0000-4000-8000-000000000000",
      category_id: categoryId,
      consents: { data_processing: true, consent_text_id: consentText!.id },
    };
    // Missing family name.
    expect(
      registrationSchema.safeParse({
        ...base,
        applicant: { first_name_arabic: "خديجة", sex: "female" },
      }).success,
    ).toBe(false);
    // Whitespace only — trimmed to empty, which the DB CHECK also refuses.
    expect(
      registrationSchema.safeParse({
        ...base,
        applicant: {
          first_name_arabic: "   ",
          last_name_arabic: "بنعلي",
          sex: "female",
        },
      }).success,
    ).toBe(false);
    // 61 characters: one past TD-9's per-part limit, which is what keeps the
    // composed name inside `name_arabic`'s 120.
    expect(
      registrationSchema.safeParse({
        ...base,
        applicant: {
          first_name_arabic: "أ".repeat(61),
          last_name_arabic: "بنعلي",
          sex: "female",
        },
      }).success,
    ).toBe(false);
  });

  it("R41 identifies the missing French counterpart for adults and children", () => {
    const adult = {
      kind: "adult" as const,
      applicant: {
        first_name_arabic: "خديجة",
        last_name_arabic: "بنعلي",
        phone: '+212600000050',
        sex: "female" as const,
      },
      branch_id: branchId,
      category_id: categoryId,
      consents: { data_processing: true, consent_text_id: consentText!.id },
    };
    const missingAdultFirst = registrationSchema.safeParse({
      ...adult,
      applicant: { ...adult.applicant, last_name_french: "Benali" },
    });
    expect(missingAdultFirst.success).toBe(false);
    if (!missingAdultFirst.success) {
      expect(missingAdultFirst.error.issues[0]?.path).toEqual([
        "applicant",
        "first_name_french",
      ]);
    }

    const family = parentChild();
    const missingChildLast = registrationSchema.safeParse({
      ...family,
      children: [
        // R130 — supplied so this assertion still isolates the R41 rule; the
        // shared `parentChild()` fixture deliberately omits it, because the
        // *requirement* is asserted in the R130 block.
        { ...family.children[0]!, first_name_french: "Meriem", birth_date: "2015-06-02" },
      ],
    });
    expect(missingChildLast.success).toBe(false);
    if (!missingChildLast.success) {
      expect(missingChildLast.error.issues[0]?.path).toEqual([
        "children",
        0,
        "last_name_french",
      ]);
    }
  });
});

describe("§4.1 Revision 39 — the applicant chooses a Branch, and only a Branch", () => {
  it("still REJECTS every other placement field outright", () => {
    // R39 narrowed R29's prohibition by exactly one field. Level, Room and Group
    // remain administrative decisions after approval, and `.strict()` refuses
    // them rather than ignoring them — a silently dropped `level_id` would let a
    // client believe a placement was recorded.
    for (const field of ["room_id", "level_id", "group_id", "category_id"]) {
      const parsed = registrationSchema.safeParse({
        kind: "adult",
        applicant: {
          first_name_arabic: "خديجة",
          last_name_arabic: "الاختبارية",
          sex: "female",
          [field]: "anything",
        },
        branch_id: "00000000-0000-4000-8000-000000000000",
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentText!.id },
      });
      expect(parsed.success, `${field} must be rejected`).toBe(false);
    }
  });

  it("REQUIRES branch_id on the public self-service path", () => {
    // The applicant is present to choose, so a submission without a choice is
    // refused rather than defaulted. A default would silently put someone at a
    // branch nobody picked.
    const parsed = registrationSchema.safeParse({
      kind: "adult",
      applicant: {
        first_name_arabic: "خديجة",
        last_name_arabic: "الاختبارية",
        sex: "female",
      },
      category_id: categoryId,
      consents: { data_processing: true, consent_text_id: consentText!.id },
    });
    expect(parsed.success).toBe(false);
  });

  it("R67: REQUIRES a branch and a stage on EVERY child, not on the request", async () => {
    // They moved off the request onto each child, and moving a mandatory
    // question does not make it answerable by silence — an approver must know,
    // for each child, what was asked.
    const base = parentChild();
    for (const omit of [
      "requested_branch_id",
      "requested_category_id",
    ] as const) {
      const child = { ...base.children[0]! };
      delete (child as Record<string, unknown>)[omit];
      const parsed = registrationSchema.safeParse({
        ...base,
        children: [child],
      });
      expect(parsed.success, omit).toBe(false);
    }

    // And the request-level pair is REFUSED rather than ignored, so a stale
    // client learns it failed instead of believing the family answer applied.
    const stale = registrationSchema.safeParse({
      ...base,
      branch_id: branchId,
      category_id: categoryId,
    });
    expect(stale.success).toBe(false);
  });

  it("R67: two children may ask for DIFFERENT branches and stages", async () => {
    // The whole point of the revision, asserted on the rows rather than on the
    // form: a family is one request, and the children are not interchangeable.
    const otherBranch = await prisma.branch.create({
      data: { name: `${TAG} مقر ثانٍ` },
    });
    const otherCategory = await prisma.category.create({
      data: { name: `${TAG} فئة ثانية` },
    });
    const { token } = issueOnboardingToken(identity(), KEY);
    const base = parentChild();
    const result = await register(
      prisma,
      token,
      {
        ...base,
        children: [
          base.children[0]!,
          {
            ...base.children[0]!,
            first_name_arabic: `${TAG} الثانية`,
            requested_branch_id: otherBranch.id,
            requested_category_id: otherCategory.id,
          },
        ],
      },
      KEY,
    );

    const rows = await prisma.childApplication.findMany({
      where: { id: { in: result.childApplicationIds } },
      orderBy: { createdAt: "asc" },
      select: { requestedBranchId: true, requestedCategoryId: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.requestedBranchId).toBe(branchId);
    expect(rows[1]!.requestedBranchId).toBe(otherBranch.id);
    expect(rows[1]!.requestedCategoryId).toBe(otherCategory.id);

    // R67.3 — the applicant's own branch and stage come from the FIRST child.
    const applicant = await prisma.user.findUniqueOrThrow({
      where: { id: result.applicantId },
      select: { intendedBranchId: true, intendedCategoryId: true },
    });
    expect(applicant.intendedBranchId).toBe(branchId);
    expect(applicant.intendedCategoryId).toBe(categoryId);
  });

  it("persists the chosen branch as a REQUEST, granting no placement", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: "adult",
        applicant: {
          first_name_arabic: `${TAG}`,
          last_name_arabic: `مختارة`,
          phone: '+212600000006',
          sex: "female",
        },
        branch_id: branchId,
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );

    const applicant = await prisma.user.findUnique({
      where: { id: result.applicantId },
    });
    expect(applicant?.intendedBranchId).toBe(branchId);

    // The distinction R39 turns on: what was ASKED FOR is recorded; where the
    // person ENDS UP is still nothing, because placement follows approval. A
    // role assignment and an enrolment are both absent.
    expect(
      await prisma.userBranchRole.count({
        where: { userId: result.applicantId },
      }),
    ).toBe(0);
    expect(
      await prisma.enrollment.count({
        where: { studentId: result.applicantId },
      }),
    ).toBe(0);
  });

  it("records the branch on the APPLICANT only, never copied onto the child", async () => {
    // One decision, one row. Copying it onto the child would be a second value
    // to keep in step, and the child's branch — once they have one — is their
    // Group's.
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(prisma, token, parentChild(), KEY);

    const parent = await prisma.user.findUnique({
      where: { id: result.applicantId },
    });
    expect(parent?.intendedBranchId).toBe(branchId);
    // R62 makes this stronger than it was: there is no child row to copy a
    // branch onto until approval, and approval does not copy one either.
    const childId = await approveFirstChild(result.childApplicationIds[0]!);
    const child = await prisma.user.findUnique({ where: { id: childId } });
    expect(child?.intendedBranchId).toBeNull();
  });

  it("REFUSES a branch that does not exist", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    await expect(
      register(
        prisma,
        token,
        {
          kind: "adult",
          applicant: {
            first_name_arabic: `${TAG}`,
            last_name_arabic: `وهمية`,
            phone: '+212600000007',
            sex: "female",
          },
          branch_id: "00000000-0000-4000-8000-000000000000",
          category_id: categoryId,
          consents: { data_processing: true, consent_text_id: consentText!.id },
        },
        KEY,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("REFUSES a soft-deleted branch — a closed premises takes no registrations", async () => {
    // The foreign key alone would NOT catch this: a soft delete leaves the row
    // in place, so liveness has to be checked explicitly (R35 refuses to
    // advertise a closed branch for the same reason).
    const closed = await prisma.branch.create({
      data: { name: `${TAG} مغلق`, deletedAt: new Date() },
    });
    const { token } = issueOnboardingToken(identity(), KEY);
    await expect(
      register(
        prisma,
        token,
        {
          kind: "adult",
          applicant: {
            first_name_arabic: `${TAG}`,
            last_name_arabic: `مرفوضة`,
            phone: '+212600000008',
            sex: "female",
          },
          branch_id: closed.id,
          category_id: categoryId,
          consents: { data_processing: true, consent_text_id: consentText!.id },
        },
        KEY,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("ACCEPTS a branch that has not opened yet", async () => {
    // §4.4 keeps such a branch out of the CALENDAR; it must not keep it out of
    // registration, or an association could never enrol anyone for a premises
    // before opening day.
    const future = await prisma.branch.create({
      data: {
        name: `${TAG} قادم`,
        operationalStartDate: new Date(Date.UTC(2099, 0, 1)),
      },
    });
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: "adult",
        applicant: {
          first_name_arabic: `${TAG}`,
          last_name_arabic: `مبكرة`,
          phone: '+212600000009',
          sex: "female",
        },
        branch_id: future.id,
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );
    const applicant = await prisma.user.findUnique({
      where: { id: result.applicantId },
    });
    expect(applicant?.intendedBranchId).toBe(future.id);
  });
});

describe("§4.1b step 5 Revision 27 — registration captures sex before the User exists", () => {
  it("persists sex for BOTH people created by a parent+child registration", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: "parent_child",
        parent: {
          first_name_arabic: `${TAG}`,
          last_name_arabic: `والدة`,
          phone: '+212600000010',
          sex: "female",
        },
        children: [
          {
            first_name_arabic: `${TAG}`,
            last_name_arabic: `ابن`,
            sex: "male",
            consent_media_release: true,
            requested_branch_id: branchId,
            requested_category_id: categoryId,
          },
        ],
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );

    const parent = await prisma.user.findUnique({
      where: { id: result.applicantId },
    });
    // Written in the same transaction that created them — never patched on.
    expect(parent?.sex).toBe("female");
    // The child's sex travels on the application and is written when the child
    // is created, which is still one transaction — a later one.
    const childId = await approveFirstChild(result.childApplicationIds[0]!);
    expect(
      (await prisma.user.findUnique({ where: { id: childId } }))?.sex,
    ).toBe("male");
  });

  it("persists sex on the adult self-registration path", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: "adult",
        applicant: {
          first_name_arabic: `${TAG}`,
          last_name_arabic: `راشدة`,
          phone: '+212600000011',
          sex: "female",
        },
        branch_id: branchId,
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );
    expect(
      (await prisma.user.findUnique({ where: { id: result.applicantId } }))
        ?.sex,
    ).toBe("female");
  });

  it("the API boundary refuses a registration with no sex (§16.2: Zod validates there)", () => {
    // `register()` deliberately trusts its input — §16.2 applies Zod schemas at
    // the API boundary, so that is where this rule lives and is asserted.
    const parsed = registrationSchema.safeParse({
      kind: "adult",
      applicant: { first_name_arabic: "خديجة", last_name_arabic: "الاختبارية" },
      branch_id: branchId,
      category_id: categoryId,
      consents: { data_processing: true, consent_text_id: consentText!.id },
    });
    expect(parsed.success).toBe(false);
  });

  it("the API boundary refuses an invalid sex value", () => {
    const parsed = registrationSchema.safeParse({
      kind: "adult",
      applicant: {
        first_name_arabic: "خديجة",
        last_name_arabic: "الاختبارية",
        sex: "other",
      },
      branch_id: branchId,
      category_id: categoryId,
      consents: { data_processing: true, consent_text_id: consentText!.id },
    });
    expect(parsed.success).toBe(false);
  });

  it("the boundary accepts either permitted value", () => {
    for (const sex of ["female", "male"]) {
      const parsed = registrationSchema.safeParse({
        kind: "adult",
        applicant: {
          first_name_arabic: "خديجة",
          last_name_arabic: "الاختبارية",
          phone: '+212600000051',
          sex,
          // R130 — an adult applicant IS the beneficiary, so the boundary now
          // requires one. This test is about `sex`; the date keeps it valid.
          birth_date: "1997-08-21",
        },
        branch_id: "00000000-0000-4000-8000-000000000000",
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentText!.id },
      });
      expect(parsed.success).toBe(true);
    }
  });
});

describe("§4.1b step 5 / TD-4.1 unified registration", () => {
  it("creates parent + applications + consents + identity + consumed token atomically", async () => {
    // **R62 narrowed what this transaction writes.** It no longer creates the
    // child, its link or its consents — those arrive at approval, one child at
    // a time, so a refused child leaves nothing behind. What stays atomic is
    // everything about the person who actually exists.
    const id = identity();
    const { token, claims } = issueOnboardingToken(id, KEY);
    const result = await register(prisma, token, parentChild(), KEY);

    expect(result.accountStatus).toBe("pending");
    expect(result.childApplicationIds).toHaveLength(1);

    const parent = await prisma.user.findUnique({
      where: { id: result.applicantId },
    });
    expect(parent?.accountStatus).toBe("pending");

    // No child, no link — by design. This is the property that makes per-child
    // approval safe rather than merely convenient.
    expect(
      await prisma.familyLink.count({
        where: { parentId: result.applicantId },
      }),
    ).toBe(0);

    const application = await prisma.childApplication.findUnique({
      where: { id: result.childApplicationIds[0]! },
    });
    expect(application?.status).toBe("pending");
    expect(application?.childUserId).toBeNull();
    // R62.3b — the version the parent SAW travels with the request.
    expect(application?.consentTextVersion).toBe(TEXT_VERSION);

    const identityRow = await prisma.userIdentity.findFirst({
      where: { userId: result.applicantId },
    });
    expect(identityRow?.email).toBe(id.email);
    expect(identityRow?.providerSubjectId).toBe(id.providerSubjectId);

    // The applicant's own consent, and only theirs — the child has none yet.
    const consents = await prisma.consentRecord.findMany({
      where: { studentId: result.applicantId },
    });
    expect(consents).toHaveLength(1);
    expect(consents[0]?.consentTextVersion).toBe(TEXT_VERSION);

    expect(
      await prisma.consumedToken.count({ where: { jti: claims.jti } }),
    ).toBe(1);
  });

  it("a minor is login-less: no identity and no pre_provisioned_email (BR-5)", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(prisma, token, parentChild(), KEY);

    // Still true, and now provable only once the child exists — at approval.
    const childId = await approveFirstChild(result.childApplicationIds[0]!);
    const child = await prisma.user.findUnique({ where: { id: childId } });
    expect(child?.preProvisionedEmail).toBeNull();
    expect(
      await prisma.userIdentity.count({ where: { userId: childId } }),
    ).toBe(0);
  });

  it("a declined media release is RECORDED, not omitted (BR-1, §4.1a)", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    // R62.3b — the decision is PER CHILD now, so it lives on the child rather
    // than on the request beside `data_processing`.
    const base = parentChild();
    const input = {
      ...base,
      children: [
        {
          ...base.children[0]!,
          consent_media_release: false,
          requested_branch_id: branchId,
          requested_category_id: categoryId,
        },
      ],
    };
    const result = await register(prisma, token, input, KEY);

    // Captured on the application immediately…
    const application = await prisma.childApplication.findUnique({
      where: { id: result.childApplicationIds[0]! },
    });
    expect(application?.consentMediaRelease).toBe(false);

    // …and materialised as a real record when the child comes into existence.
    const childId = await approveFirstChild(result.childApplicationIds[0]!);
    const media = await prisma.consentRecord.findFirst({
      where: { studentId: childId, consentType: "media_release" },
    });
    // Absence would ALSO mean "no consent" (BR-1), but a decision must leave a
    // record with an actor and timestamp so the history is auditable.
    expect(media).not.toBeNull();
    expect(media?.granted).toBe(false);
    expect(media?.revokedAt).toBeInstanceOf(Date);
    expect(media?.revokedByUserId).toBe(result.applicantId);
  });

  it("REPLAY: the same token twice → 409 STATE_CONFLICT and nothing partial persists", async () => {
    const id = identity();
    const { token } = issueOnboardingToken(id, KEY);
    await register(prisma, token, parentChild(), KEY);

    const usersBefore = await prisma.user.count({
      where: { nameArabic: { startsWith: TAG } },
    });
    await expect(
      register(prisma, token, parentChild(), KEY),
    ).rejects.toMatchObject({
      code: "STATE_CONFLICT",
    });
    // §4.1b step 6: a failed submission persists nothing — the aborted attempt
    // must not have left a second parent behind.
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(usersBefore);
  });

  it("ATOMICITY: a failure at the LAST write rolls back everything, including the jti", async () => {
    // The §18 "kill it mid-transaction — nothing partial persists" check, done
    // deterministically. The failure is forced at the FINAL write by
    // pre-registering the same Google subject, so the transaction has already
    // consumed the jti and created the parent, child, link and consents before
    // the identity insert collides.
    const id = identity();
    const squatter = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} سابق`,
        accountStatus: "active",
      },
    });
    await prisma.userIdentity.create({
      data: {
        userId: squatter.id,
        provider: "google",
        providerSubjectId: id.providerSubjectId,
        email: id.email,
      },
    });

    const { token, claims } = issueOnboardingToken(id, KEY);
    await expect(
      register(prisma, token, parentChild(), KEY),
    ).rejects.toMatchObject({
      code: "DUPLICATE",
    });

    // Only the pre-existing squatter remains: no parent, no child.
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(1);
    // Scoped to THIS test's users: the §15.2 dev fixtures also hold family links,
    // so a global count would measure them instead of the rollback.
    expect(
      await prisma.familyLink.count({
        where: { parent: { nameArabic: { startsWith: TAG } } },
      }),
    ).toBe(0);
    expect(
      await prisma.consentRecord.count({
        where: { consentTextVersion: TEXT_VERSION },
      }),
    ).toBe(0);
    // The decisive assertion: the rollback undid the replay guard too. A jti left
    // behind by a failed attempt would burn the user's one-and-only token and
    // strand them with no way to register.
    expect(
      await prisma.consumedToken.count({ where: { jti: claims.jti } }),
    ).toBe(0);
  });

  it("§18 KILL: SIGKILL mid-transaction persists nothing — not even the jti", async () => {
    // The §18 check taken literally: kill the PROCESS, not the transaction.
    //
    // This is a different failure from the one above. There, an error is raised
    // and Prisma rolls back — application code participates. Here nothing is
    // raised, no `finally` runs, and no teardown happens: SIGKILL cannot be
    // intercepted. What has to protect the database is PostgreSQL discarding an
    // uncommitted transaction when the client connection dies. If registration
    // were ever split across two transactions, or if any write escaped the
    // transaction, this is the test that would catch it.
    const id = identity();
    const victim = fileURLToPath(
      new URL("../test-support/registration-victim.ts", import.meta.url),
    );

    // The victim mints its token inside its own process, so the parent never
    // learns the jti. What this test actually claims is that the crash spent
    // NOTHING — so the scoped form of the claim is that the set of consumed
    // tokens is the same afterwards as before. Asserting a global count of zero
    // instead would only pass on a database where nobody else has ever
    // registered, which is how the old suite-wide `deleteMany` hid itself.
    const consumedBefore = await prisma.consumedToken.count();

    const child = spawn(
      "npx",
      [
        "tsx",
        victim,
        TAG,
        id.email,
        id.providerSubjectId,
        branchId,
        categoryId,
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // Wait until it is genuinely parked INSIDE the transaction, past every write
    // but before the commit — a timer would be a guess, and a guess that fired
    // early would make this test prove nothing.
    const parked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 60_000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("READY")) {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    expect(parked).toBe(true);

    // Prove the test is not vacuous BEFORE killing anything. If Prisma buffered
    // the writes until commit, nothing would ever have reached the database and
    // the rollback below would be proving nothing at all. PostgreSQL assigns a
    // transaction id only to a transaction that has actually written, so a
    // parked backend carrying an xid is direct evidence that the rows exist and
    // are uncommitted.
    const writing = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM pg_stat_activity
      WHERE state = 'idle in transaction' AND backend_xid IS NOT NULL
        AND datname = current_database()
    `;
    expect(Number(writing[0]!.count)).toBeGreaterThan(0);

    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    child.kill("SIGKILL");
    await exited;

    // Give PostgreSQL a moment to notice the dead connection and roll back.
    await waitFor(async () => (await countTagged()) === 0);

    expect(await countTagged()).toBe(0);
    expect(
      await prisma.familyLink.count({
        where: { parent: { nameArabic: { startsWith: TAG } } },
      }),
    ).toBe(0);
    expect(
      await prisma.consentRecord.count({
        where: { consentTextVersion: TEXT_VERSION },
      }),
    ).toBe(0);
    expect(
      await prisma.userIdentity.count({
        where: { providerSubjectId: id.providerSubjectId },
      }),
    ).toBe(0);
    // And the applicant is not stranded: their single-use token survives the
    // crash unconsumed, so they can simply try again.
    expect(await prisma.consumedToken.count()).toBe(consumedBefore);
  }, 90_000);

  it("RETRY: after a rolled-back attempt the SAME token still works", async () => {
    // The token-consumption invariant, proven from the applicant's side rather
    // than by inspecting a row: a failed attempt must not burn their one
    // single-use credential (§4.1b issues exactly one token per callback).
    const id = identity();
    const blocker = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} حاجز`,
        accountStatus: "active",
      },
    });
    const blockingIdentity = await prisma.userIdentity.create({
      data: {
        userId: blocker.id,
        provider: "google",
        providerSubjectId: id.providerSubjectId,
        email: id.email,
      },
    });

    const { token, claims } = issueOnboardingToken(id, KEY);

    // Attempt 1 fails at the final write and rolls back.
    await expect(
      register(prisma, token, parentChild(), KEY),
    ).rejects.toMatchObject({
      code: "DUPLICATE",
    });
    expect(
      await prisma.consumedToken.count({ where: { jti: claims.jti } }),
    ).toBe(0);

    // The transient cause is removed — as an admin merging a duplicate would do.
    await prisma.userIdentity.delete({ where: { id: blockingIdentity.id } });

    // Attempt 2 with the SAME token must now succeed.
    const result = await register(prisma, token, parentChild(), KEY);
    expect(result.accountStatus).toBe("pending");
    expect(result.childApplicationIds).toHaveLength(1);
    // And only now is the token spent.
    expect(
      await prisma.consumedToken.count({ where: { jti: claims.jti } }),
    ).toBe(1);

    // A third attempt is a genuine replay.
    await expect(
      register(prisma, token, parentChild(), KEY),
    ).rejects.toMatchObject({
      code: "STATE_CONFLICT",
    });
  });

  it("refuses a missing data_processing consent with CONSENT_REQUIRED", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const input = parentChild();
    input.consents.data_processing = false;
    await expect(register(prisma, token, input, KEY)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(0);
  });

  it("refuses a minor registration with no per-child media-release decision", () => {
    const input = parentChild();
    const child = { ...input.children[0] } as Record<string, unknown>;
    delete child["consent_media_release"];
    expect(registrationSchema.safeParse({ ...input, children: [child] }).success).toBe(false);
  });

  it("adult self-registration creates one user, one consent, no link", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: "adult",
        applicant: {
          first_name_arabic: `${TAG}`,
          last_name_arabic: `خديجة`,
          phone: '+212600000012',
          sex: "female" as const,
        },
        branch_id: branchId,
        category_id: categoryId,
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );

    // An adult registration names no children at all.
    expect(result.childApplicationIds).toHaveLength(0);
    expect(
      await prisma.familyLink.count({
        where: { parentId: result.applicantId },
      }),
    ).toBe(0);
    const consents = await prisma.consentRecord.findMany({
      where: { studentId: result.applicantId },
    });
    expect(consents).toHaveLength(1);
    expect(consents[0]!.consentType).toBe("data_processing");
  });

  it("rejects an expired or forged token before touching the database", async () => {
    const stale = issueOnboardingToken(
      identity(),
      KEY,
      new Date(Date.now() - 20 * 60 * 1000),
    );
    await expect(
      register(prisma, stale.token, parentChild(), KEY),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const forged = issueOnboardingToken(identity(), "a-different-key");
    await expect(
      register(prisma, forged.token, parentChild(), KEY),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(0);
  });

  it("fails closed when no legal wording is in force (§2.3 owner task)", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    await withNoActiveConsentText(async () => {
    // §4.1a requires the exact text version on every record; without it we
    // cannot say what was agreed to, so we refuse rather than fabricate one.
    await expect(
      register(prisma, token, parentChild(), KEY),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      // **The half this test used to miss.** Asserting only that it fails let
      // the failure be indistinguishable from a transient outage, and the form
      // duly told the applicant to "try again later" — advice that could never
      // work, because no amount of waiting writes a missing configuration row.
      // TD-3.8's `details` is what makes the cause actionable, so it is pinned
      // here rather than left to chance.
      // **R119 dropped `setting` from the details.** It named
      // `legal.consent_text_version`, which is neither the authority nor the
      // remedy after the cutover; the coded `reason` a client branches on is
      // unchanged, which is why the message it maps to still works.
      details: { reason: "CONSENT_TEXT_VERSION_NOT_CONFIGURED" },
    });
    });
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(0);
  });

  it("concurrent submissions of ONE token admit exactly one registration", async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const results = await Promise.allSettled([
      register(prisma, token, parentChild(), KEY),
      register(prisma, token, parentChild(), KEY),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    // Exactly one parent + one child, never two of either.
    // **One** person, not two: R62 creates the applicant here and the child at
    // approval, so a losing concurrent attempt cannot leave a stray child either.
    expect(
      await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } }),
    ).toBe(1);
  });
});
