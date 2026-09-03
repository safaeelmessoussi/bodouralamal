import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { resolveActingStudent } from '../middleware/child-context.js';
import { actorFor } from '../test-support/actor.js';
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from '../test-support/consumed-tokens.js';
import {
  approveSelfManagedClaim,
  listPendingClaims,
  rejectSelfManagedClaim,
  requestSelfManagedClaim,
} from './self-managed-claim.service.js';

/**
 * **A beneficiary claims her own account at 18** (SRS Revision 132).
 *
 * The property under test is not "a row was written" — it is that **nothing
 * binds until a human decides**, and that when it does bind it binds to the
 * **same** `User` that already holds her educational history. Everything else
 * here is the account-takeover surface: an identity that belongs to somebody
 * else, a claim replayed, a claim decided twice, an account that grew a login
 * while the claim waited.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[self-managed-test]';
const KEY = config.ONBOARDING_TOKEN_KEY;
const owned = ownedOnboardingTokens();

/** Exactly eighteen today, computed from the clock so it never expires. */
function birthDateForAge(years: number, offsetDays = 0): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

let counter = 0;
function identity(): { email: string; providerSubjectId: string } {
  counter += 1;
  return {
    email: `smc-${Date.now()}-${counter}@example.com`,
    providerSubjectId: `smc-subject-${Date.now()}-${counter}`,
  };
}

let codeCounter = 0;
function referenceCode(): string {
  codeCounter += 1;
  return `BA-T${String(codeCounter).padStart(4, '0')}`;
}

async function makeBeneficiary(
  label: string,
  opts: {
    birthDate?: Date | null;
    accountStatus?: string;
    isBeneficiary?: boolean;
    withIdentity?: { email: string; providerSubjectId: string };
  } = {},
): Promise<{ id: string; code: string }> {
  const code = referenceCode();
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${label}`,
      accountStatus: (opts.accountStatus ?? 'active') as never,
      isBeneficiary: opts.isBeneficiary ?? true,
      referenceCode: code,
      birthDate: opts.birthDate === undefined ? birthDateForAge(20) : opts.birthDate,
    },
  });
  if (opts.withIdentity) {
    await prisma.userIdentity.create({
      data: {
        userId: user.id,
        provider: 'google',
        providerSubjectId: opts.withIdentity.providerSubjectId,
        email: opts.withIdentity.email.toLowerCase(),
        isActive: true,
      },
    });
  }
  return { id: user.id, code };
}

async function makeStaff(role: string): Promise<string> {
  counter += 1;
  const user = await prisma.user.create({
    data: { sex: 'female', nameArabic: `${TAG} ${role} ${counter}`, accountStatus: 'active' },
  });
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow.id, branchId: null },
  });
  return user.id;
}

/** The verified-identity half, exactly as the OAuth callback produces it. */
function verified(id = identity()) {
  const issued = owned.issue(id, KEY);
  return {
    identity: id,
    jti: issued.claims.jti,
    expiresAt: new Date(issued.claims.exp * 1000),
  };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.selfManagedClaim.deleteMany({ where: { beneficiaryId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.familyLink.deleteMany({
      where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    });
    await prisma.grade.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await clearOwnedConsumedTokens(prisma, owned);
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('R132 — age is ELIGIBILITY and nothing else', () => {
  it('1 · a beneficiary under 18 cannot initiate — and is refused uniformly', async () => {
    const { id, code } = await makeBeneficiary('قاصر', { birthDate: birthDateForAge(18, 1) });
    await expect(
      requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', details: { reason: 'CLAIM_NOT_AVAILABLE' } });
    // **Scoped to this suite's own beneficiary**, not a global count. Suites
    // share one database, so `count()` with no predicate asserts something
    // about every other suite's rows as well — and it passed only while this
    // was the only file creating claims.
    expect(await prisma.selfManagedClaim.count({ where: { beneficiaryId: id } })).toBe(0);
  });

  it('2 · EXACTLY 18 today may initiate — the boundary is the birthday itself', async () => {
    const { id, code } = await makeBeneficiary('بالغة اليوم', { birthDate: birthDateForAge(18) });
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    expect(claim.status).toBe('pending');
    const row = await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(row.beneficiaryId).toBe(id);
  });

  it('3 · over 18 may initiate', async () => {
    const { code } = await makeBeneficiary('بالغة', { birthDate: birthDateForAge(25) });
    await expect(
      requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code }),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('a beneficiary with NO recorded birth date is refused — never assumed eligible', async () => {
    const { code } = await makeBeneficiary('بلا تاريخ', { birthDate: null });
    await expect(
      requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code }),
    ).rejects.toMatchObject({ details: { reason: 'CLAIM_NOT_AVAILABLE' } });
  });

  it('4 · NOTHING happens on the birthday itself — turning 18 binds nothing', async () => {
    const { id } = await makeBeneficiary('بلغت اليوم', { birthDate: birthDateForAge(18) });
    // The only thing eighteen changes is that a request would now be accepted.
    // No identity, no claim, no role, no session — and no job wrote any of them.
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.selfManagedClaim.count({ where: { beneficiaryId: id } })).toBe(0);
    expect(await prisma.userBranchRole.count({ where: { userId: id, deletedAt: null } })).toBe(0);
  });

  it('22/23 · the birth date is unchanged by the whole flow, and no age is stored', async () => {
    const dob = birthDateForAge(19);
    const { id, code } = await makeBeneficiary('ثابتة', { birthDate: dob });
    const superAdmin = await makeStaff('super_admin');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    await approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(after.birthDate?.toISOString()).toBe(dob.toISOString());

    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('user','self_managed_claim')`,
    );
    expect(columns.map((c) => c.column_name).filter((n) => /(^|_)age($|_)/.test(n))).toEqual([]);
  });
});

