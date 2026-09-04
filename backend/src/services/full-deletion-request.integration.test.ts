import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { actorFor } from '../test-support/actor.js';
import {
  approveFullDeletion,
  listPendingFullDeletions,
  rejectFullDeletion,
  requestFullDeletion,
} from './full-deletion-request.service.js';

/**
 * **OPTION B — the request/review control plane** (SRS §4.10a, Revision 131).
 *
 * Two properties carry this suite. First, **nothing deletes**: approving records
 * a decision and leaves every educational row where it was, which is the whole
 * shape of the section and the thing a future reader is most likely to assume
 * wrongly. Second, **who may ask** — and in particular that a *former* guardian
 * of a self-managed adult may not, a rule that only became expressible once
 * authority stopped being read from the presence of a login identity
 * (2026-09-04). Before that, Option A's deletion of `UserIdentity` would have
 * made a closed self-managed adult look like a minor again, and her former
 * guardian could have asked for her educational record to be destroyed.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[full-del-test]';

let counter = 0;
let superAdmin = '';
let branchId = '';
let levelId = '';
let groupId = '';

async function makeUser(label: string, beneficiary = true): Promise<string> {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${label} ${counter}`,
      accountStatus: 'active',
      isBeneficiary: beneficiary,
    },
  });
  return user.id;
}

async function approvedLink(parentId: string, studentId: string): Promise<void> {
  await prisma.familyLink.create({
    data: { parentId, studentId, status: 'approved', decidedAt: new Date() },
  });
}

/** The durable authority fact, as R132 approval writes it. */
async function makeSelfManaged(beneficiaryId: string): Promise<void> {
  counter += 1;
  await prisma.selfManagedClaim.create({
    data: {
      beneficiaryId,
      provider: 'google',
      providerSubjectId: `fd-${Date.now()}-${counter}`,
      email: `fd-${Date.now()}-${counter}@example.com`,
      status: 'approved',
      decidedAt: new Date(),
      decidedById: superAdmin,
    },
  });
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.fullDeletionRequest.deleteMany({
      where: {
        OR: [
          { subjectId: { in: ids } },
          { requestedById: { in: ids } },
          { decidedById: { in: ids } },
        ],
      },
    });
    await prisma.selfManagedClaim.deleteMany({
      where: { OR: [{ beneficiaryId: { in: ids } }, { decidedById: { in: ids } }] },
    });
    await prisma.familyLink.deleteMany({
      where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
    });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.updateMany({
      where: { deletedById: { in: ids } },
      data: { deletedById: null },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  superAdmin = await makeUser('مديرة عامة', false);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  await prisma.userBranchRole.create({
    data: { userId: superAdmin, roleId: role.id, branchId: null },
  });
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  const categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: 'any' },
    })
  ).id;
  groupId = (
    await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId, branchId },
    })
  ).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('who may ask', () => {
  it('a person may always ask about her OWN data', async () => {
    const her = await makeUser('مستفيدة');
    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    expect(row.status).toBe('pending');
    const stored = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.basis).toBe('self');
    expect(stored.subjectId).toBe(her);
  });

  it('a LIVE approved guardian may ask for a minor', async () => {
    const minor = await makeUser('قاصر');
    const guardian = await makeUser('ولية أمر', false);
    await approvedLink(guardian, minor);

    const row = await requestFullDeletion(prisma, await actorFor(prisma, guardian), minor);
    const stored = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.basis).toBe('guardian');
    expect(stored.requestedById).toBe(guardian);
  });

  it('a FORMER guardian of a SELF-MANAGED adult may NOT — the rule durable authority made expressible', async () => {
    /**
     * The case that matters. The link row survives as history, and Option A
     * would have removed her login identity — so under the old reading of
     * authority she would have looked like a minor again and her former guardian
     * could have asked for her educational record to be destroyed.
     */
    const adult = await makeUser('بالغة مستقلة');
    await makeSelfManaged(adult);
    const guardian = await makeUser('ولي سابق', false);
    await approvedLink(guardian, adult);

    await expect(
      requestFullDeletion(prisma, await actorFor(prisma, guardian), adult),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.fullDeletionRequest.count({ where: { subjectId: adult } })).toBe(0);
  });

  it('and she may still ask for HERSELF after becoming self-managed', async () => {
    // The control: the transition governs who may act FOR her, not whether she
    // may act for herself.
    const adult = await makeUser('بالغة مستقلة');
    await makeSelfManaged(adult);
    await expect(
      requestFullDeletion(prisma, await actorFor(prisma, adult), adult),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('a stranger, a revoked guardian and a pending link are all refused ALIKE', async () => {
    const subject = await makeUser('مستفيدة');
    const stranger = await makeUser('غريبة', false);
    const revoked = await makeUser('ولي ملغى', false);
    await prisma.familyLink.create({
      data: {
        parentId: revoked,
        studentId: subject,
        status: 'approved',
        decidedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    const pendingParent = await makeUser('ولي منتظر', false);
    await prisma.familyLink.create({
      data: { parentId: pendingParent, studentId: subject, status: 'pending' },
    });

    for (const caller of [stranger, revoked, pendingParent]) {
      await expect(
        requestFullDeletion(prisma, await actorFor(prisma, caller), subject),
        caller,
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    // …and identically to an id that does not exist, so nothing is disclosed.
    await expect(
      requestFullDeletion(
        prisma,
        await actorFor(prisma, stranger),
        '00000000-0000-4000-8000-000000000000',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('one live request per subject', async () => {
    const her = await makeUser('مستفيدة');
    await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await expect(
      requestFullDeletion(prisma, await actorFor(prisma, her), her),
    ).rejects.toMatchObject({ details: { reason: 'REQUEST_ALREADY_PENDING' } });
  });
});

describe('the decision — and what it does NOT do', () => {
  async function subjectWithHistory(): Promise<{ id: string; enrolmentId: string }> {
    const id = await makeUser('مستفيدة بسجل');
    const enrolment = await prisma.enrollment.create({
      data: { studentId: id, administrativeGroupId: groupId, levelId, branchId },
    });
    return { id, enrolmentId: enrolment.id };
  }

  it('APPROVING RECORDS A DECISION AND DELETES NOTHING', async () => {
    /**
     * The property most likely to be assumed wrongly by a future reader, so it
     * is asserted rather than described: the educational record is untouched,
     * the account is untouched, and the audit row says `executed: false`.
     */
    const subject = await subjectWithHistory();
    const row = await requestFullDeletion(prisma, await actorFor(prisma, subject.id), subject.id);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    const stored = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('approved');
    expect(stored.decidedById).toBe(superAdmin);

    expect(await prisma.enrollment.count({ where: { id: subject.enrolmentId } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
    expect(user.deletedAt).toBeNull();
    expect(user.nameArabic).toContain(TAG);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: row.id, actionType: 'fulldeletion.approve' },
    });
    expect(entry.detail).toMatchObject({ executed: false });
  });

  it('approving twice is a conflict, not a second decision', async () => {
    const her = await makeUser('مستفيدة');
    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    const actor = await actorFor(prisma, superAdmin);
    await approveFullDeletion(prisma, actor, row.id);
    await expect(approveFullDeletion(prisma, actor, row.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a stale request fails CLOSED when the subject went away', async () => {
    const her = await makeUser('مستفيدة');
    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await prisma.user.update({ where: { id: her }, data: { deletedAt: new Date() } });

    await expect(
      approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id),
    ).rejects.toMatchObject({ details: { reason: 'SUBJECT_UNAVAILABLE' } });
    await prisma.user.update({ where: { id: her }, data: { deletedAt: null } });
  });

  it('a refusal is recorded, withdrawn from the live set, and never reopened', async () => {
    const her = await makeUser('مستفيدة');
    const first = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    const actor = await actorFor(prisma, superAdmin);
    await rejectFullDeletion(prisma, actor, first.id, 'نحتاج توضيحاً');

    const stored = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.status).toBe('rejected');
    expect(stored.decisionReason).toBe('نحتاج توضيحاً');
    // R128's shape — one act, one instant.
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.deletedAt!.getTime()).toBe(stored.decidedAt!.getTime());

    // It blocks nothing: she may ask again, as a NEW row.
    const second = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    expect(second.id).not.toBe(first.id);
    // And the refusal cannot be turned into an approval.
    await expect(approveFullDeletion(prisma, actor, first.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a refusal requires a reason', async () => {
    const her = await makeUser('مستفيدة');
    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await expect(
      rejectFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id, '   '),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('TD-2/R112 · only a Super Admin decides, and nobody else may read the queue', async () => {
    const her = await makeUser('مستفيدة');
    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);

    for (const role of ['admin', 'teacher', 'parent', 'student']) {
      counter += 1;
      const caller = await makeUser(`دور ${role}`, false);
      const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      await prisma.userBranchRole.create({
        data: { userId: caller, roleId: roleRow.id, branchId: null },
      });
      const actor = await actorFor(prisma, caller);
      await expect(approveFullDeletion(prisma, actor, row.id), role).rejects.toBeTruthy();
      await expect(rejectFullDeletion(prisma, actor, row.id, 'لا'), role).rejects.toBeTruthy();
      await expect(listPendingFullDeletions(prisma, actor), role).rejects.toBeTruthy();
    }
    expect(
      (await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('pending');
  });
});

describe('privacy of the queue and the trail', () => {
  it('the audit carries ids and a basis — never a name or an educational fact', async () => {
    const her = await makeUser('مستفيدة');
    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    const rows = await prisma.auditLog.findMany({
      where: { targetEntity: 'FullDeletionRequest', targetId: row.id },
      select: { actionType: true, detail: true },
    });
    expect(rows.map((r) => r.actionType).sort()).toEqual([
      'fulldeletion.approve',
      'fulldeletion.request',
    ]);
    const serialized = JSON.stringify(rows.map((r) => r.detail));
    expect(serialized).toContain(her);
    expect(serialized).not.toContain(TAG);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('the queue shows who and on what basis, and no educational record', async () => {
    const minor = await makeUser('قاصر');
    await prisma.enrollment.create({
      data: { studentId: minor, administrativeGroupId: groupId, levelId, branchId },
    });
    const guardian = await makeUser('ولية أمر', false);
    await approvedLink(guardian, minor);
    await requestFullDeletion(prisma, await actorFor(prisma, guardian), minor);

    const rows = await listPendingFullDeletions(prisma, await actorFor(prisma, superAdmin));
    const mine = rows.find((r) => r.subjectId === minor);
    expect(mine).toBeDefined();
    expect(mine!.basis).toBe('guardian');
    expect(mine!.requestedById).toBe(guardian);
    // A reviewer deciding whether the record may be destroyed does not read it.
    expect(Object.keys(mine!)).not.toContain('enrolments');
    expect(JSON.stringify(mine)).not.toContain(levelId);
  });
});
