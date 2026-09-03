import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { resolveActingStudent } from '../middleware/child-context.js';
import { actorFor } from '../test-support/actor.js';
import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from '../test-support/consumed-tokens.js';
import { deleteUserAccount, purgeUserAccount } from './account-deletion.service.js';
import {
  approveSelfManagedClaim,
  requestSelfManagedClaim,
} from './self-managed-claim.service.js';

/**
 * **OPTION A — closing a platform account** (SRS §4.10a, Revision 131).
 *
 * ## The distinction under test
 *
 * Option A closes the **account** and keeps the **minimal educational archive**
 * for the remainder of the approved retention period. It is not Option B, which
 * is a different, separately-approved request and **is not implemented**. So
 * every assertion here has two halves: the authentication is gone, *and* the
 * educational record is still there.
 *
 * ## The correction this suite exists for
 *
 * R122 committed the association to answering *«كنت أدرس عندكم وأريد شهادة تثبت
 * المستوى الذي وصلت إليه»* years later; R111 cleared every field that could
 * match a returning person to her preserved record — **including
 * `reference_code`** — and neither cited the other. R131 resolved it: the code
 * survives Option A. This suite pins the survival **and** the reason it is safe,
 * because a code that reconnected somebody to an archive would be worth very
 * little if it also let anybody in.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[closure-test]';
const KEY = config.ONBOARDING_TOKEN_KEY;
const owned = ownedOnboardingTokens();

let counter = 0;
const identity = () => {
  counter += 1;
  return {
    email: `closure-${Date.now()}-${counter}@example.com`,
    providerSubjectId: `closure-subject-${Date.now()}-${counter}`,
  };
};
/**
 * **A per-RUN code, not a per-suite sequence.**
 *
 * Option A now *keeps* the reference code, so a closed account holds its value
 * for as long as the row exists. A fixed sequence therefore collides with
 * anything an interrupted earlier run left behind — the unique index is doing
 * its job and the fixture was wrong. The run tag makes each draw its own.
 */
const RUN = Math.floor(Math.random() * 1_000_000);
let codeCounter = 0;
const referenceCode = () => {
  codeCounter += 1;
  return `BA-${String(RUN).padStart(6, '0')}${String(codeCounter).padStart(3, '0')}`;
};
function birthDateForAge(years: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
}

let superAdmin = '';
let branchId = '';
let categoryId = '';
let levelId = '';
let groupId = '';

async function makeUser(
  label: string,
  opts: { beneficiary?: boolean; code?: string; withIdentity?: boolean } = {},
): Promise<{ id: string; code: string | null; email: string | null; subject: string | null }> {
  counter += 1;
  const code = opts.code ?? (opts.beneficiary ? referenceCode() : null);
  const user = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} ${label} ${counter}`,
      accountStatus: 'active',
      isBeneficiary: opts.beneficiary ?? false,
      birthDate: birthDateForAge(22),
      ...(code ? { referenceCode: code } : {}),
    },
  });
  let email: string | null = null;
  let subject: string | null = null;
  if (opts.withIdentity !== false) {
    const id = identity();
    email = id.email.toLowerCase();
    subject = id.providerSubjectId;
    await prisma.userIdentity.create({
      data: { userId: user.id, provider: 'google', providerSubjectId: subject, email, isActive: true },
    });
  }
  return { id: user.id, code, email, subject };
}

/** A live session and refresh token, so revocation is more than a column read. */
async function giveSession(userId: string): Promise<string> {
  // `RefreshSession.id` has no default — the anchor is minted by the caller.
  const session = await prisma.refreshSession.create({
    data: { id: randomUUID(), userId },
  });
  const token = await prisma.refreshToken.create({
    data: {
      userId,
      sessionId: session.id,
      tokenHash: `hash-${userId}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });
  return token.id;
}