describe('R132 — Google verification alone binds nothing', () => {
  it('6/7 · a successful verification produces a PENDING claim and no identity', async () => {
    const { id, code } = await makeBeneficiary('مطالِبة');
    const v = verified();
    const claim = await requestSelfManagedClaim(prisma, { ...v, referenceCode: code });

    const row = await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(row.status).toBe('pending');
    // 7 · it points at the EXISTING beneficiary.
    expect(row.beneficiaryId).toBe(id);
    expect(row.providerSubjectId).toBe(v.identity.providerSubjectId);
    // 6 · and absolutely nothing is bound.
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
  });

  it('14 · a REPLAYED verification is refused — the token is single-use', async () => {
    const { code } = await makeBeneficiary('إعادة');
    const v = verified();
    await requestSelfManagedClaim(prisma, { ...v, referenceCode: code });

    const second = await makeBeneficiary('هدف آخر');
    await expect(
      requestSelfManagedClaim(prisma, { ...v, referenceCode: second.code }),
    ).rejects.toMatchObject({ details: { reason: 'TOKEN_ALREADY_USED' } });
    expect(await prisma.selfManagedClaim.count({ where: { beneficiaryId: second.id } })).toBe(0);
  });

  it('11 · a Google identity already belonging to ANOTHER user is refused', async () => {
    const bound = identity();
    await makeBeneficiary('صاحبة الحساب', { withIdentity: bound });
    const { code } = await makeBeneficiary('محاوِلة');

    const issued = owned.issue(bound, KEY);
    await expect(
      requestSelfManagedClaim(prisma, {
        identity: bound,
        jti: issued.claims.jti,
        expiresAt: new Date(issued.claims.exp * 1000),
        referenceCode: code,
      }),
    ).rejects.toMatchObject({ details: { reason: 'IDENTITY_ALREADY_BOUND' } });
  });

  it('12 · a second claim on the SAME beneficiary by another identity is refused uniformly', async () => {
    const { code } = await makeBeneficiary('مطلوبة مرتين');
    await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    // A different person quoting the same code learns only that it cannot be
    // claimed — never that somebody else is already claiming it.
    await expect(
      requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code }),
    ).rejects.toMatchObject({ details: { reason: 'CLAIM_NOT_AVAILABLE' } });
  });

  it('13 · the SAME identity claiming twice is told plainly — it is her own request', async () => {
    const one = await makeBeneficiary('أولى');
    const two = await makeBeneficiary('ثانية');
    const id = identity();
    const first = owned.issue(id, KEY);
    await requestSelfManagedClaim(prisma, {
      identity: id,
      jti: first.claims.jti,
      expiresAt: new Date(first.claims.exp * 1000),
      referenceCode: one.code,
    });

    const second = owned.issue(id, KEY);
    await expect(
      requestSelfManagedClaim(prisma, {
        identity: id,
        jti: second.claims.jti,
        expiresAt: new Date(second.claims.exp * 1000),
        referenceCode: two.code,
      }),
    ).rejects.toMatchObject({ details: { reason: 'CLAIM_ALREADY_PENDING' } });
  });

  it('an unknown reference code answers exactly as an ineligible one does', async () => {
    // The refusals must be indistinguishable, or this endpoint reports whether
    // BA-XXXXX exists and whether that person is a minor.
    const unknown = requestSelfManagedClaim(prisma, {
      ...verified(),
      referenceCode: 'BA-ZZZZZ',
    }).catch((e: unknown) => e);
    const minor = await makeBeneficiary('قاصر', { birthDate: birthDateForAge(10) });
    const ineligible = requestSelfManagedClaim(prisma, {
      ...verified(),
      referenceCode: minor.code,
    }).catch((e: unknown) => e);

    const [a, b] = await Promise.all([unknown, ineligible]);
    expect((a as { code: string }).code).toBe((b as { code: string }).code);
    expect((a as { details: unknown }).details).toEqual((b as { details: unknown }).details);
  });
});

