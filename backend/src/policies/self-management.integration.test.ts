import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { resolveActingStudent } from '../middleware/child-context.js';
import { actorFor } from '../test-support/actor.js';
import { deleteUserAccount, purgeUserAccount } from '../services/account-deletion.service.js';
import { isSelfManaged } from './self-management.js';

/**
 * **DURABLE SELF-MANAGED AUTHORITY** (Owner decision, 2026-09-04).
 *
 * ## What was wrong
 *
 * R132 read *"she manages her own account"* as **an account with no active login
 * identity** — §4.3's structural test for a minor, reused so there would be one
 * definition rather than two. The reasoning was right and the fact was wrong,
 * and Option A proved it: **account closure deliberately deletes
 * `UserIdentity`**, so a self-managed adult who closed her account satisfied
 * *"no active login"* again.
 *
 * Nothing broke, because a second clause happened to hold — the resolver also
 * requires a live student and a closed account is soft-deleted. **Authority that
 * survives by coincidence is authority that will not survive the next change**,
 * so it is now derived from the approved claim, which is durable by
 * construction.
 *
 * ## The model these tests pin
 *
 * ```
 * DOB ≥ 18            → eligibility only
 * approved R132 claim → DURABLE authority
 * UserIdentity        → authentication mechanism only
 * Option A            → removes authentication, removes NO authority
 * ```
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[self-mgmt-test]';

let counter = 0;
let superAdmin = '';

function birthDateForAge(years: number, offsetDays = 0): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

async function makeUser(
  label: string,
  opts: { age?: number; beneficiary?: boolean; withIdentity?: boolean } = {},
): Promise<string> {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${label} ${counter}`,
      accountStatus: 'active',
      isBeneficiary: opts.beneficiary ?? true,
      birthDate: birthDateForAge(opts.age ?? 22),
    },
  });
  if (opts.withIdentity) {
    await prisma.userIdentity.create({
      data: {
        userId: user.id,
        provider: 'google',
        providerSubjectId: `sm-subject-${Date.now()}-${counter}`,
        email: `sm-${Date.now()}-${counter}@example.com`,
        isActive: true,
      },
    });
  }
  return user.id;
}

/** An APPROVED claim — the durable fact itself, as approval writes it. */
async function approveTransition(beneficiaryId: string): Promise<void> {
  counter += 1;
  await prisma.selfManagedClaim.create({
    data: {
      beneficiaryId,
      provider: 'google',
      providerSubjectId: `sm-claim-${Date.now()}-${counter}`,
      email: `sm-claim-${Date.now()}-${counter}@example.com`,
      status: 'approved',
      decidedAt: new Date(),
      decidedById: superAdmin,
    },
  });
}

