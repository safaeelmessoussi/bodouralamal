import { randomUUID } from 'node:crypto';

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
    // The execution tests build a real educational record, so the teardown
    // unwinds it in foreign-key order. Outside any `if` on the purge having run,
    // because the failing case is the one that leaves rows behind.
    const submissions = await prisma.studentExamSubmission.findMany({
      where: { studentId: { in: ids } },
      select: { id: true },
    });
    if (submissions.length > 0) {
      await prisma.studentExamAnswer.deleteMany({
        where: { submissionId: { in: submissions.map((x) => x.id) } },
      });
      await prisma.studentExamSubmission.deleteMany({ where: { studentId: { in: ids } } });
    }
    await prisma.grade.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.attendance.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { markedById: { in: ids } }] },
    });
    await prisma.quranProgressLog.deleteMany({
      where: { OR: [{ studentId: { in: ids } }, { loggedById: { in: ids } }] },
    });
    await prisma.studentSurahProgress.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.studentTeachingGroup.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.childApplication.deleteMany({
      where: {
        OR: [
          { parentId: { in: ids } },
          { childUserId: { in: ids } },
          { matchedExistingUserId: { in: ids } },
          { decidedById: { in: ids } },
        ],
      },
    });
    await prisma.consentRecord.deleteMany({
      where: {
        OR: [
          { studentId: { in: ids } },
          { grantedByUserId: { in: ids } },
          { revokedByUserId: { in: ids } },
        ],
      },
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
    await prisma.exam.deleteMany({ where: { studentId: { in: ids } } });
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
  /**
   * **Exams are scoped by TITLE, not by student.** The execution suite builds a
   * LEVEL-targeted exam to prove that a teacher-authored assessment survives
   * Option B, and a level-targeted exam has no `student_id` for an
   * ownership-by-student sweep to find — so it pinned the level and the teardown
   * failed on `exam_level_id_fkey`. Grades first: they are Restrict on the exam.
   */
  const myExams = await prisma.exam.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  if (myExams.length > 0) {
    const examIds = myExams.map((e) => e.id);
    await prisma.grade.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
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

  it('APPROVING NOW EXECUTES — the decision and the destruction are one action', async () => {
    /**
     * **This assertion was inverted by decision, not by drift.** It previously
     * read *«approving records a decision and DELETES NOTHING»*, which was the
     * honest description of a control plane whose destructive half §4.10a's open
     * classifications had blocked. The Owner settled those on 2026-09-04, and a
     * request left approved-but-alive is a state in which the person has been
     * told her data is gone while it is not.
     */
    const subject = await subjectWithHistory();
    const row = await requestFullDeletion(prisma, await actorFor(prisma, subject.id), subject.id);

    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    const stored = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe('approved');
    expect(stored.decidedById).toBe(superAdmin);
    // The stamp is written LAST, so its presence means everything before it
    // committed. That is the whole defence against a partial deletion reported
    // as a finished one.
    expect(stored.executedAt).not.toBeNull();

    expect(await prisma.enrollment.count({ where: { id: subject.enrolmentId } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
    expect(user.deletedAt).not.toBeNull();
    expect(user.nameArabic).not.toContain(TAG);
    // §4.10a: Option A keeps the reference code, Option B removes it — it must
    // never be a hidden back door into history Option B was approved to delete.
    expect(user.referenceCode).toBeNull();
  });

  it('destroys every educational record §4.10a names, and nothing beyond it', async () => {
    const her = await makeUser('مستفيدة كاملة السجل');
    const teacher = await makeUser('مؤطِّرة', false);
    const enrolment = await prisma.enrollment.create({
      data: { studentId: her, administrativeGroupId: groupId, levelId, branchId },
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
      data: { examId: exam.id, studentId: her, score: 18, status: 'published', publishedAt: new Date() },
    });
    const log = await prisma.quranProgressLog.create({
      data: {
        studentId: her,
        surahId: 1,
        startAyah: 1,
        endAyah: 7,
        category: 'new_memorization',
        loggedById: teacher,
      },
    });

    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    expect(await prisma.enrollment.count({ where: { id: enrolment.id } })).toBe(0);
    expect(await prisma.grade.count({ where: { id: grade.id } })).toBe(0);
    expect(await prisma.quranProgressLog.count({ where: { id: log.id } })).toBe(0);
    /**
     * **The exam survives, and that is the boundary.** A teacher-authored
     * assessment is not in §4.10a's list — her grades and submissions for it
     * are — and R126 gives exams their own deletion-evidence guard. Deleting one
     * because a beneficiary who sat it asked for deletion would destroy another
     * person's work.
     */
    expect(await prisma.exam.count({ where: { id: exam.id } })).toBe(1);
  });

  it("destroys the application carrying her copied identity, not her guardian's others", async () => {
    /**
     * **§4.10a's blind spot, closed** (Owner Section 6, 2026-09-04).
     * `ChildApplication` holds her names, sex and birth date INDEPENDENTLY of
     * the `User` row, so a deletion that cleared the account and left the
     * application intact would have deleted nothing at all.
     */
    const her = await makeUser('طفلة');
    const guardian = await makeUser('ولية أمر', false);
    const sibling = await makeUser('أخت', true);
    const consentText = await prisma.legalConsentText.findFirst({
      select: { id: true, versionLabel: true },
    });
    const mk = async (childUserId: string) =>
      (
        await prisma.childApplication.create({
          data: {
            requestId: randomUUID(),
            parentId: guardian,
            firstNameArabic: `${TAG}`,
            lastNameArabic: 'اسم منسوخ',
            sex: 'female',
            birthDate: new Date('2012-05-05T00:00:00.000Z'),
            consentDataProcessing: true,
            consentMediaRelease: false,
            consentTextVersion: consentText?.versionLabel ?? 'test',
            ...(consentText ? { consentTextId: consentText.id } : {}),
            consentGivenAt: new Date(),
            status: 'approved',
            decidedAt: new Date(),
            decidedById: superAdmin,
            childUserId,
          },
        })
      ).id;
    const hers = await mk(her);
    const siblings = await mk(sibling);
    // A guardian's basis is a LIVE approved link, not an application she once
    // submitted — the authority is the relationship, checked at the moment of
    // asking (§4.10a).
    await approvedLink(guardian, her);

    const row = await requestFullDeletion(prisma, await actorFor(prisma, guardian), her);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    expect(await prisma.childApplication.count({ where: { id: hers } })).toBe(0);
    // Her guardian's application about ANOTHER child is somebody else's record.
    expect(await prisma.childApplication.count({ where: { id: siblings } })).toBe(1);
  });

  it('leaves no Trash able to restore any of it (Owner Section 7 — Choice A)', async () => {
    const subject = await subjectWithHistory();
    await prisma.trash.create({
      data: {
        targetEntity: 'Enrollment',
        targetId: subject.enrolmentId,
        snapshot: { studentId: subject.id, note: 'restorable copy' },
        purgeAfter: new Date('2999-01-01T00:00:00.000Z'),
      },
    });

    const row = await requestFullDeletion(prisma, await actorFor(prisma, subject.id), subject.id);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    // Option B means the data is intentionally not recoverable through the
    // ordinary Trash. A surviving snapshot would be both a copy of what was
    // deleted and a false offer to bring it back.
    expect(await prisma.trash.count({ where: { targetId: subject.enrolmentId } })).toBe(0);
    expect(await prisma.trash.count({ where: { targetId: subject.id } })).toBe(0);
  });

  it('ANOTHER beneficiary in the same group keeps everything', async () => {
    const her = await makeUser('صاحبة الطلب');
    const other = await makeUser('زميلتها');
    const hers = await prisma.enrollment.create({
      data: { studentId: her, administrativeGroupId: groupId, levelId, branchId },
    });
    const theirs = await prisma.enrollment.create({
      data: { studentId: other, administrativeGroupId: groupId, levelId, branchId },
    });

    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    expect(await prisma.enrollment.count({ where: { id: hers.id } })).toBe(0);
    // The single failure that would make this feature unusable.
    expect(await prisma.enrollment.count({ where: { id: theirs.id } })).toBe(1);
    const bystander = await prisma.user.findUniqueOrThrow({ where: { id: other } });
    expect(bystander.deletedAt).toBeNull();
    expect(bystander.nameArabic).toContain(TAG);
  });

  it('keeps minimal consent evidence, and it carries no profile', async () => {
    /**
     * Owner Section 8. `ConsentRecord` holds a type, a decision, an actor, a
     * wording version and timestamps — **no name, no birth date, no contact
     * detail** — so it is already the minimum and there is nothing left to
     * strip. Asserted rather than assumed, because "it does not duplicate the
     * profile" is exactly the kind of claim that quietly stops being true.
     */
    const her = await makeUser('مستفيدة');
    const guardian = await makeUser('ولية أمر', false);
    const consent = await prisma.consentRecord.create({
      data: {
        studentId: her,
        consentType: 'data_processing',
        granted: true,
        grantedByUserId: guardian,
        method: 'online_form',
        consentTextVersion: 'v-test',
      },
    });

    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    const kept = await prisma.consentRecord.findUniqueOrThrow({ where: { id: consent.id } });
    expect(kept.granted).toBe(true);
    expect(JSON.stringify(kept)).not.toContain(TAG);
  });

  it('the audit says WHAT was removed, never a value of it', async () => {
    const subject = await subjectWithHistory();
    const row = await requestFullDeletion(prisma, await actorFor(prisma, subject.id), subject.id);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: row.id, actionType: 'fulldeletion.execute' },
    });
    const detail = JSON.stringify(entry.detail);
    expect(detail).toContain('educational_record');
    // TD-8/TD-14. No name, and no per-table counts either — how many grades she
    // had is itself a fact about her education.
    expect(detail).not.toContain(TAG);
    expect(detail).not.toMatch(/"(grades|attendance)":\s*\d/);
  });

  it('approving twice is SAFE and stamps nothing new', async () => {
    /**
     * **This assertion was inverted too.** A second approval used to be a
     * conflict; now that approving destroys, the repeat must be harmless — a
     * Super Admin double-clicking must not produce a second erasure attempt, and
     * a retry after a crash must succeed.
     */
    const subject = await subjectWithHistory();
    const row = await requestFullDeletion(prisma, await actorFor(prisma, subject.id), subject.id);
    const actor = await actorFor(prisma, superAdmin);
    await approveFullDeletion(prisma, actor, row.id);
    const first = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } });
    const executions = await prisma.auditLog.count({
      where: { targetId: row.id, actionType: 'fulldeletion.execute' },
    });

    await approveFullDeletion(prisma, actor, row.id);

    const second = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(second.executedAt?.toISOString()).toBe(first.executedAt?.toISOString());
    expect(
      await prisma.auditLog.count({
        where: { targetId: row.id, actionType: 'fulldeletion.execute' },
      }),
    ).toBe(executions);
  });

  it('a crash between the decision and the destruction is repaired by approving again', async () => {
    /**
     * Approving and destroying are two COMMITS, because the closure primitives
     * own their own transactions. The state a crash leaves — approved with a
     * null `executed_at` — must be repairable by the obvious action rather than
     * by a second route nobody would think to call.
     */
    const subject = await subjectWithHistory();
    const row = await requestFullDeletion(prisma, await actorFor(prisma, subject.id), subject.id);
    await prisma.fullDeletionRequest.update({
      where: { id: row.id },
      data: { status: 'approved', decidedAt: new Date(), decidedById: superAdmin },
    });

    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    const stored = await prisma.fullDeletionRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.executedAt).not.toBeNull();
    expect(await prisma.enrollment.count({ where: { id: subject.enrolmentId } })).toBe(0);
  });

  it('nothing can resurrect the account — no login, no code, no stale claim', async () => {
    const her = await makeUser('مستفيدة مستقلة');
    await makeSelfManaged(her);
    await prisma.userIdentity.create({
      data: {
        userId: her,
        provider: 'google',
        providerSubjectId: `fd-exec-${Date.now()}`,
        email: `fd-exec-${Date.now()}@example.com`,
        isActive: true,
      },
    });

    const row = await requestFullDeletion(prisma, await actorFor(prisma, her), her);
    await approveFullDeletion(prisma, await actorFor(prisma, superAdmin), row.id);

    // The credential is gone, so there is nothing to sign in with; the code is
    // gone, so no claim can name her; and the account is soft-deleted, which is
    // what every claim lookup filters on.
    expect(await prisma.userIdentity.count({ where: { userId: her } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: her } });
    expect(user.referenceCode).toBeNull();
    expect(user.deletedAt).not.toBeNull();
    // The approved claim survives as the record of a decision — and grants
    // nothing, because there is no longer an account for it to grant over.
    expect(
      await prisma.selfManagedClaim.count({ where: { beneficiaryId: her, status: 'approved' } }),
    ).toBe(1);
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
    // Three facts now, because approving executes: what was asked, what was
    // decided, and what was destroyed. Pinned as an exact set rather than a
    // `toContain`, so a fourth action type cannot appear unnoticed on the one
    // trail that has to answer «what happened to her data».
    expect(rows.map((r) => r.actionType).sort()).toEqual([
      'fulldeletion.approve',
      'fulldeletion.execute',
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