describe('R132 — approval binds to the SAME user, or fails closed', () => {
  it('8/9/10 · binds the identity to the existing user, keeping every record and creating none', async () => {
    const { id, code } = await makeBeneficiary('تُعتمد');
    // Real educational history on that row, so "same user" is more than an id.
    const branch = await prisma.branch.create({ data: { name: `${TAG} فرع` } });
    const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
    const level = await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id, genderRestriction: 'any' },
    });
    const group = await prisma.administrativeGroup.create({
      data: { name: `${TAG} مجموعة`, levelId: level.id, branchId: branch.id },
    });
    const enrolment = await prisma.enrollment.create({
      data: { studentId: id, administrativeGroupId: group.id, levelId: level.id, branchId: branch.id },
    });

    const before = await prisma.user.count();
    const v = verified();
    const claim = await requestSelfManagedClaim(prisma, { ...v, referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    const result = await approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id);

    // 8 · the identity is on the SAME row.
    expect(result.beneficiaryId).toBe(id);
    const identityRow = await prisma.userIdentity.findFirstOrThrow({ where: { userId: id } });
    expect(identityRow.providerSubjectId).toBe(v.identity.providerSubjectId);
    expect(identityRow.email).toBe(v.identity.email.toLowerCase());

    // 10 · exactly one new user exists — the Super Admin this test made.
    expect(await prisma.user.count()).toBe(before + 1);

    // 9/21 · and her history did not move.
    const after = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { levelEnrollments: true },
    });
    expect(after.levelEnrollments.map((e) => e.id)).toEqual([enrolment.id]);
    expect(after.referenceCode).toBe(code);

    await prisma.enrollment.deleteMany({ where: { studentId: id } });
    await prisma.administrativeGroup.deleteMany({ where: { id: group.id } });
    await prisma.level.deleteMany({ where: { id: level.id } });
    await prisma.category.deleteMany({ where: { id: category.id } });
    await prisma.branch.deleteMany({ where: { id: branch.id } });
  });

  it('15 · approving twice is a conflict, not a second binding', async () => {
    const { id, code } = await makeBeneficiary('مرتين');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    const actor = await actorFor(prisma, superAdmin);
    await approveSelfManagedClaim(prisma, actor, claim.id);

    await expect(approveSelfManagedClaim(prisma, actor, claim.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(1);
  });

  it('19 · an account that grew a login while the claim waited is NOT overwritten', async () => {
    const { id, code } = await makeBeneficiary('سبقتها هوية');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });

    const interloper = identity();
    await prisma.userIdentity.create({
      data: {
        userId: id,
        provider: 'google',
        providerSubjectId: interloper.providerSubjectId,
        email: interloper.email.toLowerCase(),
        isActive: true,
      },
    });

    const superAdmin = await makeStaff('super_admin');
    await expect(
      approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id),
    ).rejects.toMatchObject({ details: { reason: 'ACCOUNT_HAS_LOGIN' } });

    // The existing credential is untouched — never replaced, never joined.
    const rows = await prisma.userIdentity.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerSubjectId).toBe(interloper.providerSubjectId);
  });

  it('18 · a suspended beneficiary cannot complete the transition', async () => {
    const { id, code } = await makeBeneficiary('موقوفة');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    await prisma.user.update({ where: { id }, data: { accountStatus: 'suspended' } });

    const superAdmin = await makeStaff('super_admin');
    await expect(
      approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id),
    ).rejects.toMatchObject({ details: { reason: 'BENEFICIARY_INELIGIBLE' } });
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
  });

  it('18b · a soft-deleted beneficiary cannot complete the transition', async () => {
    const { id, code } = await makeBeneficiary('محذوفة');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });

    const superAdmin = await makeStaff('super_admin');
    await expect(
      approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id),
    ).rejects.toMatchObject({ details: { reason: 'BENEFICIARY_INELIGIBLE' } });
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
    await prisma.user.update({ where: { id }, data: { deletedAt: null } });
  });

  it('the address must still be free — a concurrent claimant wins and this fails closed', async () => {
    const { id, code } = await makeBeneficiary('عنوان محجوز');
    const v = verified();
    const claim = await requestSelfManagedClaim(prisma, { ...v, referenceCode: code });

    // Somebody pre-provisioned that exact address in the meantime.
    const other = await prisma.user.create({
      data: {
        sex: 'female',
        nameArabic: `${TAG} صاحبة العنوان`,
        accountStatus: 'active',
        preProvisionedEmail: v.identity.email.toLowerCase(),
      },
    });

    const superAdmin = await makeStaff('super_admin');
    await expect(
      approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id),
    ).rejects.toMatchObject({ details: { reason: 'EMAIL_ALREADY_CLAIMED' } });
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
    await prisma.user.delete({ where: { id: other.id } });
  });

  it('TD-2/R112 · an Admin, a teacher and a parent cannot decide a claim', async () => {
    const { code } = await makeBeneficiary('محمية');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });

    for (const role of ['admin', 'teacher', 'parent', 'student']) {
      const caller = await makeStaff(role);
      await expect(
        approveSelfManagedClaim(prisma, await actorFor(prisma, caller), claim.id),
        role,
      ).rejects.toBeTruthy();
      await expect(
        rejectSelfManagedClaim(prisma, await actorFor(prisma, caller), claim.id, 'لا'),
        role,
      ).rejects.toBeTruthy();
      await expect(listPendingClaims(prisma, await actorFor(prisma, caller)), role).rejects.toBeTruthy();
    }
    expect(await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject(
      { status: 'pending' },
    );
  });
});