/** The whole Option A operation: soft delete, then the de-identification. */
async function closeAccount(targetId: string): Promise<void> {
  const actor = await actorFor(prisma, superAdmin);
  await deleteUserAccount(prisma, actor, targetId);
  await purgeUserAccount(prisma, actor, targetId);
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.selfManagedClaim.deleteMany({ where: { beneficiaryId: { in: ids } } });
    await prisma.grade.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.attendance.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { markedById: { in: ids } }] },
    });
    await prisma.quranProgressLog.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { loggedById: { in: ids } }] },
    });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.familyLink.deleteMany({
      where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    });
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
    });
    await prisma.trash.deleteMany({
      where: { OR: [{ targetId: { in: ids } }, { deletedById: { in: ids } }] },
    });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    // `user.deleted_by` is RESTRICT and points at another `user`: a closed
    // account names the administrator who closed it, and this suite's Super
    // Admin is in the same batch. Release the self-reference first, or the
    // delete order becomes load-bearing on which row happens to go first.
    await prisma.user.updateMany({
      // Release every reference **TO** these users, wherever it lives — not
      // every reference FROM them. Those are different sets, and only the first
      // is what a RESTRICT foreign key refuses to let go.
      where: { deletedById: { in: ids } },
      data: { deletedById: null },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  // OUTSIDE the id block, deliberately: on a first run after a failure `ids` is
  // empty while a stale exam still pins the Level. Cleanup keyed only off rows
  // this run created cannot recover from the previous one.
  await prisma.grade.deleteMany({ where: { exam: { title: { startsWith: TAG } } } });
  await prisma.exam.deleteMany({ where: { title: { startsWith: TAG } } });
  // Also by GROUP, not only by student: an enrolment whose student was already
  // swept in an earlier partial run would otherwise pin the taxonomy for ever.
  await prisma.enrollment.deleteMany({
    where: { administrativeGroup: { name: { startsWith: TAG } } },
  });
  await prisma.administrativeGroup.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await clearOwnedConsumedTokens(prisma, owned);
}

beforeEach(async () => {
  await clear();
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
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
  const admin = await makeUser('مديرة عامة');
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  await prisma.userBranchRole.create({
    data: { userId: admin.id, roleId: role.id, branchId: null },
  });
  superAdmin = admin.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('Option A — the account closes and the educational archive stays', () => {
  async function beneficiaryWithHistory(): Promise<{
    id: string;
    code: string;
    email: string;
    subject: string;
    enrolmentId: string;
    gradeId: string;
  }> {
    const person = await makeUser('مستفيدة', { beneficiary: true });
    const enrolment = await prisma.enrollment.create({
      data: { studentId: person.id, administrativeGroupId: groupId, levelId, branchId },
    });
    const exam = await prisma.exam.create({
      data: {
        title: `${TAG} اختبار`,
        levelId,
        targetKind: 'level',
        date: new Date('2026-06-15T00:00:00Z'),
        maxGrade: 20,
      },
    });
    const grade = await prisma.grade.create({
      data: { examId: exam.id, studentId: person.id, score: 17, status: 'published', publishedAt: new Date() },
    });
    return {
      id: person.id,
      code: person.code!,
      email: person.email!,
      subject: person.subject!,
      enrolmentId: enrolment.id,
      gradeId: grade.id,
    };
  }

  it('1/2 · PRESERVES the reference code, and the SAME value — never regenerated', async () => {
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.referenceCode).toBe(p.code);
    // The tombstone is in place, so this is the code ON a closed account.
    expect(after.nameArabic).toBe('حساب محذوف');
    expect(after.deletedAt).not.toBeNull();
  });

  it('3 · the reference code grants NOTHING — quoting it opens no path back in', async () => {
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);

    // A self-managed claim is the one surface that takes a code. A closed
    // account is soft-deleted, and that lookup is `WHERE deleted_at IS NULL`,
    // so the code answers exactly as a code that never existed does.
    const fresh = identity();
    const issued = owned.issue(fresh, KEY);
    await expect(
      requestSelfManagedClaim(prisma, {
        identity: fresh,
        jti: issued.claims.jti,
        expiresAt: new Date(issued.claims.exp * 1000),
        referenceCode: p.code,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', details: { reason: 'CLAIM_NOT_AVAILABLE' } });
    expect(await prisma.userIdentity.count({ where: { userId: p.id } })).toBe(0);
  });

  it('4/5/6 · the authentication identity is gone, and its address is released', async () => {
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);

    expect(await prisma.userIdentity.count({ where: { userId: p.id } })).toBe(0);
    // The subject no longer resolves to anybody.
    expect(
      await prisma.userIdentity.count({ where: { providerSubjectId: p.subject } }),
    ).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.preProvisionedEmail).toBeNull();
  });

  it('7/8 · sessions and refresh tokens cannot restore access', async () => {
    const p = await beneficiaryWithHistory();
    await giveSession(p.id);
    expect(await prisma.refreshToken.count({ where: { userId: p.id } })).toBe(1);

    await closeAccount(p.id);

    expect(await prisma.refreshToken.count({ where: { userId: p.id } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId: p.id } })).toBe(0);
  });

  it('9 · repeating Option A is IDEMPOTENT — one audit fact, and the QR is not re-rotated', async () => {
    /**
     * **The trap the reference-code correction created, and closed.**
     * `hadIdentitySurface` decides both whether `qr_ref` rotates and whether an
     * audit row is written. It used to count `reference_code`; leaving it there
     * while the field is deliberately KEPT would make the predicate permanently
     * true, so every retry would rotate the QR again and write a second
     * `user.deidentify` row — an idempotent job looking like repeated human
     * decisions.
     */
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });

    await purgeUserAccount(prisma, await actorFor(prisma, superAdmin), p.id);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });

    expect(second.qrRef).toBe(first.qrRef);
    expect(second.referenceCode).toBe(p.code);
    expect(
      await prisma.auditLog.count({
        where: { targetId: p.id, actionType: 'user.deidentify' },
      }),
    ).toBe(1);
  });

  it('10-13/21/22 · the educational archive SURVIVES — this is not Option B', async () => {
    const p = await beneficiaryWithHistory();
    const quran = await prisma.quranProgressLog.create({
      data: {
        studentId: p.id,
        loggedById: superAdmin,
        surahId: 1,
        startAyah: 1,
        endAyah: 7,
        category: 'new_memorization',
      },
    });

    await closeAccount(p.id);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: p.id },
      include: { levelEnrollments: true },
    });
    // Enrolment, and through it the Level and the branch context.
    expect(after.levelEnrollments.map((e) => e.id)).toEqual([p.enrolmentId]);
    expect(after.levelEnrollments[0]!.levelId).toBe(levelId);
    expect(after.levelEnrollments[0]!.branchId).toBe(branchId);
    // The published grade, and the progression evidence.
    expect(await prisma.grade.count({ where: { id: p.gradeId } })).toBe(1);
    expect(await prisma.quranProgressLog.count({ where: { id: quran.id } })).toBe(1);
    // R79.7's durable fact about what this record WAS.
    expect(after.isBeneficiary).toBe(true);
  });

  it('14 · no second User is created, and the row itself survives', async () => {
    const p = await beneficiaryWithHistory();
    const before = await prisma.user.count();
    await closeAccount(p.id);
    expect(await prisma.user.count()).toBe(before);
  });

  it('20 · the audit says WHICH fields, never their values or any secret', async () => {
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);

    const rows = await prisma.auditLog.findMany({
      where: { targetId: p.id },
      select: { actionType: true, detail: true },
    });
    const serialized = JSON.stringify(rows.map((r) => r.detail));
    expect(rows.map((r) => r.actionType)).toContain('user.deidentify');
    for (const secret of [p.email, p.subject, p.code, 'حساب محذوف']) {
      expect(serialized, secret).not.toContain(secret);
    }
    // And no birth date, which the closure does not touch either way.
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('DOB is not touched by account closure — it is not authentication data', async () => {
    // R131's map does not classify the birth date for Option A, so this asserts
    // the CURRENT behaviour rather than deciding it: the closure leaves it, and
    // no destructive change was made on an unsettled classification.
    const p = await beneficiaryWithHistory();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    await closeAccount(p.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.birthDate?.toISOString()).toBe(before.birthDate?.toISOString());
  });

  it('24 · Trash cannot restore the closed account', async () => {
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);

    // The de-identification removes the User's Trash rows in its own
    // transaction — a snapshot able to undo it would be the erased name living
    // on in JSONB and a false offer of restoration.
    expect(
      await prisma.trash.count({ where: { targetEntity: 'User', targetId: p.id } }),
    ).toBe(0);
  });
});

