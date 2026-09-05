import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { actorFor } from "../test-support/actor.js";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from '../test-support/consumed-tokens.js';
import { decide, listApprovals } from "./approval.service.js";
import { register } from "./registration.service.js";
import {
  clearPlacement,
  provisionPlacement,
  type Placement,
} from "../test-support/placement.js";
import {
  deleteTestConsentText,
  installTestConsentText,
  removeTestConsentText,
  type InstalledConsentText,
} from '../test-support/legal-consent-text.js';

/**
 * Approval queue (SRS §5.6, TD-4.2, TD-12, TD-15.3) against the real database.
 * Bundle atomicity and first-wins concurrency are enforced by the transaction
 * and by status guards, so this has to run against PostgreSQL.
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
const TAG = "[appr-test]";
/**
 * **Deliberately not a prefix-extension of `TAG`.** `clear()` deletes by
 * `startsWith(TAG)`, so a placement tagged `${TAG}p` would be swept by the
 * suite's own branch delete — before its Administrative Group was gone, and the
 * `Restrict` FK would refuse. The separating `-` before the bracket is what
 * keeps the two namespaces disjoint.
 */
const PLACEMENT_TAG = "[appr-test-place]";

let counter = 0;
function identity() {
  counter += 1;
  return {
    email: `appr-${Date.now()}-${counter}@example.com`,
    providerSubjectId: `apprsub-${Date.now()}-${counter}`,
  };
}