describe('R132 — refusal, and the corrected request', () => {
  it('16 · rejection binds nothing and records the reason', async () => {
    const { id, code } = await makeBeneficiary('مرفوضة');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    await rejectSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id, 'لم نتعرّف عليها');

    const row = await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(row.status).toBe('rejected');
    expect(row.decisionReason).toBe('لم نتعرّف عليها');
    expect(row.decidedById).toBe(superAdmin);
    // R128's shape — recorded, then withdrawn from the live set.
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedAt!.getTime()).toBe(row.decidedAt!.getTime());
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
  });

  it('17 · after a refusal she may ask again — a NEW claim, never the old one reopened', async () => {
    const { code } = await makeBeneficiary('تعيد المحاولة');
    const first = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    await rejectSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), first.id, 'سبب');

    const second = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('pending');
    const old = await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.status).toBe('rejected');
    expect(old.decisionReason).toBe('سبب');
  });

  it('a refused claim cannot be approved afterwards', async () => {
    const { code } = await makeBeneficiary('مرفوضة نهائياً');
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    const actor = await actorFor(prisma, superAdmin);
    await rejectSelfManagedClaim(prisma, actor, claim.id, 'سبب');
    await expect(approveSelfManagedClaim(prisma, actor, claim.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('R132 — the guardian, before and after', () => {
  async function guardianOf(studentId: string): Promise<string> {
    counter += 1;
    const parent = await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} ولية ${counter}`, accountStatus: 'active' },
    });
    await prisma.familyLink.create({
      data: { parentId: parent.id, studentId, status: 'approved', decidedAt: new Date() },
    });
    return parent.id;
  }

  it('20 · a former guardian loses CURRENT authority once the account is self-managed', async () => {
    const { id, code } = await makeBeneficiary('ابنة بالغة');
    const guardian = await guardianOf(id);

    // Before: the approved link is authority, exactly as §4.3 says.
    await expect(
      resolveActingStudent(prisma, { userId: guardian, roles: ['parent'] }, id),
    ).resolves.toMatchObject({ studentId: id, via: 'family_link' });

    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    await approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id);

    // After: refused — and refused as "no such child", the same non-disclosing
    // answer every other failure gets (§20 rule 17).
    await expect(
      resolveActingStudent(prisma, { userId: guardian, roles: ['parent'] }, id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the historical link SURVIVES — evidence is kept, authority is not', async () => {
    const { id, code } = await makeBeneficiary('سجل محفوظ');
    const guardian = await guardianOf(id);
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    await approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id);

    const link = await prisma.familyLink.findFirstOrThrow({
      where: { parentId: guardian, studentId: id },
    });
    // Nothing was deleted or rewritten: the relationship happened.
    expect(link.status).toBe('approved');
    expect(link.deletedAt).toBeNull();
  });

  it('5 · a guardian cannot choose or bind the beneficiary\'s identity', async () => {
    const { id, code } = await makeBeneficiary('لا تُنتحل');
    const guardian = await guardianOf(id);

    // She holds no decision authority whatever her relationship.
    const claim = await requestSelfManagedClaim(prisma, { ...verified(), referenceCode: code });
    await expect(
      approveSelfManagedClaim(prisma, await actorFor(prisma, guardian), claim.id),
    ).rejects.toBeTruthy();

    // And there is no path that writes her OWN identity onto the daughter: the
    // only writer is approval, and it binds the subject the claim carries.
    expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
  });

  it('a still-minor child keeps her guardian — the rule turns on the LOGIN, not the age', async () => {
    // R62.9's definition, and the reason it is reused rather than duplicated: a
    // 19-year-old who never transitioned is still reached through her guardian,
    // because nothing about her account has changed.
    const { id } = await makeBeneficiary('لم تُحوّل', { birthDate: birthDateForAge(19) });
    const guardian = await guardianOf(id);
    await expect(
      resolveActingStudent(prisma, { userId: guardian, roles: ['parent'] }, id),
    ).resolves.toMatchObject({ studentId: id });
  });
});

describe('R132 — what the audit and the review surface may say', () => {
  it('24 · the trail carries ids and never a token, subject, address or birth date', async () => {
    const { id, code } = await makeBeneficiary('مدقَّقة');
    const v = verified();
    const claim = await requestSelfManagedClaim(prisma, { ...v, referenceCode: code });
    const superAdmin = await makeStaff('super_admin');
    await approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id);

    const rows = await prisma.auditLog.findMany({
      where: { targetEntity: 'SelfManagedClaim', targetId: claim.id },
      select: { actionType: true, detail: true },
    });
    expect(rows.map((r) => r.actionType).sort()).toEqual([
      'selfmanaged.approve',
      'selfmanaged.request',
    ]);
    const serialized = JSON.stringify(rows.map((r) => r.detail));
    expect(serialized).toContain(id);
    // TD-14 — none of the credential coordinates, and no personal data.
    expect(serialized).not.toContain(v.identity.providerSubjectId);
    expect(serialized).not.toContain(v.identity.email);
    expect(serialized).not.toContain(v.jti);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('the review list shows what decides the claim and NOT the Google subject', async () => {
    const { id, code } = await makeBeneficiary('للمراجعة');
    const v = verified();
    await requestSelfManagedClaim(prisma, { ...v, referenceCode: code });
    const superAdmin = await makeStaff('super_admin');

    const rows = await listPendingClaims(prisma, await actorFor(prisma, superAdmin));
    const mine = rows.find((r) => r.beneficiaryId === id);
    expect(mine).toBeDefined();
    expect(mine!.referenceCode).toBe(code);
    expect(mine!.email).toBe(v.identity.email.toLowerCase());
    // The subject is a credential coordinate, never UI data.
    expect(JSON.stringify(mine)).not.toContain(v.identity.providerSubjectId);
    // And no birth date: it decided eligibility before the row existed.
    expect(Object.keys(mine!)).not.toContain('birthDate');
  });
});
