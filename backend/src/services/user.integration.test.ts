import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { actorFor } from "../test-support/actor.js";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import * as userRepo from "../repositories/user.repository.js";
import { listDirectory, listUsers, preProvision } from "./user.service.js";

/**
 * Staff pre-provisioning (§3.1, §4.1b step 4b, §5.6, §7 Revision 15).
 *
 * The property that matters is not "a row was written" — it is that the account
 * is **claimable by exactly one Google address and by nobody else**, and that it
 * carries **no identity** until that address logs in. Both are asserted through
 * the same repository the login flow uses, so these tests exercise the real
 * resolution path rather than a parallel one.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const RUN = randomUUID();
const TAG = `[preprov-test:${RUN}]`;

let seq = 0;
const addr = () => {
  seq += 1;
  return `preprov-${RUN}-${Date.now()}-${seq}@example.com`;
};

async function makeStaff(role: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${role}`,
      accountStatus: "active",
    },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return user.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { nameArabic: { startsWith: TAG } },
        { preProvisionedEmail: { startsWith: `preprov-${RUN}-` } },
      ],
    },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // The search tests link a parent to a child, and FamilyLink references both
  // under RESTRICT — so the links must go before the people do.
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.normalizedEmailLock.deleteMany({
    where: { email: { startsWith: "preprov-" } },
  });
  // Branches created for the scope filter tests.
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("§4.1b step 4b — staff pre-provisioning", () => {
  it("creates a claimable account with NO identity row (§7 forbids placeholders)", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();

    const created = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة`,
      email,
      // R80.1 — every creation path records a sex.
      sex: "female",
    });

    expect(created.accountStatus).toBe("pending");
    expect(created.preProvisionedEmail).toBe(email);
    // The account exists but nobody has authenticated as it yet. A stub identity
    // here would break the "has an identity ⇒ has authenticated" predicate.
    expect(
      await prisma.userIdentity.count({ where: { userId: created.id } }),
    ).toBe(0);
  });

  it("is findable by the LOGIN path's own lookup, which is what makes it claimable", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();
    const created = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة`,
      email,
      // R80.1 — every creation path records a sex.
      sex: "female",
    });

    // Exercised through the repository §4.1b step 3.2 actually calls.
    const resolved = await userRepo.findByPreProvisionedEmail(prisma, email);
    expect(resolved?.user.id).toBe(created.id);
  });

  it("binds on first login and then resolves by identity forever after (TD-4.10)", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();
    const created = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة`,
      email,
      // R80.1 — every creation path records a sex.
      sex: "female",
    });
    const subject = `preprov-sub-${Date.now()}`;

    // First login: the fallback finds it, then the binding is created.
    await userRepo.bindIdentity(prisma, {
      userId: created.id,
      provider: "google",
      providerSubjectId: subject,
      email,
    });

    // Every later login resolves at step 3.1 by provider identity.
    const byIdentity = await userRepo.findByProviderIdentity(
      prisma,
      "google",
      subject,
    );
    expect(byIdentity?.user.id).toBe(created.id);

    // §7: the column is RETAINED, not cleared, so provenance survives and the
    // address cannot be handed to a second account afterwards.
    const after = await prisma.user.findUnique({ where: { id: created.id } });
    expect(after?.preProvisionedEmail).toBe(email);
    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} منتحلة`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("lowercases the address, so a capitalised entry is still claimable (TD-12)", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();
    const created = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email: `  ${email.toUpperCase()}  `,
    });

    expect(created.preProvisionedEmail).toBe(email);
    // Google returns the address lowercased, so this is what first login sees.
    expect(
      await userRepo.findByPreProvisionedEmail(prisma, email),
    ).not.toBeNull();
  });

  it("refuses a second account for the same address (TD-6 partial unique index)", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();
    await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} الأولى`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email,
    });

    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} الثانية`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: email } }),
    ).toBe(1);
  });

  it("will not silently reclaim a SOFT-DELETED account's address", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();
    const first = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} مغادرة`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email,
    });
    await prisma.user.update({
      where: { id: first.id },
      data: { deletedAt: new Date() },
    });

    // The TD-6 index spans deleted rows, so the address stays spoken for —
    // §4.1 forbids a deleted person being silently re-created.
    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} أخرى`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("assigns a role and branch scope in the same transaction", async () => {
    const admin = await makeStaff("super_admin");
    const branch = await prisma.branch.create({
      data: {
        name: `${TAG} فرع`,
        operationalStartDate: new Date("2026-01-01"),
      },
    });

    const created = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email: addr(),
      role: "teacher",
      branchId: branch.id,
    });

    const assignment = await prisma.userBranchRole.findFirst({
      where: { userId: created.id },
      include: { role: true },
    });
    expect(assignment?.role.name).toBe("teacher");
    expect(assignment?.branchId).toBe(branch.id);

    await prisma.userBranchRole.deleteMany({ where: { userId: created.id } });
    await prisma.user.deleteMany({ where: { id: created.id } });
    await prisma.branch.delete({ where: { id: branch.id } });
  });

  it("rejects an unknown branch scope, creating nothing", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();

    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} معلمة`,
        email,
        // R80.1 — every creation path records a sex.
        sex: "female",
        role: "teacher",
        branchId: "11111111-2222-4333-8444-555555555555",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The whole thing is one transaction: no orphan user may survive.
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: email } }),
    ).toBe(0);
  });

  it("§4.1b 4b: pre_approved yields Active, default yields Pending", async () => {
    const admin = await makeStaff("super_admin");
    const pending = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} أ`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email: addr(),
    });
    const active = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} ب`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email: addr(),
      preApproved: true,
    });

    expect(pending.accountStatus).toBe("pending");
    expect(active.accountStatus).toBe("active");
  });

  it("TD-2: a teacher cannot pre-provision", async () => {
    const teacher = await makeStaff("teacher");
    const email = addr();
    await expect(
      preProvision(prisma, await actorFor(prisma, teacher), {
        nameArabic: `${TAG} معلمة`,
        email,
        // R80.1 — every creation path records a sex.
        sex: "female",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: email } }),
    ).toBe(0);
  });

  it("an Admin cannot pre-provision AT ALL; a Super Admin can create an Admin", async () => {
    /**
     * **Restated 2026-08-28 — the Owner widened the refusal, so the assertion
     * widened with it.**
     *
     * This read *"an Admin cannot create another **Admin**"*: role escalation
     * was the danger, because an Admin could pre-provision everyone else.
     * Account administration is now Super Admin's entirely, so the narrower
     * property is subsumed — an Admin creates nobody, of any role — and
     * asserting only the escalation case would now pass for the wrong reason.
     */
    const admin = await makeStaff("admin");
    const superAdmin = await makeStaff("super_admin");

    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} مشرفة`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email: addr(),
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // ...and not merely the privileged role. An ordinary student is refused too.
    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} مستفيدة`,
        sex: "female",
        email: addr(),
        role: "student",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const created = await preProvision(
      prisma,
      await actorFor(prisma, superAdmin),
      {
        nameArabic: `${TAG} مشرفة`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email: addr(),
        role: "admin",
      },
    );
    expect(created.id).toBeTruthy();
  });

  it("TD-12: an admin suspended mid-session cannot pre-provision", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();
    await prisma.user.update({
      where: { id: admin },
      data: { accountStatus: "suspended" },
    });

    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} معلمة`,
        email,
        // R80.1 — every creation path records a sex.
        sex: "female",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: email } }),
    ).toBe(0);
  });

  it("writes an attributable audit row", async () => {
    const admin = await makeStaff("super_admin");
    const email = addr();
    const created = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة`,
      email,
      // R80.1 — every creation path records a sex.
      sex: "female",
      role: "teacher",
    });

    const row = await prisma.auditLog.findFirst({
      where: { targetId: created.id, actionType: "user.create" },
    });
    expect(row?.actorUserId).toBe(admin);
    const detail = row!.detail as Record<string, unknown>;
    expect(detail["identity_channel"]).toBe("pre_provisioned");
    expect(detail).not.toHaveProperty("pre_provisioned_email");
    expect(JSON.stringify(detail)).not.toContain(email);
    expect(detail["role"]).toBe("teacher");
  });
});

