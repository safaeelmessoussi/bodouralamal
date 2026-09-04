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
import {
  closeGuardianOnlyAccount,
  deleteUserAccount,
  purgeUserAccount,
} from './account-deletion.service.js';
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
    // BOTH sides: `beneficiary_id` and `decided_by` are each Restrict, so a
    // claim this suite's Super Admin decided pins her too.
    await prisma.selfManagedClaim.deleteMany({
      where: { OR: [{ beneficiaryId: { in: ids } }, { decidedById: { in: ids } }] },
    });
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

describe('Account deletion — the account goes, and her own history with it (R133)', () => {
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

  it('1/2 · CLEARS the reference code — it now locates nothing (R133)', async () => {
    /**
     * **Inverted by decision, not by drift.** Under R131 the code survived as
     * the protected pseudonymous locator that reconnected a former beneficiary
     * with her preserved archive, so a future attestation stayed possible. R133
     * removes the archive and withdraws the promise — a locator for data that no
     * longer exists is retained personal data with no purpose.
     */
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.referenceCode).toBeNull();
    expect(after.nameArabic).toBe('حساب محذوف');
    expect(after.deletedAt).not.toBeNull();
  });

  it('2b · the DATE OF BIRTH is cleared, and so is the history beside it', async () => {
    /**
     * **Both halves are asserted together, and both now say «gone».** This test
     * used to prove the boundary between an erased account and a preserved
     * archive; R133 removes the boundary, so it proves instead that permanent
     * deletion means what the word says.
     */
    const p = await beneficiaryWithHistory();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(before.birthDate).not.toBeNull();

    await closeAccount(p.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    // Removed, never transformed: no year-only value and no age snapshot.
    expect(after.birthDate).toBeNull();
    expect(after.referenceCode).toBeNull();
    expect(await prisma.enrollment.count({ where: { id: p.enrolmentId } })).toBe(0);
    expect(await prisma.grade.count({ where: { id: p.gradeId } })).toBe(0);
  });

  it('2c · clearing the birth date does NOT make the closure repeat itself', async () => {
    /**
     * The predicate that decides whether de-identification did any work must
     * name exactly the fields it clears. `birth_date` is now one of them, so it
     * belongs there — and getting that wrong in either direction is invisible
     * until a retry: an uncleared field listed there rotates `qr_ref` and writes
     * a second audit row on every run, while a cleared field omitted makes real
     * work look like a no-op.
     */
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    const audits = await prisma.auditLog.count({
      where: { actionType: 'user.deidentify', targetId: p.id },
    });

    const actor = await actorFor(prisma, superAdmin);
    await purgeUserAccount(prisma, actor, p.id);

    const second = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(second.qrRef).toBe(first.qrRef);
    expect(second.birthDate).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { actionType: 'user.deidentify', targetId: p.id },
      }),
    ).toBe(audits);
  });

  it('2d · the audit names the FIELD and never the date', async () => {
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'user.deidentify', targetId: p.id },
    });
    const detail = JSON.stringify(row.detail);
    expect(detail).toContain('birth_date');
    // TD-14: the row that records the erasure must not become the last copy.
    expect(detail).not.toContain('2004');
    expect(detail).not.toMatch(/\d{4}-\d{2}-\d{2}/);
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

  it('9 · repeating a permanent deletion is IDEMPOTENT — one audit fact, one QR', async () => {
    /**
     * **`hadIdentitySurface` must name exactly the fields this operation
     * clears**, and the predicate has now been wrong in both directions across
     * two revisions — which is why it has its own test. It decides whether
     * `qr_ref` rotates and whether an audit row is written. A field it does NOT
     * clear, listed there, makes the predicate permanently true, so every retry
     * rotates the QR and writes a second `user.deidentify` row. A field it DOES
     * clear, omitted, makes real work look like a no-op. Both are invisible
     * until something runs twice.
     */
    const p = await beneficiaryWithHistory();
    await closeAccount(p.id);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });

    await purgeUserAccount(prisma, await actorFor(prisma, superAdmin), p.id);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });

    expect(second.qrRef).toBe(first.qrRef);
    expect(second.referenceCode).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { targetId: p.id, actionType: 'user.deidentify' },
      }),
    ).toBe(1);
  });

  it('10-13/21/22 · her own educational history is DESTROYED, shared data is not', async () => {
    /**
     * **The heart of R133, and the assertion this suite exists for now.**
     *
     * It used to prove the opposite — that the archive survived, *«this is not
     * Option B»*. The Owner withdrew the archive and the attestation promise
     * with it, so what must be proved is that permanent deletion is genuinely
     * destructive **and still bounded**: her enrolment, her grade and her Quran
     * progress go, while the Level, the branch and the exam everybody else sat
     * do not. Deletion is decided per relationship, never by graph cascade.
     */
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
    const exam = await prisma.grade.findUniqueOrThrow({
      where: { id: p.gradeId },
      select: { examId: true },
    });

    await closeAccount(p.id);

    // Hers — gone.
    expect(await prisma.enrollment.count({ where: { id: p.enrolmentId } })).toBe(0);
    expect(await prisma.grade.count({ where: { id: p.gradeId } })).toBe(0);
    expect(await prisma.quranProgressLog.count({ where: { id: quran.id } })).toBe(0);

    // Shared — untouched. The exam is a teacher's work and the Level is the
    // institution's; neither is hers to delete because she was assessed once.
    expect(await prisma.exam.count({ where: { id: exam.examId } })).toBe(1);
    expect(await prisma.level.count({ where: { id: levelId } })).toBe(1);
    expect(await prisma.branch.count({ where: { id: branchId } })).toBe(1);

    // R79.7's durable fact about what this record WAS survives the erasure —
    // it identifies nobody and is what keeps the row's own history coherent.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
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
    // And no birth date. The closure now CLEARS one (Owner, 2026-09-04), which
    // makes this assertion sharper than it was when it merely reflected a field
    // nothing touched: the row recording an erasure must never be the last copy
    // of what was erased.
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('DOB IS cleared by account closure — the Owner classified it (2026-09-04)', async () => {
    /**
     * **This assertion was inverted, by decision rather than by drift.**
     *
     * It previously read *«DOB is not touched»*, and said so honestly: R131's
     * map did not classify the birth date for Option A, so the test pinned the
     * current behaviour rather than deciding an open question. The Owner has now
     * decided — the birth date belongs to the account, not to the retained
     * archive — so the property is restated here rather than deleted, and this
     * note is why it changed.
     */
    const p = await beneficiaryWithHistory();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(before.birthDate).not.toBeNull();

    await closeAccount(p.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.birthDate).toBeNull();
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

describe('Account deletion — a guardian-only account, and a self-managed adult', () => {
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
    // **Self-managed is the approved CLAIM, not the identity** (Owner,
    // 2026-09-04). This fixture used to give her a login and call that
    // self-managed — the very reading Option A broke, since closure deletes it.
    await prisma.selfManagedClaim.create({
      data: {
        beneficiaryId: adult.id,
        provider: 'google',
        providerSubjectId: `closure-sm-${Date.now()}`,
        email: `closure-sm-${Date.now()}@example.com`,
        status: 'approved',
        decidedAt: new Date(),
        decidedById: superAdmin,
      },
    });
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

describe('Guardian-only cleanup — an EXPLICIT decision, guarded (Owner 2026-09-04)', () => {
  const close = async (targetId: string): Promise<void> => {
    const actor = await actorFor(prisma, superAdmin);
    await closeGuardianOnlyAccount(prisma, actor, targetId);
  };

  /** A guardian whose only child link has been revoked — the closure case. */
  async function spentGuardian(): Promise<string> {
    const guardian = await makeUser('ولية أمر منتهية');
    const child = await makeUser('طفلة سابقة', { beneficiary: true, withIdentity: false });
    await prisma.familyLink.create({
      data: {
        parentId: guardian.id,
        studentId: child.id,
        status: 'rejected',
        decidedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    return guardian.id;
  }

  it('closes an account with no remaining purpose, through the ordinary machinery', async () => {
    const guardian = await spentGuardian();

    await close(guardian);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: guardian } });
    // Not a second closure path: the same tombstone, the same de-identification.
    expect(after.deletedAt).not.toBeNull();
    expect(after.nameArabic).toBe('حساب محذوف');
    expect(await prisma.userIdentity.count({ where: { userId: guardian } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { actionType: 'user.close_guardian_only', targetId: guardian },
      }),
    ).toBe(1);
  });

  it.each([
    [
      'a LIVE family link',
      'live_family_link',
      async (guardian: string) => {
        const child = await makeUser('طفلة حالية', { beneficiary: true, withIdentity: false });
        await prisma.familyLink.create({
          data: { parentId: guardian, studentId: child.id, status: 'approved', decidedAt: new Date() },
        });
      },
    ],
    [
      'a PENDING family link that still owes an answer',
      'pending_family_link',
      async (guardian: string) => {
        const child = await makeUser('طفلة منتظرة', { beneficiary: true, withIdentity: false });
        await prisma.familyLink.create({
          data: { parentId: guardian, studentId: child.id, status: 'pending' },
        });
      },
    ],
    [
      'being a beneficiary herself',
      'beneficiary',
      async (guardian: string) => {
        await prisma.user.update({
          where: { id: guardian },
          data: { isBeneficiary: true },
        });
      },
    ],
  ])('REFUSES while the account has %s', async (_label, purpose, giveIt) => {
    /**
     * **The asymmetry is the safety property.** A missed purpose closes an
     * account that should have lived; a spurious one merely leaves an account
     * alive. So every one of these must refuse, and the refusal must SAY which
     * purpose blocked it — a Super Admin already looking at the account needs to
     * know what to resolve, and a uniform refusal here would be a dead end.
     */
    const guardian = await spentGuardian();
    await giveIt(guardian);

    await expect(close(guardian)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      // `blocked_by`, because that is the channel `BlockedNotice` reads — a
      // bespoke shape here left the refusal with no reach at all, which the
      // browser run caught and this assertion now pins.
      details: {
        reason: 'ACCOUNT_HAS_PURPOSE',
        blocked_by: expect.objectContaining({ [purpose]: 1 }),
      },
    });

    // Refused means UNTOUCHED — not half-closed, and no tombstone left behind.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: guardian } });
    expect(after.deletedAt).toBeNull();
    expect(after.nameArabic).not.toBe('حساب محذوف');
    expect(
      await prisma.trash.count({ where: { targetEntity: 'User', targetId: guardian } }),
    ).toBe(0);
  });

  it('touches NO child record — purposes are read, never removed to qualify', async () => {
    const guardian = await makeUser('ولية أمر لا تمس طفلها');
    const child = await makeUser('طفلة محمية', { beneficiary: true, withIdentity: false });
    const link = await prisma.familyLink.create({
      data: {
        parentId: guardian.id,
        studentId: child.id,
        status: 'rejected',
        decidedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    const enrolment = await prisma.enrollment.create({
      data: { studentId: child.id, administrativeGroupId: groupId, levelId, branchId },
    });

    await close(guardian.id);

    const childAfter = await prisma.user.findUniqueOrThrow({ where: { id: child.id } });
    expect(childAfter.deletedAt).toBeNull();
    expect(childAfter.nameArabic).not.toBe('حساب محذوف');
    expect(childAfter.referenceCode).toBe(child.code);
    expect(childAfter.birthDate).not.toBeNull();
    expect(await prisma.enrollment.count({ where: { id: enrolment.id } })).toBe(1);
    // Even the spent link survives: R128 keeps a rejected link as the record of
    // a decision, and closing the guardian is not a reason to erase it.
    expect(await prisma.familyLink.count({ where: { id: link.id } })).toBe(1);
  });

  it('is idempotent — a repeat neither errors loudly nor writes a second decision', async () => {
    const guardian = await spentGuardian();
    await close(guardian);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: guardian } });

    /**
     * The second call meets an account that is already soft-deleted, so the
     * ordinary soft delete refuses it — and that refusal is the CORRECT
     * outcome, not a defect: the work is done. What must not happen is a second
     * `close_guardian_only` decision in the audit, which would read as an
     * administrator having judged the same account twice.
     */
    await expect(close(guardian)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const second = await prisma.user.findUniqueOrThrow({ where: { id: guardian } });
    expect(second.qrRef).toBe(first.qrRef);
    expect(
      await prisma.auditLog.count({
        where: { actionType: 'user.close_guardian_only', targetId: guardian },
      }),
    ).toBe(1);
  });
});

describe('Account deletion — a pending self-managed claim cannot resurrect a login', () => {
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
