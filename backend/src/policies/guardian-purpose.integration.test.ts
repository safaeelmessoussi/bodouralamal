import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { accountPurposes } from './guardian-purpose.js';

/**
 * **Does this account still have a reason to exist?** (SRS §4.3, Revision 131.)
 *
 * The guard, not the closure. §4.3 closes a guardian-only account when its last
 * child-management purpose is deliberately removed and nothing else remains —
 * and **the failure mode is closing an account that still had a purpose**, which
 * is why the predicate is inclusive and why it is tested on its own before any
 * trigger exists.
 *
 * The asymmetry is deliberate: a missed purpose closes an account that should
 * have lived; a spurious one merely leaves an account alive.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[guardian-purpose-test]';

let counter = 0;

async function makeUser(label: string, beneficiary = false): Promise<string> {
  counter += 1;
  const u = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${label} ${counter}`,
      accountStatus: 'active',
      isBeneficiary: beneficiary,
    },
  });
  return u.id;
}

const purposes = (id: string) => prisma.$transaction((tx) => accountPurposes(tx, id));

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.fullDeletionRequest.deleteMany({
    where: {
      OR: [{ subjectId: { in: ids } }, { requestedById: { in: ids } }, { decidedById: { in: ids } }],
    },
  });
  await prisma.selfManagedClaim.deleteMany({
    where: { OR: [{ beneficiaryId: { in: ids } }, { decidedById: { in: ids } }] },
  });
  await prisma.childApplication.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { childUserId: { in: ids } }] },
  });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.updateMany({ where: { deletedById: { in: ids } }, data: { deletedById: null } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('an account with no remaining purpose', () => {
  it('a guardian whose only link was revoked is closable', async () => {
    const guardian = await makeUser('ولية أمر');
    const child = await makeUser('طفلة', true);
    await prisma.familyLink.create({
      data: {
        parentId: guardian,
        studentId: child,
        status: 'approved',
        decidedAt: new Date(),
        // Revoked: soft-deleted, which is what §4.3 R16 makes the revocation.
        deletedAt: new Date(),
      },
    });
    const report = await purposes(guardian);
    expect(report.purposes).toEqual([]);
    expect(report.closable).toBe(true);
  });

  it('a REJECTED link is not a purpose — R128 withdrew it from the live set', async () => {
    const guardian = await makeUser('ولية أمر');
    const child = await makeUser('طفلة', true);
    await prisma.familyLink.create({
      data: {
        parentId: guardian,
        studentId: child,
        status: 'rejected',
        decidedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    expect((await purposes(guardian)).closable).toBe(true);
  });
});

describe('every purpose PRESERVES the account', () => {
  it('one of several children removed leaves the guardian', async () => {
    const guardian = await makeUser('ولية أمر');
    const kept = await makeUser('طفلة باقية', true);
    const gone = await makeUser('طفلة مُزالة', true);
    await prisma.familyLink.create({
      data: { parentId: guardian, studentId: kept, status: 'approved', decidedAt: new Date() },
    });
    await prisma.familyLink.create({
      data: {
        parentId: guardian,
        studentId: gone,
        status: 'approved',
        decidedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    const report = await purposes(guardian);
    expect(report.purposes).toContain('live_family_link');
    expect(report.closable).toBe(false);
  });

  it('a rejected link BESIDE a pending application preserves it — §4.3 names this case', async () => {
    const guardian = await makeUser('ولية أمر');
    const child = await makeUser('طفلة', true);
    await prisma.familyLink.create({
      data: {
        parentId: guardian,
        studentId: child,
        status: 'rejected',
        decidedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    const consentText = await prisma.legalConsentText.findFirst({ select: { id: true, versionLabel: true } });
    await prisma.childApplication.create({
      data: {
        requestId: crypto.randomUUID(),
        parentId: guardian,
        firstNameArabic: 'مريم',
        lastNameArabic: 'تجريبية',
        sex: 'female',
        consentDataProcessing: true,
        consentMediaRelease: true,
        consentTextVersion: consentText?.versionLabel ?? 'test',
        ...(consentText ? { consentTextId: consentText.id } : {}),
        consentGivenAt: new Date(),
        status: 'pending',
      },
    });
    const report = await purposes(guardian);
    expect(report.purposes).toEqual(['pending_child_application']);
    expect(report.closable).toBe(false);
  });

  it('a PENDING link still owes somebody an answer', async () => {
    const guardian = await makeUser('ولية أمر');
    const child = await makeUser('طفلة', true);
    await prisma.familyLink.create({
      data: { parentId: guardian, studentId: child, status: 'pending' },
    });
    expect((await purposes(guardian)).purposes).toContain('pending_family_link');
  });

  it('a BENEFICIARY is never a guardian-only account', async () => {
    const her = await makeUser('مستفيدة', true);
    const report = await purposes(her);
    expect(report.purposes).toContain('beneficiary');
    expect(report.closable).toBe(false);
  });

  it('any live role — teacher, admin, super admin — preserves it', async () => {
    for (const role of ['teacher', 'admin', 'super_admin', 'student']) {
      const person = await makeUser(`صاحبة دور ${role}`);
      const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      await prisma.userBranchRole.create({
        data: { userId: person, roleId: roleRow.id, branchId: null },
      });
      const report = await purposes(person);
      expect(report.purposes, role).toContain('staff_role');
      expect(report.closable, role).toBe(false);
    }
  });

  it('a SELF-MANAGED adult is never closed as a guardian-only account', async () => {
    // She took her account over deliberately (R132); holding no links now is not
    // a reason to take it back.
    const adult = await makeUser('بالغة مستقلة');
    await prisma.selfManagedClaim.create({
      data: {
        beneficiaryId: adult,
        provider: 'google',
        providerSubjectId: `gp-${Date.now()}`,
        email: `gp-${Date.now()}@example.com`,
        status: 'approved',
        decidedAt: new Date(),
      },
    });
    const report = await purposes(adult);
    expect(report.purposes).toContain('self_managed');
    expect(report.closable).toBe(false);
  });

  it('an undecided full-deletion request preserves BOTH parties', async () => {
    const guardian = await makeUser('ولية أمر');
    const child = await makeUser('طفلة', true);
    await prisma.fullDeletionRequest.create({
      data: { subjectId: child, requestedById: guardian, basis: 'guardian', status: 'pending' },
    });
    // Closing either would decide the request by removal.
    expect((await purposes(guardian)).purposes).toContain('pending_full_deletion_request');
    expect((await purposes(child)).purposes).toContain('pending_full_deletion_request');
  });

  it('reports EVERY purpose, not the first one found', async () => {
    // The report is what an operator reads before an irreversible act; a list
    // that stopped at the first hit would understate what is at stake.
    const person = await makeUser('متعددة الأدوار', true);
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: 'teacher' } });
    await prisma.userBranchRole.create({
      data: { userId: person, roleId: roleRow.id, branchId: null },
    });
    const child = await makeUser('طفلة', true);
    await prisma.familyLink.create({
      data: { parentId: person, studentId: child, status: 'approved', decidedAt: new Date() },
    });
    const report = await purposes(person);
    expect(report.purposes).toEqual(
      expect.arrayContaining(['beneficiary', 'staff_role', 'live_family_link']),
    );
  });

  it('an already-deleted account is not a closure candidate', async () => {
    const gone = await makeUser('محذوفة');
    await prisma.user.update({ where: { id: gone }, data: { deletedAt: new Date() } });
    const report = await purposes(gone);
    expect(report.closable).toBe(false);
  });
});