describe('Option A — a guardian-only account, and a self-managed adult', () => {
  it('15/16 · closing a GUARDIAN-only account touches no child record', async () => {
    const guardian = await makeUser('ولية أمر');
    const child = await makeUser('طفلة', { beneficiary: true, withIdentity: false });
    await prisma.familyLink.create({
      data: { parentId: guardian.id, studentId: child.id, status: 'approved', decidedAt: new Date() },
    });
    const enrolment = await prisma.enrollment.create({
      data: { studentId: child.id, administrativeGroupId: groupId, levelId, branchId },
    });

    await closeAccount(guardian.id);

    // The child is untouched in every particular.
    const childAfter = await prisma.user.findUniqueOrThrow({ where: { id: child.id } });
    expect(childAfter.deletedAt).toBeNull();
    expect(childAfter.nameArabic).not.toBe('حساب محذوف');
    expect(childAfter.referenceCode).toBe(child.code);
    expect(await prisma.enrollment.count({ where: { id: enrolment.id } })).toBe(1);

    // And the guardian was never treated as a beneficiary (R129).
    const guardianAfter = await prisma.user.findUniqueOrThrow({ where: { id: guardian.id } });
    expect(guardianAfter.isBeneficiary).toBe(false);
    expect(guardianAfter.referenceCode).toBeNull();
    expect(await prisma.enrollment.count({ where: { studentId: guardian.id } })).toBe(0);
  });

  it('17 · closing a SELF-MANAGED adult does not hand her back to a former guardian', async () => {
    /**
     * The sharp case. Closure DELETES her `UserIdentity`, and R132's authority
     * rule reads *an account with no active login identity* — so the clause that
     * ended the guardian's authority is, on its face, satisfied again. What
     * still refuses him is that a closed account is soft-deleted, and the
     * resolver requires a live student. Asserted explicitly **because** it holds
     * by a second clause rather than by the one that expresses the intent.
     */
    const adult = await makeUser('بالغة مستقلة', { beneficiary: true });
    const guardian = await makeUser('ولي سابق');
    await prisma.familyLink.create({
      data: { parentId: guardian.id, studentId: adult.id, status: 'approved', decidedAt: new Date() },
    });

    // While she was self-managed the guardian was already refused.
    await expect(
      resolveActingStudent(prisma, { userId: guardian.id, roles: ['parent'] }, adult.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await closeAccount(adult.id);
    expect(await prisma.userIdentity.count({ where: { userId: adult.id } })).toBe(0);

    // And he is still refused after closure.
    await expect(
      resolveActingStudent(prisma, { userId: guardian.id, roles: ['parent'] }, adult.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Option A — a pending self-managed claim cannot resurrect a login', () => {
  it('18/19 · approving a claim after closure fails CLOSED', async () => {
    const person = await makeUser('مستفيدة تطالب', { beneficiary: true, withIdentity: false });
    const fresh = identity();
    const issued = owned.issue(fresh, KEY);
    const claim = await requestSelfManagedClaim(prisma, {
      identity: fresh,
      jti: issued.claims.jti,
      expiresAt: new Date(issued.claims.exp * 1000),
      referenceCode: person.code!,
    });

    await closeAccount(person.id);

    await expect(
      approveSelfManagedClaim(prisma, await actorFor(prisma, superAdmin), claim.id),
    ).rejects.toMatchObject({ details: { reason: 'BENEFICIARY_INELIGIBLE' } });
    // The whole point: no identity was created on a closed account.
    expect(await prisma.userIdentity.count({ where: { userId: person.id } })).toBe(0);
  });
});