describe("an email is claimed by at most one live account", () => {
  it("refuses pre-provisioning an address that has ALREADY SIGNED IN", async () => {
    // **The defect, reproduced.** `pre_provisioned_email` is unique among
    // itself, but an account that has signed in carries its address on
    // `UserIdentity` and may have no pre-provisioned value at all — so this
    // collided with nothing and answered 201, leaving two live accounts
    // claiming one address for §4.1b's binding step to choose between.
    const admin = await makeStaff("super_admin");
    const email = addr();

    const signedIn = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} صاحبة الحساب`,
        accountStatus: "active",
      },
    });
    await prisma.userIdentity.create({
      data: {
        userId: signedIn.id,
        provider: "google",
        providerSubjectId: `${TAG}-${email}`,
        email,
        isActive: true,
      },
    });

    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} مكررة`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });

    // …and nothing was created: the refusal is not a partial write.
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: email } }),
    ).toBe(0);
  });

  it("still refuses a second PRE-PROVISIONED account for one address", async () => {
    // The half the partial unique index already covered, asserted so the new
    // check cannot be mistaken for a replacement of it.
    const admin = await makeStaff("super_admin");
    const email = addr();
    await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} أولى`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email,
    });
    await expect(
      preProvision(prisma, await actorFor(prisma, admin), {
        nameArabic: `${TAG} ثانية`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("permits an address whose only identity is INACTIVE", async () => {
    // A deactivated identity is not a claim: §4.1b deactivates rather than
    // deletes, and refusing here would make an address permanently unusable.
    const admin = await makeStaff("super_admin");
    const email = addr();
    const past = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} حساب سابق`,
        accountStatus: "suspended",
      },
    });
    await prisma.userIdentity.create({
      data: {
        userId: past.id,
        provider: "google",
        providerSubjectId: `${TAG}-old-${email}`,
        email,
        isActive: false,
      },
    });

    const created = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} جديدة`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email,
    });
    expect(created.preProvisionedEmail).toBe(email);
  });
});

describe("§14.2 / TD-10 — user list, filters and search", () => {
  /** Seeds a person and returns their id; the trigger fills the shadow columns. */
  async function person(fields: {
    nameArabic: string;
    nameFrench?: string;
    nickname?: string;
    phone?: string;
    status?: string;
  }): Promise<string> {
    const user = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} ${fields.nameArabic}`,
        ...(fields.nameFrench ? { nameFrench: fields.nameFrench } : {}),
        ...(fields.nickname ? { nickname: fields.nickname } : {}),
        ...(fields.phone ? { phone: fields.phone } : {}),
        accountStatus: (fields.status ?? "active") as never,
      },
    });
    return user.id;
  }

  const idsOf = (page: { data: { id: string }[] }) =>
    page.data.map((u) => u.id);

  it("TD-10: substring match, not prefix — سعاد finds أم سعاد", async () => {
    const admin = await makeStaff("super_admin");
    const target = await person({ nameArabic: "أم سعاد" });

    const page = await listUsers(prisma, await actorFor(prisma, admin), {
      q: "سعاد",
    });
    expect(idsOf(page)).toContain(target);
  });

  it("TD-10: alef, ta-marbuta and tashkeel variants all unify", async () => {
    const admin = await makeStaff("super_admin");
    const ahmed = await person({ nameArabic: "أحمد" });
    const fatima = await person({ nameArabic: "فاطمة" });
    const muhammad = await person({ nameArabic: "مُحَمَّد" });

    // Typed without the hamza, without the ta-marbuta, without diacritics.
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), { q: "احمد" }),
      ),
    ).toContain(ahmed);
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), { q: "فاطمه" }),
      ),
    ).toContain(fatima);
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), { q: "محمد" }),
      ),
    ).toContain(muhammad);
  });

  it("TD-10: French names fold accents and ignore case", async () => {
    const admin = await makeStaff("super_admin");
    const aicha = await person({ nameArabic: "عائشة", nameFrench: "Aïcha" });

    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), { q: "aicha" }),
      ),
    ).toContain(aicha);
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), { q: "AICHA" }),
      ),
    ).toContain(aicha);
  });

  it("TD-10: nickname and phone are searchable, phone ignoring spaces and +", async () => {
    const admin = await makeStaff("super_admin");
    const target = await person({
      nameArabic: "خديجة",
      nickname: "أم يوسف",
      phone: "+212 612 345 678",
    });

    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), { q: "يوسف" }),
      ),
    ).toContain(target);
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), {
          q: "0612345678".slice(1),
        }),
      ),
    ).toContain(target);
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), {
          q: "+212612345678",
        }),
      ),
    ).toContain(target);
  });

  it("TD-10 Revision 15: email search spans BOTH channels", async () => {
    const admin = await makeStaff("super_admin");
    // An unclaimed account: no identity row exists yet.
    const unclaimed = await preProvision(
      prisma,
      await actorFor(prisma, admin),
      {
        nameArabic: `${TAG} غير مرتبطة`,
        // R80.1 — every creation path records a sex.
        sex: "female",
        email: "findme-unclaimed@example.com",
      },
    );
    // A bound account: the address lives on UserIdentity.
    const bound = await person({ nameArabic: "مرتبطة" });
    await prisma.userIdentity.create({
      data: {
        userId: bound,
        provider: "google",
        providerSubjectId: `find-sub-${Date.now()}`,
        email: "findme-bound@example.com",
      },
    });

    // Searching only UserIdentity would hide exactly the accounts staff most
    // need to find — the ones nobody has claimed yet.
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), {
          q: "findme-unclaimed",
        }),
      ),
    ).toContain(unclaimed.id);
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), {
          q: "findme-bound",
        }),
      ),
    ).toContain(bound);
  });

  it("TD-10: a child is findable by their linked PARENT's name", async () => {
    const admin = await makeStaff("super_admin");
    const parent = await person({ nameArabic: "والدة بديعة" });
    const child = await person({ nameArabic: "طفلة" });
    await prisma.familyLink.create({
      data: { parentId: parent, studentId: child, status: "approved" },
    });

    const page = await listUsers(prisma, await actorFor(prisma, admin), {
      q: "بديعة",
    });
    expect(idsOf(page)).toContain(child);
  });

  it("TD-10: a one-character query is refused", async () => {
    const admin = await makeStaff("super_admin");
    await expect(
      listUsers(prisma, await actorFor(prisma, admin), { q: "س" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("§14.2 filters: role, branch and status", async () => {
    const admin = await makeStaff("super_admin");
    const branch = await prisma.branch.create({
      data: {
        name: `${TAG} فرع`,
        operationalStartDate: new Date("2026-01-01"),
      },
    });
    const teacher = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة مرشحة`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email: addr(),
      role: "teacher",
      branchId: branch.id,
      preApproved: true,
    });
    const plain = await person({ nameArabic: "بدون دور", status: "pending" });

    const byRole = await listUsers(prisma, await actorFor(prisma, admin), {
      role: "teacher",
    });
    expect(idsOf(byRole)).toContain(teacher.id);
    expect(idsOf(byRole)).not.toContain(plain);

    const byBranch = await listUsers(prisma, await actorFor(prisma, admin), {
      branchId: branch.id,
    });
    expect(idsOf(byBranch)).toEqual([teacher.id]);

    const byStatus = await listUsers(prisma, await actorFor(prisma, admin), {
      status: "pending",
    });
    expect(idsOf(byStatus)).toContain(plain);
    expect(idsOf(byStatus)).not.toContain(teacher.id);

    await prisma.userBranchRole.deleteMany({ where: { userId: teacher.id } });
    await prisma.user.deleteMany({ where: { id: teacher.id } });
    await prisma.branch.delete({ where: { id: branch.id } });
  });

  it("a REVOKED role no longer keeps someone in a role-filtered list", async () => {
    const admin = await makeStaff("super_admin");
    const teacher = await preProvision(prisma, await actorFor(prisma, admin), {
      nameArabic: `${TAG} معلمة سابقة`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email: addr(),
      role: "teacher",
    });
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), {
          role: "teacher",
        }),
      ),
    ).toContain(teacher.id);

    await prisma.userBranchRole.updateMany({
      where: { userId: teacher.id },
      data: { deletedAt: new Date() },
    });
    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), {
          role: "teacher",
        }),
      ),
    ).not.toContain(teacher.id);
  });

  it("soft-deleted people are not listed", async () => {
    const admin = await makeStaff("super_admin");
    const gone = await person({ nameArabic: "مغادرة تماما" });
    await prisma.user.update({
      where: { id: gone },
      data: { deletedAt: new Date() },
    });

    expect(
      idsOf(
        await listUsers(prisma, await actorFor(prisma, admin), { q: "مغادرة" }),
      ),
    ).not.toContain(gone);
  });

  it("§4.10: the list never carries StudentSocialProfile fields", async () => {
    const admin = await makeStaff("super_admin");
    await person({ nameArabic: "طالبة" });
    const page = await listUsers(prisma, await actorFor(prisma, admin), {});

    // §14.2 fixes the columns; anything §4.10 restricts to assigned teachers
    // must not ride along on a list every Admin can call.
    //
    // `publicDisplayName` joined deliberately in Revision 36.1: it is a name
    // the person chose to PUBLISH, so it is less sensitive than the legal name
    // already on this row, and staff need to see who has set one. This
    // assertion is the review gate for that kind of addition — a field must be
    // argued onto the list, never arrive on it by accident.
    //
    // `version` joined deliberately when the Users screen gained edit,
    // suspend and role assignment: TD-15 requires the value the form loaded to
    // travel back on the write. Publishing it here is what let that screen
    // reuse this list — the alternative was a single-user read returning these
    // same fields plus one, which is a second projection of one concept kept in
    // step by hand. It is a row's revision counter, not information about a
    // person, so §4.10 has no view on it.
    for (const row of page.data) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "accountStatus",
          // R55 — the administrative identifier §14.2 now lists. NOT a display
          // identity (§20 rule 21), which governs the PUBLIC name only.
          "email",
          "id",
          "nameArabic",
          "nickname",
          "phone",
          "publicDisplayName",
          "roles",
          "version",
          /**
           * **Argued onto the list on 2026-08-28, not arrived by accident.**
           *
           * `firstNameArabic` / `lastNameArabic` / `firstNameFrench` /
           * `lastNameFrench` are **the parts of the legal name already on this
           * row**: §1.1 composes `nameArabic` from them, so publishing the
           * composed value and withholding its halves protected nothing. The
           * §5.6 edit form hydrates from them, and the alternative — a
           * single-user read returning these same fields plus the parts — is
           * the second projection this comment already rejects.
           *
           * **`sex` — R80 point 6 amended by the Document Owner, 2026-08-28.**
           * That clause read *«stays off every contract»* and was written when
           * this list was reachable by any Admin. R112 made it Super-Admin-only,
           * and the Owner's decision is that a Super Admin reads and edits
           * everything about an account. It is published **here and nowhere
           * else** — `/admin/directory`, the Admin-reachable surface, still does
           * not carry it, which the directory's own key assertion pins.
           *
           * `notes` is the registration free text — **not** a
           * `StudentSocialProfile` field, which is what §4.10 restricts to
           * assigned teachers and which still appears nowhere here. The premise
           * this assertion was written under has also changed: **R112 made
           * `listUsers` Super-Admin-only**, so this is no longer "a list every
           * Admin can call". An Admin doing operational work reads
           * `/admin/directory`, which carries id, name, nickname and roles —
           * and none of these six.
           */
          "firstNameArabic",
          "lastNameArabic",
          "firstNameFrench",
          "lastNameFrench",
          "sex",
          "notes",
        ].sort(),
      );
    }
  });

  it("TD-10 envelope: default 25, max 100, stable ordering", async () => {
    const admin = await makeStaff("super_admin");
    const page = await listUsers(prisma, await actorFor(prisma, admin), {});
    expect(page.meta.page_size).toBe(25);
    expect(page.meta.page).toBe(1);

    expect(
      (
        await listUsers(prisma, await actorFor(prisma, admin), {
          pageSize: 500,
        })
      ).meta.page_size,
    ).toBe(100);

    // Same query twice must return the same order (id tiebreaker).
    const a = await listUsers(prisma, await actorFor(prisma, admin), {
      pageSize: 10,
    });
    const b = await listUsers(prisma, await actorFor(prisma, admin), {
      pageSize: 10,
    });
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it("TD-2: a teacher cannot browse the user list", async () => {
    const teacher = await makeStaff("teacher");
    await expect(
      listUsers(prisma, await actorFor(prisma, teacher), {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/**
 * **§4.2 Revision 25's branch scoping, asserted where an Admin can still reach
 * it** (restated 2026-08-28).
 *
 * These read `listUsers` until the Owner made global account administration
 * Super Admin's alone. The rule they protect did not change and is not weakened:
 * it is the *same query*, shared by both surfaces precisely so the two cannot
 * drift on which rows a branch-scoped caller may see. What changed is which
 * function an Admin may call — so the assertions moved to `listDirectory`, where
 * an Admin is authorized and the scoping still decides the answer.
 *
 * That an Admin is refused `listUsers` outright is asserted at the HTTP boundary
 * in `user-management.http.integration.test.ts`, with forged requests.
 */
describe("§4.2 Revision 25 — directory visibility is branch-scoped", () => {
  /** An admin scoped to specific branches, or to all when `branchIds` is empty. */
  async function scopedAdmin(branchIds: string[]): Promise<string> {
    const user = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} مشرفة مجالية`,
        accountStatus: "active",
      },
    });
    const roleRow = await prisma.role.findUnique({ where: { name: "admin" } });
    if (branchIds.length === 0) {
      await prisma.userBranchRole.create({
        data: { userId: user.id, roleId: roleRow!.id, branchId: null },
      });
    } else {
      for (const branchId of branchIds) {
        await prisma.userBranchRole.create({
          data: { userId: user.id, roleId: roleRow!.id, branchId },
        });
      }
    }
    return user.id;
  }

  async function branch(name: string): Promise<string> {
    const b = await prisma.branch.create({
      data: {
        name: `${TAG} ${name}`,
        operationalStartDate: new Date("2026-01-01"),
      },
    });
    return b.id;
  }

  async function memberOf(branchId: string, role = "teacher"): Promise<string> {
    const u = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} منتسبة`,
        accountStatus: "active",
      },
    });
    const roleRow = await prisma.role.findUnique({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: u.id, roleId: roleRow!.id, branchId },
    });
    return u.id;
  }

  const idsOf = (page: { data: { id: string }[] }) =>
    page.data.map((u) => u.id);

  it("a branch-scoped Admin sees their own branch and NOT another", async () => {
    const marrakesh = await branch("مراكش");
    const casablanca = await branch("الدار البيضاء");
    const mine = await memberOf(marrakesh);
    const theirs = await memberOf(casablanca);
    const admin = await scopedAdmin([marrakesh]);

    const ids = idsOf(
      await listDirectory(prisma, await actorFor(prisma, admin), {}),
    );
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("unassigned people are invisible to a branch-scoped Admin", async () => {
    const marrakesh = await branch("مراكش");
    const admin = await scopedAdmin([marrakesh]);
    // A parent, an unassigned student, and a pre-provisioned account.
    const parent = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} والدة`,
        accountStatus: "active",
      },
    });
    // **Created by a Super Admin, read by the branch Admin.** Pre-provisioning is
    // account administration (2026-08-28) and is only a fixture step here; the
    // actor under test is the branch-scoped Admin doing the reading.
    const creator = await makeStaff("super_admin");
    const preprov = await preProvision(prisma, await actorFor(prisma, creator), {
      nameArabic: `${TAG} غير منتسبة`,
      // R80.1 — every creation path records a sex.
      sex: "female",
      email: addr(),
    });

    const ids = idsOf(
      await listDirectory(prisma, await actorFor(prisma, admin), {}),
    );
    expect(ids).not.toContain(parent.id);
    expect(ids).not.toContain(preprov.id);
  });

  it("a Super Admin sees the unassigned people a branch Admin cannot", async () => {
    const marrakesh = await branch("مراكش");
    const branchAdmin = await scopedAdmin([marrakesh]);
    const superAdmin = await makeStaff("super_admin");
    const parent = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} والدة`,
        accountStatus: "active",
      },
    });

    expect(
      idsOf(await listDirectory(prisma, await actorFor(prisma, branchAdmin), {})),
    ).not.toContain(parent.id);
    expect(
      idsOf(await listUsers(prisma, await actorFor(prisma, superAdmin), {})),
    ).toContain(parent.id);
  });

  it("an all-branches (NULL) Admin sees everyone, assigned or not", async () => {
    const marrakesh = await branch("مراكش");
    const assigned = await memberOf(marrakesh);
    const unassigned = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} بلا فرع`,
        accountStatus: "active",
      },
    });
    const admin = await scopedAdmin([]); // branch_id NULL = all branches

    const ids = idsOf(
      await listDirectory(prisma, await actorFor(prisma, admin), {}),
    );
    expect(ids).toContain(assigned);
    expect(ids).toContain(unassigned.id);
  });

  it("an ALL-BRANCHES Admin sees every branch; a single-branch one sees only theirs", async () => {
    /**
     * **Restated 2026-08-28 — the Owner changed the model, not the code.**
     *
     * This read *"an Admin scoped to several branches sees all of them"* and
     * built that scope as **two assignments of the same role**. A role is now
     * held once per account (`user_branch_role_one_live_role_per_user`), so a
     * scope is either **one branch or all of them** and the two-row form no
     * longer exists to test.
     *
     * The property §4.2 R25 actually protects is unchanged and is what this
     * asserts: an unscoped Admin reaches everyone, and a scoped one reaches
     * their own branch and no other.
     */
    const marrakesh = await branch("مراكش");
    const casablanca = await branch("الدار البيضاء");
    const a = await memberOf(marrakesh);
    const b = await memberOf(casablanca);

    const everywhere = await scopedAdmin([]); // branch_id NULL — all branches
    const everywhereIds = idsOf(
      await listDirectory(prisma, await actorFor(prisma, everywhere), {}),
    );
    expect(everywhereIds).toEqual(expect.arrayContaining([a, b]));

    const oneBranch = await scopedAdmin([marrakesh]);
    const oneBranchIds = idsOf(
      await listDirectory(prisma, await actorFor(prisma, oneBranch), {}),
    );
    expect(oneBranchIds).toContain(a);
    expect(oneBranchIds).not.toContain(b);
  });

  it("the branch FILTER cannot reach outside the Admin's own scope", async () => {
    const marrakesh = await branch("مراكش");
    const casablanca = await branch("الدار البيضاء");
    const theirs = await memberOf(casablanca);
    const admin = await scopedAdmin([marrakesh]);

    // Asking explicitly for another branch must narrow, never widen.
    const ids = idsOf(
      await listDirectory(prisma, await actorFor(prisma, admin), {
        branchId: casablanca,
      }),
    );
    expect(ids).not.toContain(theirs);
    expect(ids).toEqual([]);
  });

  it("SEARCH cannot reach outside scope either", async () => {
    const marrakesh = await branch("مراكش");
    const casablanca = await branch("الدار البيضاء");
    const outsider = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} سعاد الغريبة`,
        accountStatus: "active",
      },
    });
    const roleRow = await prisma.role.findUnique({
      where: { name: "teacher" },
    });
    await prisma.userBranchRole.create({
      data: { userId: outsider.id, roleId: roleRow!.id, branchId: casablanca },
    });
    const admin = await scopedAdmin([marrakesh]);

    // A name search must not become a way around the scope.
    expect(
      idsOf(
        await listDirectory(prisma, await actorFor(prisma, admin), { q: "سعاد" }),
      ),
    ).not.toContain(outsider.id);
  });

  it("a REVOKED assignment removes the user from that branch Admin's view", async () => {
    // Visibility must follow live assignments. A soft-deleted assignment that
    // still granted visibility would mean revoking someone from a branch left
    // their record exposed to that branch's administrator indefinitely.
    const marrakesh = await branch("مراكش");
    const member = await memberOf(marrakesh);
    const admin = await scopedAdmin([marrakesh]);

    expect(
      idsOf(await listDirectory(prisma, await actorFor(prisma, admin), {})),
    ).toContain(member);

    await prisma.userBranchRole.updateMany({
      where: { userId: member },
      data: { deletedAt: new Date() },
    });

    expect(
      idsOf(await listDirectory(prisma, await actorFor(prisma, admin), {})),
    ).not.toContain(member);
  });

  it("scope comes from the ADMIN role only, not from another role the caller holds", async () => {
    // §4.2's per-role rule applied to browsing: being a Teacher in Casablanca
    // must not let this person browse Casablanca's users as an Admin.
    const marrakesh = await branch("مراكش");
    const casablanca = await branch("الدار البيضاء");
    const casaMember = await memberOf(casablanca);

    const dual = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} مزدوجة`,
        accountStatus: "active",
      },
    });
    const adminRole = await prisma.role.findUnique({
      where: { name: "admin" },
    });
    const teacherRole = await prisma.role.findUnique({
      where: { name: "teacher" },
    });
    await prisma.userBranchRole.create({
      data: { userId: dual.id, roleId: adminRole!.id, branchId: marrakesh },
    });
    await prisma.userBranchRole.create({
      data: { userId: dual.id, roleId: teacherRole!.id, branchId: casablanca },
    });

    expect(
      idsOf(await listDirectory(prisma, await actorFor(prisma, dual.id), {})),
    ).not.toContain(casaMember);
  });
});