/** An Admin whose role row actually exists — TD-12 checks live rows, not claims. */
async function makeAdmin(role = "admin"): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} مشرف`,
      accountStatus: "active",
    },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return user.id;
}

/** §4.1 Revision 39 — an applicant chooses a branch, so the fixture supplies
 *  one. Overridable, because a filter test needs items in *different* branches
 *  to prove it narrows rather than merely returning everything. */
/**
 * A parent+child registration.
 *
 * **R62 changed what this produces.** It used to create a pending parent, a
 * pending child `User` and a `FamilyLink(pending)`; it now creates the parent
 * and a `ChildApplication`. The child comes into existence at approval, one
 * child at a time, so a refused child leaves no account behind.
 */
async function submitBundle(
  intoBranchId?: string,
): Promise<{ parentId: string; applicationId: string }> {
  const { token } = issueOnboardingToken(identity(), KEY);
  const result = await register(
    prisma,
    token,
    {
      kind: "parent_child",
      parent: {
        first_name_arabic: `${TAG}`,
        last_name_arabic: `والدة`,
        phone: '+212600000002',
        first_name_french: 'Amina',
        last_name_french: 'Bennani',
        nickname: 'أم مريم',
        sex: "female" as const,
      },
      children: [
        {
          first_name_arabic: `${TAG}`,
          last_name_arabic: `طفلة`,
          first_name_french: 'Maryam',
          last_name_french: 'Bennani',
          nickname: 'مريم',
          sex: "female" as const,
          // R130 — every child registration states her own date of birth.
          birth_date: new Date("2015-04-12T00:00:00Z"),
          consent_media_release: true,
          // R67 — the branch and stage are the CHILD's now. `intoBranchId` is
          // what the branch-filter test varies, so it lands here rather than on
          // a request-level field that no longer exists.
          requested_branch_id: intoBranchId ?? branchId,
          // The fixture's placement Category, so §4.1 step 1's preselection and
          // the group the approval uses agree.
          requested_category_id: placement.categoryId,
        },
      ],
      consents: { data_processing: true, consent_text_id: consentText!.id },
    },
    KEY,
  );
  return {
    parentId: result.applicantId,
    applicationId: result.childApplicationIds[0]!,
  };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({
    where: {
      OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }],
    },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  // §4.1 (R43): approving now CREATES enrolments, and `enrollment.student_id`
  // is ON DELETE RESTRICT — so they go before the people they belong to. This
  // line did not exist before approval placed anybody, which is why adding the
  // placement turned an unrelated dozen tests red.
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // R62 — a parent_child registration now writes `child_application` rows, and
  // they reference the parent, the child and the deciding admin under RESTRICT.
  // A teardown that sweeps only what the previous shape wrote is blocked here.
  await prisma.childApplication.deleteMany({
    where: {
      OR: [
        { parentId: { in: ids } },
        { childUserId: { in: ids } },
        { decidedById: { in: ids } },
        { matchedExistingUserId: { in: ids } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearOwnedConsumedTokens(prisma, suiteTokens);
  await prisma.normalizedEmailLock.deleteMany({ where: { email: { startsWith: "appr-" } } });
  // After the users: `intended_branch_id` is ON DELETE RESTRICT, so a branch
  // still referenced refuses to go.
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  // **Last, not first.** `intended_branch_id` and `intended_category_id` are
  // both ON DELETE RESTRICT (R39, R49), so a Category or Branch still named by
  // a user refuses to go — which is the constraint doing its job, and the
  // reason this ordering is a requirement rather than a preference.
  await clearPlacement(prisma, PLACEMENT_TAG);
}

/** Two branches, because a filter that is never given something to exclude has
 *  not been tested (§4.1, Revision 39). */
let branchId = "";
let otherBranchId = "";
/**
 * §4.1 (Revision 43) makes placement part of approval, so every approval of a
 * student now needs a Level and a group behind it. Provisioned once per test
 * rather than copied into each, so the §4.4b sex restriction is satisfied by
 * design in one place.
 */
let placement: Placement;

/**
 * Left dead by R62 and removed rather than kept "in case".
 *
 * It built the `enrollments` argument for approving a family registration —
 * which no longer takes one: a parent enrols nobody, and the child's placement
 * is chosen when *that child's* application is decided. CI's lint gate is what
 * caught it, which is the gate doing its job.
 */

beforeEach(async () => {
    await clear();
  // **Installed ONCE**, not per test: a second install would take the
  // suite's own row as *what was there before* and lose the installation's,
  // leaving it superseded after the run (P1.2).
  consentText ??= await installTestConsentText(prisma, "appr-test-v1");
  branchId = (await prisma.branch.create({ data: { name: `${TAG} مقر أ` } }))
    .id;
  otherBranchId = (
    await prisma.branch.create({ data: { name: `${TAG} مقر ب` } })
  ).id;
  placement = await provisionPlacement(prisma, PLACEMENT_TAG);
});

afterAll(async () => {
  // **Restored FIRST, not last** (B10): the restore used to sit after the
  // fixture teardown, so any failure there skipped it and left this suite's
  // scratch wording in the shared database. See `test-support/legal-consent-text`.
  await removeTestConsentText(prisma, consentText);
  await clear();
  // Restore, never delete: deleting left the developer's database with no
  // consent text version, and registration then failed closed for everyone
  // who used the form after a test run (see test-support/consent-setting).
  // **Last, after the fixture teardown**: `consent_text_id` is RESTRICT, so a
  // row is only free to go once this suite's own consent records have gone.
  await deleteTestConsentText(prisma, consentText);
  await prisma.$disconnect();
});

describe("R66.5 — an approver places into a Level with no group", () => {
  it("approves with level_id + branch_id and enrols directly", async () => {
    // The capability the revision exists for. Before it, an approver facing a
    // Level nobody had subdivided could not admit anybody at all: the placement
    // demanded a group, and there was none to name.
    // Named with the PLACEMENT tag so `clearPlacement` sweeps it even when an
    // assertion fails before the explicit delete below — a leaked Level holds
    // its Category under RESTRICT and takes the whole suite's teardown with it.
    const bare = await prisma.level.create({
      data: {
        name: `${PLACEMENT_TAG} مستوى بلا مجموعة`,
        categoryId: placement.categoryId,
      },
    });
    const { parentId, applicationId } = await submitBundle();
    const admin = await makeAdmin("super_admin");

    const { decideChildApplication } =
      await import("./child-application.service.js");
    const result = await decideChildApplication(
      prisma,
      await actorFor(prisma, admin),
      applicationId,
      { approve: true, placement: { levelId: bare.id, branchId } },
    );

    const enrolment = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: result.childUserId!, deletedAt: null },
    });
    expect(enrolment.administrativeGroupId).toBeNull();
    // R66 — the branch is on the enrolment, which is what keeps every
    // branch-scoped rule working for a student who has no group.
    expect(enrolment.branchId).toBe(branchId);
    expect(enrolment.levelId).toBe(bare.id);

    await prisma.enrollment.deleteMany({ where: { levelId: bare.id } });
    await prisma.level.delete({ where: { id: bare.id } });
    expect(parentId).toBeTruthy();
  });
});

describe("§5.6 / TD-4.2 approval queue", () => {
  it("adult student approval atomically activates, enrolls, marks beneficiary, and grants the scoped Student role", async () => {
    const admin = await makeAdmin("super_admin");
    const applicant = await prisma.user.create({
      data: {
        nameArabic: `${TAG} مستفيدة راشدة`,
        sex: "female",
        accountStatus: "pending",
        intendedBranchId: placement.branchId,
        intendedCategoryId: placement.categoryId,
      },
    });

    await decide(prisma, await actorFor(prisma, admin), applicant.id, {
      approve: true,
      enrollments: [
        {
          userId: applicant.id,
          placement: { administrativeGroupId: placement.groupId },
        },
      ],
    });

    const approved = await prisma.user.findUniqueOrThrow({
      where: { id: applicant.id },
      include: {
        branchRoles: {
          where: { deletedAt: null },
          include: { role: true },
        },
        levelEnrollments: { where: { deletedAt: null } },
      },
    });
    expect(approved.accountStatus).toBe("active");
    expect(approved.isBeneficiary).toBe(true);
    expect(approved.levelEnrollments).toHaveLength(1);
    expect(
      approved.branchRoles.map((entry) => ({
        role: entry.role.name,
        branchId: entry.branchId,
      })),
    ).toContainEqual({ role: "student", branchId: placement.branchId });
  });

  it("rolls back activation and the Student grant when placement fails", async () => {
    const admin = await makeAdmin("super_admin");
    const applicant = await prisma.user.create({
      data: {
        nameArabic: `${TAG} تراجع ذري`,
        sex: "female",
        accountStatus: "pending",
      },
    });

    await expect(
      decide(prisma, await actorFor(prisma, admin), applicant.id, {
        approve: true,
        enrollments: [
          {
            userId: applicant.id,
            placement: { levelId: placement.levelId, branchId: randomUUID() },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(unchanged.accountStatus).toBe("pending");
    expect(unchanged.isBeneficiary).toBe(false);
    expect(await prisma.enrollment.count({ where: { studentId: applicant.id } })).toBe(0);
    expect(await prisma.userBranchRole.count({ where: { userId: applicant.id } })).toBe(0);
  });

  it("lists a parent+child registration as ONE item, with the child as a decidable block", async () => {
    const admin = await makeAdmin();
    const { parentId, applicationId } = await submitBundle();

    const page = await listApprovals(prisma, await actorFor(prisma, admin), {
      type: "registration",
    });
    const item = page.data.find((i) => i.id === parentId);

    expect(item).toBeDefined();
    // **One family, one entry** — the intent this test has always had. What
    // changed is where the child appears: R62 creates no child `User` until
    // approval, so `applicants` names only the person who exists…
    expect(item!.applicants.map((a) => a.role)).toEqual(["applicant"]);
    // …and the child is a decidable block carrying its own application id,
    // because R62.2 decides a child alone.
    expect(item!.children.map((c) => c.applicationId)).toEqual([applicationId]);
    expect(item!.bundle).toEqual({ childCount: 1, linkCount: 1 });
    expect(item!.registrationDetails?.applicant).toMatchObject({
      firstNameFrench: 'Amina',
      lastNameFrench: 'Bennani',
      nickname: 'أم مريم',
      phone: '+212600000002',
      dataProcessingConsent: { granted: true, textVersion: 'appr-test-v1' },
    });
    expect(item!.children[0]).toMatchObject({
      firstNameFrench: 'Maryam',
      lastNameFrench: 'Bennani',
      nickname: 'مريم',
      requestedCategory: { id: placement.categoryId },
      requestedBranch: { id: branchId },
      dataProcessingConsent: true,
      mediaReleaseConsent: true,
    });

    const exact = await listApprovals(prisma, await actorFor(prisma, admin), {
      reviewUserId: parentId,
    });
    expect(exact.data.map((row) => row.id)).toEqual([parentId]);
    const absent = await listApprovals(prisma, await actorFor(prisma, admin), {
      reviewUserId: randomUUID(),
    });
    expect(absent.data).toEqual([]);

    // And it is not ALSO listed as a standalone child-application item, which
    // would invite an approver to decide the same family from two places.
    const standalone = await listApprovals(
      prisma,
      await actorFor(prisma, admin),
      {
        type: "child-application",
      },
    );
    expect(
      standalone.data.some((i) =>
        i.children.some((c) => c.applicationId === applicationId),
      ),
    ).toBe(false);
  });

  it("TD-4.2 as narrowed by R62: the parent is decided ALONE", async () => {
    // **This test asserted the superseded rule.** TD-4.2 used to make approval
    // atomic across the applicant and every pending child; R62 narrows it to
    // the applicant and ONE child, decided through its own endpoint — so the
    // parent's decision here must leave the child untouched.
    const admin = await makeAdmin();
    const { parentId, applicationId } = await submitBundle();

    const result = await decide(
      prisma,
      await actorFor(prisma, admin),
      parentId,
      { approve: true },
    );
    expect(result.type).toBe("registration");

    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("active");
    // No child, no link — the application is still waiting for its own decision.
    const application = await prisma.childApplication.findUnique({
      where: { id: applicationId },
    });
    expect(application?.status).toBe("pending");
    expect(await prisma.familyLink.count({ where: { parentId } })).toBe(0);
    expect(await prisma.enrollment.count({ where: { studentId: parentId } })).toBe(0);
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.isBeneficiary).toBe(false);
    expect(await prisma.userBranchRole.count({ where: { userId: parentId } })).toBe(0);

    // …and deciding the child then creates both, without touching the parent.
    const { decideChildApplication } =
      await import("./child-application.service.js");
    const childResult = await decideChildApplication(
      prisma,
      await actorFor(prisma, admin),
      applicationId,
      // R64.5 — approving a child places it, exactly as approving a
      // registration always has (§4.1).
      {
        approve: true,
        placement: { administrativeGroupId: placement.groupId },
      },
    );
    const link = await prisma.familyLink.findFirst({
      where: { parentId, studentId: childResult.childUserId! },
    });
    expect(link?.status).toBe("approved");
    expect(link?.decidedById).toBe(admin);

    // Once the exact parent registration and every child application are
    // terminal, an old notification coordinate fails closed to no review row.
    const stale = await listApprovals(prisma, await actorFor(prisma, admin), {
      reviewUserId: parentId,
    });
    expect(stale.data).toEqual([]);

    const row = await prisma.auditLog.findFirst({
      where: { targetId: parentId, actionType: "user.approve" },
    });
    expect(row).not.toBeNull();
    // Zero: R62 moved child activation out of this decision entirely.
    expect((row!.detail as Record<string, unknown>)["children_activated"]).toBe(
      0,
    );
  });

  it("R117 keeps requested Category and Branch exact for each sibling", async () => {
    const admin = await makeAdmin();
    const otherCategory = await prisma.category.create({
      data: { name: `${TAG} فئة أخرى` },
    });
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: 'parent_child',
        parent: {
          first_name_arabic: TAG,
          last_name_arabic: 'والدة طفلين',
          phone: '+212600000030',
          sex: 'female',
        },
        children: [
          {
            first_name_arabic: TAG,
            last_name_arabic: 'الأولى',
            sex: 'female',
            birth_date: new Date("2015-04-12T00:00:00Z"),
            requested_branch_id: branchId,
            requested_category_id: placement.categoryId,
            consent_media_release: true,
          },
          {
            first_name_arabic: TAG,
            last_name_arabic: 'الثانية',
            sex: 'female',
            birth_date: new Date("2016-07-19T00:00:00Z"),
            requested_branch_id: otherBranchId,
            requested_category_id: otherCategory.id,
            consent_media_release: false,
          },
        ],
        consents: { data_processing: true, consent_text_id: consentText!.id },
      },
      KEY,
    );

    const exact = await listApprovals(prisma, await actorFor(prisma, admin), {
      reviewUserId: result.applicantId,
    });
    expect(exact.data).toHaveLength(1);
    expect(exact.data[0]!.branch).toBeNull();
    expect(exact.data[0]!.category).toBeNull();
    expect(
      exact.data[0]!.children.map((child) => [
        child.requestedBranch?.id,
        child.requestedCategory?.id,
      ]),
    ).toEqual([
      [branchId, placement.categoryId],
      [otherBranchId, otherCategory.id],
    ]);
  });

  it("rejecting the parent leaves each child its OWN decision (R62)", async () => {
    // The superseded rule rejected the family together. R62 makes the parent's
    // application explicitly separate — *"never inferred from the children's
    // outcomes"* — which cuts both ways: a refused parent does not refuse the
    // children, and an approver must still answer for each.
    const admin = await makeAdmin();
    const { parentId, applicationId } = await submitBundle();

    await decide(prisma, await actorFor(prisma, admin), parentId, {
      approve: false,
      reason: "بيانات غير مكتملة",
    });

    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("rejected");
    // Still pending, and still decidable — nothing was inferred.
    expect(
      (
        await prisma.childApplication.findUnique({
          where: { id: applicationId },
        })
      )?.status,
    ).toBe("pending");
    // And no link exists to be half-decided, because none is created until a
    // child is approved.
    expect(await prisma.familyLink.count({ where: { parentId } })).toBe(0);
    // A Rejected account has no authenticated inbox by TD-1. Its status screen
    // communicates this decision; persisting an unreadable row would falsely
    // claim delivery and could surface stale data after later staff recovery.
    expect(
      await prisma.notification.count({
        where: { userId: parentId, subjectUserId: parentId },
      }),
    ).toBe(0);
  });

  it("rejection without a reason is refused (§5.6, §14.2)", async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();
    await expect(
      decide(prisma, await actorFor(prisma, admin), parentId, {
        approve: false,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    // Nothing decided.
    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("pending");
  });

  it("TD-15.3: double-approval — first wins, second gets STATE_CONFLICT", async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();

    await decide(prisma, await actorFor(prisma, admin), parentId, {
      approve: true,
    });
    await expect(
      decide(prisma, await actorFor(prisma, admin), parentId, {
        approve: true,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("§14.2 R39: branch_id narrows the queue, and meta.total follows the filter", async () => {
    const admin = await makeAdmin();
    const here = await submitBundle(branchId);
    const elsewhere = await submitBundle(otherBranchId);

    const filtered = await listApprovals(
      prisma,
      await actorFor(prisma, admin),
      { branchId },
    );
    const ids = filtered.data.map((i) => i.id);
    expect(ids).toContain(here.parentId);
    expect(ids).not.toContain(elsewhere.parentId);
    // A total that ignored the filter would tell a client to render empty pages.
    expect(filtered.meta.total).toBe(ids.length);

    // And the item carries WHICH branch was asked for, not merely that one was.
    const item = filtered.data.find((i) => i.id === here.parentId)!;
    expect(item.branch?.id).toBe(branchId);
  });

  it("R39: the requested branch never decides the placement", async () => {
    const admin = await makeAdmin();
    const { parentId, applicationId } = await submitBundle(branchId);
    // The approver places the child at the fixture's branch, which is NOT the
    // one the family asked for — that is the whole distinction R39 draws
    // between a request and a placement, and it survives R62 moving placement
    // onto the child's own decision.
    await decide(prisma, await actorFor(prisma, admin), parentId, {
      approve: true,
    });
    const { decideChildApplication } =
      await import("./child-application.service.js");
    const child = await decideChildApplication(
      prisma,
      await actorFor(prisma, admin),
      applicationId,
      {
        approve: true,
        placement: { administrativeGroupId: placement.groupId },
      },
    );

    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("active");
    expect(
      await prisma.userBranchRole.count({
        where: { userId: parentId, role: { name: { not: "parent" } } },
      }),
    ).toBe(0);
    // The PARENT is not a student and is never enrolled; the child is.
    expect(
      await prisma.enrollment.count({ where: { studentId: parentId } }),
    ).toBe(0);
    const enrolment = await prisma.enrollment.findFirstOrThrow({
      where: { studentId: child.childUserId! },
    });
    expect(enrolment.administrativeGroupId).toBe(placement.groupId);
    expect(enrolment.levelId).toBe(placement.levelId);
    // The request itself survives approval — it is the record of what was asked.
    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.intendedBranchId,
    ).toBe(branchId);
  });

  it("TD-15.3: two admins approving concurrently activate exactly once", async () => {
    const a1 = await makeAdmin();
    const a2 = await makeAdmin();
    const { parentId } = await submitBundle();

    const results = await Promise.allSettled([
      decide(prisma, await actorFor(prisma, a1), parentId, { approve: true }),
      decide(prisma, await actorFor(prisma, a2), parentId, { approve: true }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // A benign outcome, never a 500 (TD-15.3).
    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("active");
    expect(
      await prisma.auditLog.count({
        where: { targetId: parentId, actionType: "user.approve" },
      }),
    ).toBe(1);
  });

  it("TD-12 freshness: an admin suspended mid-session loses approval power at once", async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();

    // The token is still perfectly valid; only the database row changed.
    await prisma.user.update({
      where: { id: admin },
      data: { accountStatus: "suspended" },
    });

    await expect(
      decide(prisma, await actorFor(prisma, admin), parentId, {
        approve: true,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      (await prisma.user.findUnique({ where: { id: parentId } }))
        ?.accountStatus,
    ).toBe("pending");
  });

  it("TD-12 freshness: a REVOKED role assignment loses approval power at once", async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();

    // Still Active, but the admin role row is gone — TD-12 requires the invoked
    // assignment to still exist, not merely to have existed at token issue.
    await prisma.userBranchRole.deleteMany({ where: { userId: admin } });

    await expect(
      decide(prisma, await actorFor(prisma, admin), parentId, {
        approve: true,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("TD-2: a non-admin cannot approve, and cannot even list", async () => {
    const teacher = await makeAdmin("teacher");
    const { parentId } = await submitBundle();

    await expect(
      listApprovals(prisma, await actorFor(prisma, teacher), {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      decide(prisma, await actorFor(prisma, teacher), parentId, {
        approve: true,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("an unknown id is NOT_FOUND, not a 500 or a silent success", async () => {
    const admin = await makeAdmin();
    await expect(
      decide(
        prisma,
        await actorFor(prisma, admin),
        "11111111-2222-4333-8444-555555555555",
        { approve: true },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("TD-10: pagination envelope with default 25 and max 100", async () => {
    const admin = await makeAdmin();
    await submitBundle();
    const page = await listApprovals(prisma, await actorFor(prisma, admin), {
      pageSize: 500,
    });
    expect(page.meta.page_size).toBe(100);
    expect(page.meta.page).toBe(1);
    expect(typeof page.meta.total).toBe("number");
  });
});