async function guardianOf(studentId: string): Promise<string> {
  const parent = await makeUser('ولية أمر', { beneficiary: false });
  await prisma.familyLink.create({
    data: { parentId: parent, studentId, status: 'approved', decidedAt: new Date() },
  });
  return parent;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  // BOTH sides: `decided_by` is Restrict too, so a claim this suite's Super
  // Admin decided pins her even when its beneficiary was already swept.
  await prisma.selfManagedClaim.deleteMany({
    where: { OR: [{ beneficiaryId: { in: ids } }, { decidedById: { in: ids } }] },
  });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.trash.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { deletedById: { in: ids } }] },
  });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // `user.deleted_by` is Restrict and points at another user — release the
  // references TO these rows before removing them.
  await prisma.user.updateMany({ where: { deletedById: { in: ids } }, data: { deletedById: null } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await clear();
  superAdmin = await makeUser('مديرة عامة', { beneficiary: false });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  await prisma.userBranchRole.create({
    data: { userId: superAdmin, roleId: role.id, branchId: null },
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('what does and does not establish durable authority', () => {
  it('1 · a beneficiary UNDER 18 is not self-managed', async () => {
    const minor = await makeUser('قاصر', { age: 17 });
    expect(await isSelfManaged(prisma, minor)).toBe(false);
  });

  it('2 · 18+ WITHOUT a completed transition is not self-managed — age is never authority', async () => {
    const adult = await makeUser('بالغة لم تُحوّل', { age: 25 });
    expect(await isSelfManaged(prisma, adult)).toBe(false);

    // Even holding a login of her own does not make her self-managed: an
    // identity is a mechanism, and the transition is a decision.
    const withLogin = await makeUser('بالغة بحساب', { age: 25, withIdentity: true });
    expect(await isSelfManaged(prisma, withLogin)).toBe(false);
  });

  it('3 · an APPROVED transition establishes it', async () => {
    const adult = await makeUser('محوَّلة', { withIdentity: true });
    await approveTransition(adult);
    expect(await isSelfManaged(prisma, adult)).toBe(true);
  });

  it('8 · a PENDING or REJECTED claim establishes nothing', async () => {
    const pending = await makeUser('طلب معلّق');
    await prisma.selfManagedClaim.create({
      data: {
        beneficiaryId: pending,
        provider: 'google',
        providerSubjectId: `sm-p-${Date.now()}`,
        email: `sm-p-${Date.now()}@example.com`,
        status: 'pending',
      },
    });
    expect(await isSelfManaged(prisma, pending)).toBe(false);

    const refused = await makeUser('طلب مرفوض');
    await prisma.selfManagedClaim.create({
      data: {
        beneficiaryId: refused,
        provider: 'google',
        providerSubjectId: `sm-r-${Date.now()}`,
        email: `sm-r-${Date.now()}@example.com`,
        status: 'rejected',
        decidedAt: new Date(),
        decidedById: superAdmin,
        deletedAt: new Date(),
        deletedById: superAdmin,
      },
    });
    expect(await isSelfManaged(prisma, refused)).toBe(false);
  });

  it('10 · legacy accounts are not incorrectly marked independent', async () => {
    // Nothing about age, role or identity is consulted, so an account that
    // predates the whole mechanism cannot acquire authority by accident.
    for (const label of ['قديمة بلا دخول', 'قديمة بدخول']) {
      const legacy = await makeUser(label, { withIdentity: label.includes('بدخول') });
      expect(await isSelfManaged(prisma, legacy), label).toBe(false);
    }
  });

  it('9 · authority is one fact — a second approved claim does not create a second state', async () => {
    const adult = await makeUser('محوَّلة مرتين');
    await approveTransition(adult);
    await approveTransition(adult);
    // The predicate is existential, so duplicated evidence is still one answer.
    expect(await isSelfManaged(prisma, adult)).toBe(true);
  });
});

describe('the authority SURVIVES what authentication does not', () => {
  it('4 · removing the login identity does not remove authority', async () => {
    const adult = await makeUser('محوَّلة', { withIdentity: true });
    await approveTransition(adult);

    await prisma.userIdentity.deleteMany({ where: { userId: adult } });
    expect(await isSelfManaged(prisma, adult)).toBe(true);
  });

  it('7 · re-adding authentication later does not alter authority either', async () => {
    const adult = await makeUser('محوَّلة', { withIdentity: true });
    await approveTransition(adult);
    await prisma.userIdentity.deleteMany({ where: { userId: adult } });

    counter += 1;
    await prisma.userIdentity.create({
      data: {
        userId: adult,
        provider: 'google',
        providerSubjectId: `sm-again-${Date.now()}-${counter}`,
        email: `sm-again-${Date.now()}-${counter}@example.com`,
        isActive: true,
      },
    });
    expect(await isSelfManaged(prisma, adult)).toBe(true);
  });

  it('5/6 · OPTION A does not hand a self-managed adult back to a former guardian', async () => {
    /**
     * The case the old derivation got wrong. Closure deletes `UserIdentity`, so
     * *"no active login"* became true again — and the guardian was refused only
     * because a closed account is also soft-deleted. Now the authority itself is
     * what refuses him, which is what the rule was always supposed to say.
     */
    const adult = await makeUser('بالغة مستقلة', { withIdentity: true });
    await approveTransition(adult);
    const guardian = await guardianOf(adult);

    await expect(
      resolveActingStudent(prisma, { userId: guardian, roles: ['parent'] }, adult),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const actor = await actorFor(prisma, superAdmin);
    await deleteUserAccount(prisma, actor, adult);
    await purgeUserAccount(prisma, actor, adult);

    expect(await prisma.userIdentity.count({ where: { userId: adult } })).toBe(0);
    // The durable fact is intact…
    expect(await isSelfManaged(prisma, adult)).toBe(true);
    // …and he is still refused.
    await expect(
      resolveActingStudent(prisma, { userId: guardian, roles: ['parent'] }, adult),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // 6 · and the link row survives as evidence — nothing was destroyed.
    const link = await prisma.familyLink.findFirstOrThrow({
      where: { parentId: guardian, studentId: adult },
    });
    expect(link.status).toBe('approved');
    expect(link.deletedAt).toBeNull();
  });

  it('the authority is what refuses him — proved with the tombstone cleared', async () => {
    /**
     * The previous test passes under the OLD rule too, because a closed account
     * is soft-deleted. This one removes that coincidence: with `deleted_at`
     * cleared, only the durable fact can refuse the guardian — so this is the
     * assertion that actually distinguishes the fix from the bug.
     */
    const adult = await makeUser('بالغة مستقلة', { withIdentity: true });
    await approveTransition(adult);
    const guardian = await guardianOf(adult);

    await prisma.userIdentity.deleteMany({ where: { userId: adult } });
    // Live row, no login identity: exactly the shape the old rule mis-read.
    const live = await prisma.user.findUniqueOrThrow({ where: { id: adult } });
    expect(live.deletedAt).toBeNull();

    await expect(
      resolveActingStudent(prisma, { userId: guardian, roles: ['parent'] }, adult),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a still-guardian-managed minor is unaffected — the rule did not widen', async () => {
    // The control. If the change had refused everybody, the test above would
    // pass for the wrong reason.
    const minor = await makeUser('قاصر', { age: 12 });
    const guardian = await guardianOf(minor);
    await expect(
      resolveActingStudent(prisma, { userId: guardian, roles: ['parent'] }, minor),
    ).resolves.toMatchObject({ studentId: minor });
  });
});
