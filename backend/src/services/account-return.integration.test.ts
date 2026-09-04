import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { deleteUserAccount, purgeUserAccount } from './account-deletion.service.js';
import {
  approveAccountReturn,
  listPendingReturns,
  rejectAccountReturn,
  requestAccountReturn,
} from './account-return.service.js';
import { actorFor } from '../test-support/actor.js';
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from '../test-support/consumed-tokens.js';

/**
 * **A former beneficiary who closed her account asks for it back** (Owner
 * decision, 2026-09-04).
 *
 * The property the whole feature exists to protect is **one person, one
 * record**: approval reactivates the SAME `User`, so her archive stays reachable
 * and no duplicate beneficiary appears. Everything else here is the safety
 * boundary around that — the reference code proves nothing, a live account is
 * never returned to anybody, an identity already in use fails closed, and a
 * former guardian does not regain authority.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[account-return-test]';
const KEY = config.ONBOARDING_TOKEN_KEY;
const owned = ownedOnboardingTokens();

let counter = 0;
function identity(): { email: string; providerSubjectId: string } {
  counter += 1;
  return {
    email: `ret-${Date.now()}-${counter}@example.com`,
    providerSubjectId: `ret-subject-${Date.now()}-${counter}`,
  };
}

/** Per-RUN, because a closed account KEEPS its code and a fixed sequence would
 *  collide with whatever an interrupted earlier run left behind. */
const RUN = Math.floor(Math.random() * 100_000);
let codeCounter = 0;
function referenceCode(): string {
  codeCounter += 1;
  return `BA-R${String(RUN).padStart(5, '0')}${codeCounter}`;
}

let superAdmin = '';
let branchId = '';
let levelId = '';
let groupId = '';
const createdIds: string[] = [];

async function makeUser(label: string, beneficiary = true): Promise<{ id: string; code: string }> {
  counter += 1;
  const code = referenceCode();
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${label} ${counter}`,
      firstNameArabic: `${TAG}`,
      lastNameArabic: `${label}${counter}`,
      accountStatus: 'active',
      isBeneficiary: beneficiary,
      birthDate: new Date('2000-03-03T00:00:00.000Z'),
      ...(beneficiary ? { referenceCode: code } : {}),
    },
  });
  createdIds.push(user.id);
  return { id: user.id, code };
}

/** A beneficiary with real history, then Option A — the state a returner is in. */
async function closedBeneficiary(): Promise<{ id: string; code: string; enrolmentId: string }> {
  const her = await makeUser('مستفيدة سابقة');
  const enrolment = await prisma.enrollment.create({
    data: { studentId: her.id, administrativeGroupId: groupId, levelId, branchId },
  });
  await prisma.userIdentity.create({
    data: { userId: her.id, provider: 'google', ...identity(), isActive: true },
  });
  const actor = await actorFor(prisma, superAdmin);
  await deleteUserAccount(prisma, actor, her.id);
  await purgeUserAccount(prisma, actor, her.id);
  return { ...her, enrolmentId: enrolment.id };
}

async function ask(
  code: string,
  who = identity(),
): Promise<{ id: string; status: string }> {
  const issued = owned.issue(who, KEY);
  return requestAccountReturn(prisma, {
    identity: who,
    jti: issued.claims.jti,
    expiresAt: new Date(issued.claims.exp * 1000),
    referenceCode: code,
    firstNameArabic: 'اسمها الحالي',
    lastNameArabic: 'عائلتها الحالية',
    phone: '0600112233',
  });
}

async function clear(): Promise<void> {
  await clearOwnedConsumedTokens(prisma, owned);
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = [...new Set([...users.map((u) => u.id), ...createdIds])];
  if (ids.length > 0) {
    await prisma.accountReturnRequest.deleteMany({
      where: { OR: [{ subjectId: { in: ids } }, { decidedById: { in: ids } }] },
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
    await prisma.trash.deleteMany({
      where: { OR: [{ targetId: { in: ids } }, { deletedById: { in: ids } }] },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
    });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    // `user.deleted_by` is Restrict, so references TO these users are cleared
    // before the users themselves — the predicate targets the referring rows.
    await prisma.user.updateMany({
      where: { deletedById: { in: ids } },
      data: { deletedById: null },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    createdIds.length = 0;
  }
  // Audit rows the request path writes with NO actor cannot be found by user id
  // once the request row is gone, so they are swept by action type here.
  await prisma.auditLog.deleteMany({
    where: { actionType: { startsWith: 'accountreturn.' }, actorUserId: null },
  });
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  superAdmin = (await makeUser('مديرة عامة', false)).id;
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

describe('the returning beneficiary — ONE PERSON, ONE RECORD', () => {
  it('reactivates the SAME User and creates no second beneficiary', async () => {
    /**
     * The assertion the whole feature exists for. A fresh registration would
     * produce a duplicate person and an archive nobody could reach — the outcome
     * R62.4 already refuses for children.
     */
    const her = await closedBeneficiary();
    const before = await prisma.user.count({ where: { isBeneficiary: true } });
    const row = await ask(her.code);

    const result = await approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id);

    expect(result.subjectId).toBe(her.id);
    expect(await prisma.user.count({ where: { isBeneficiary: true } })).toBe(before);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: her.id } });
    expect(account.deletedAt).toBeNull();
    expect(account.accountStatus).toBe('active');
  });

  it('her educational history is still attached, and the code is unchanged', async () => {
    const her = await closedBeneficiary();
    const row = await ask(her.code);

    await approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id);

    expect(await prisma.enrollment.count({ where: { id: her.enrolmentId } })).toBe(1);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: her.id } });
    // Not regenerated: a new code would identify nothing she or the association
    // holds on paper.
    expect(account.referenceCode).toBe(her.code);
  });

  it('the CURRENT identity is acquired anew — the erased one is not restored', async () => {
    const her = await closedBeneficiary();
    const row = await ask(her.code);

    await approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id);

    const account = await prisma.user.findUniqueOrThrow({ where: { id: her.id } });
    expect(account.firstNameArabic).toBe('اسمها الحالي');
    expect(account.nameArabic).toBe('اسمها الحالي عائلتها الحالية');
    /**
     * **The birth date stays null.** Option A erased it, it is not restored, and
     * it is not re-collected here — asking her to reconstruct a value the
     * closure deliberately destroyed would defeat the closure, and this flow
     * does not need one.
     */
    expect(account.birthDate).toBeNull();
  });

  it('the new authentication binds ONLY after approval', async () => {
    const her = await closedBeneficiary();
    const who = identity();
    const row = await ask(her.code, who);

    // Nothing yet: binding before a decision would BE the reactivation.
    expect(await prisma.userIdentity.count({ where: { userId: her.id } })).toBe(0);

    await approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id);

    const bound = await prisma.userIdentity.findFirstOrThrow({ where: { userId: her.id } });
    expect(bound.providerSubjectId).toBe(who.providerSubjectId);
    expect(bound.isActive).toBe(true);
  });
});

describe('the reference code locates and never authenticates', () => {
  it('a code that never existed answers exactly as an unavailable one does', async () => {
    await expect(ask('BA-NOSUCH99')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { reason: 'RETURN_NOT_AVAILABLE' },
    });
  });

  it('a LIVE account is never returned to anybody', async () => {
    /**
     * The mirror of R132's `deleted_at IS NULL`, and the takeover this path must
     * never become: whoever holds a live account holds it.
     */
    const live = await makeUser('حساب قائم');

    await expect(ask(live.code)).rejects.toMatchObject({
      details: { reason: 'RETURN_NOT_AVAILABLE' },
    });
  });

  it('a second person quoting the same code learns nothing from the difference', async () => {
    const her = await closedBeneficiary();
    await ask(her.code);

    // Somebody else's pending request on this archive is a fact about them, so
    // it answers with the SAME refusal as a code that does not exist.
    await expect(ask(her.code)).rejects.toMatchObject({
      details: { reason: 'RETURN_NOT_AVAILABLE' },
    });
  });

  it('possession of the code alone binds nothing without approval', async () => {
    const her = await closedBeneficiary();

    await ask(her.code);

    expect(await prisma.userIdentity.count({ where: { userId: her.id } })).toBe(0);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: her.id } });
    expect(account.deletedAt).not.toBeNull();
  });
});

describe('it fails closed on every identity conflict', () => {
  it('a Google identity that already signs in here is refused, and named', async () => {
    const her = await closedBeneficiary();
    const other = await makeUser('صاحبة حساب آخر');
    const who = identity();
    await prisma.userIdentity.create({
      data: { userId: other.id, provider: 'google', ...who, isActive: true },
    });

    // Named rather than uniform: she already controls this identity, so saying
    // so discloses nothing she does not know.
    await expect(ask(her.code, who)).rejects.toMatchObject({
      details: { reason: 'IDENTITY_ALREADY_BOUND' },
    });
  });

  it('an identity taken while the request waited fails closed at approval', async () => {
    const her = await closedBeneficiary();
    const who = identity();
    const row = await ask(her.code, who);
    const other = await makeUser('من سبقتها');
    await prisma.userIdentity.create({
      data: { userId: other.id, provider: 'google', ...who, isActive: true },
    });

    await expect(
      approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });

    // Refused means untouched: still closed, still unbound.
    const account = await prisma.user.findUniqueOrThrow({ where: { id: her.id } });
    expect(account.deletedAt).not.toBeNull();
    expect(await prisma.userIdentity.count({ where: { userId: her.id } })).toBe(0);
  });

  it('an account that acquired a login while waiting is refused', async () => {
    const her = await closedBeneficiary();
    const row = await ask(her.code);
    await prisma.user.update({ where: { id: her.id }, data: { deletedAt: null } });
    await prisma.userIdentity.create({
      data: { userId: her.id, provider: 'google', ...identity(), isActive: true },
    });

    await expect(
      approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('a replayed verification is refused before anything is read about a person', async () => {
    const her = await closedBeneficiary();
    const who = identity();
    const issued = owned.issue(who, KEY);
    const payload = {
      identity: who,
      jti: issued.claims.jti,
      expiresAt: new Date(issued.claims.exp * 1000),
      referenceCode: her.code,
      firstNameArabic: 'اسم',
      lastNameArabic: 'عائلة',
    };
    await requestAccountReturn(prisma, payload);

    await expect(requestAccountReturn(prisma, payload)).rejects.toMatchObject({
      details: { reason: 'TOKEN_ALREADY_USED' },
    });
  });
});

describe('the decision, and what it does to authority', () => {
  it('requires a Super Admin — an ordinary account cannot approve', async () => {
    const her = await closedBeneficiary();
    const row = await ask(her.code);
    const nobody = await makeUser('بلا صلاحية', false);

    await expect(
      approveAccountReturn(prisma, await actorFor(prisma, nobody.id), row.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a FORMER GUARDIAN does not regain authority over her', async () => {
    /**
     * **The Owner's requirement, made true in every case.** Option A never
     * deleted `FamilyLink` rows, so an account that closes and reopens still
     * carries whatever links it had — and without the durable self-management
     * approval records, reopening would hand a former guardian authority over an
     * adult who returned to manage her own affairs.
     */
    const her = await closedBeneficiary();
    const guardian = await makeUser('ولي أمر سابق', false);
    await prisma.familyLink.create({
      data: { parentId: guardian.id, studentId: her.id, status: 'approved', decidedAt: new Date() },
    });
    const row = await ask(her.code);

    await approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id);

    expect(
      await prisma.selfManagedClaim.count({
        where: { beneficiaryId: her.id, status: 'approved' },
      }),
    ).toBe(1);
  });

  it('approving twice is a conflict, not a second reactivation', async () => {
    const her = await closedBeneficiary();
    const row = await ask(her.code);
    const actor = await actorFor(prisma, superAdmin);
    await approveAccountReturn(prisma, actor, row.id);

    await expect(approveAccountReturn(prisma, actor, row.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.userIdentity.count({ where: { userId: her.id } })).toBe(1);
  });

  it('a refusal is recorded, withdrawn from the live set, and lets her ask again', async () => {
    const her = await closedBeneficiary();
    const first = await ask(her.code);

    await rejectAccountReturn(
      prisma,
      await actorFor(prisma, superAdmin),
      first.id,
      'لم نتمكن من التحقق',
    );

    const stored = await prisma.accountReturnRequest.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.status).toBe('rejected');
    expect(stored.deletedAt).not.toBeNull();
    // R128's shape: the pending slot is released, so a corrected request is
    // possible — as a NEW row, never by reopening this one.
    const second = await ask(her.code);
    expect(second.id).not.toBe(first.id);
  });

  it('the queue shows what an administrator verifies, and no credential coordinate', async () => {
    const her = await closedBeneficiary();
    const who = identity();
    await ask(her.code, who);

    const rows = await listPendingReturns(prisma, await actorFor(prisma, superAdmin));

    const mine = rows.find((r) => r.subjectId === her.id);
    expect(mine).toBeDefined();
    expect(mine!.firstNameArabic).toBe('اسمها الحالي');
    // The Google subject is a credential coordinate and no decision needs it.
    expect(JSON.stringify(rows)).not.toContain(who.providerSubjectId);
  });

  it('the audit names ids and never an address or a name', async () => {
    const her = await closedBeneficiary();
    const row = await ask(her.code);
    await approveAccountReturn(prisma, await actorFor(prisma, superAdmin), row.id);

    const entries = await prisma.auditLog.findMany({
      where: { targetEntity: 'AccountReturnRequest', targetId: row.id },
      select: { actionType: true, detail: true },
    });
    expect(entries.map((e) => e.actionType).sort()).toEqual([
      'accountreturn.approve',
      'accountreturn.request',
    ]);
    const serialized = JSON.stringify(entries.map((e) => e.detail));
    expect(serialized).toContain(her.id);
    expect(serialized).not.toContain('اسمها الحالي');
    expect(serialized).not.toContain('@example.com');
    expect(serialized).not.toContain(her.code);
  });
});
