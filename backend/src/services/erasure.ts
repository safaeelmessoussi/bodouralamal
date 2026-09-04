import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * **The one destruction of a beneficiary's educational record** (SRS §4.10a).
 *
 * Two callers reach it, and they are two *policies* rather than two operations:
 *
 * * **Option B** — she asked, and a Super Admin approved.
 * * **The ten-year retention boundary** — nobody asked; the calendar arrived.
 *
 * The data treatment is identical, so the code is. The Owner's instruction was
 * explicit about this: reuse one primitive where the treatment is actually the
 * same, and do not force reuse where it is not. What differs between the two —
 * who authorised it, what gets stamped afterwards, what the audit row says — is
 * the caller's business and stays there.
 *
 * ## Every id is collected BEFORE anything is deleted
 *
 * A `Trash` snapshot is found by the id of the row it can restore, and that id
 * is unreachable once the row is gone. The first version of this collected only
 * submission and application ids, and a snapshot of a deleted enrolment survived
 * the deletion — a restorable copy of exactly the record that had just been
 * destroyed. The ordering below is not stylistic.
 *
 * ## It touches nothing belonging to anybody else
 *
 * Every delete is keyed on `student_id`, on an id belonging to this subject, or
 * on a `Trash` entry naming one of them. **`ChildApplication` rows are matched on
 * `child_user_id` and `matched_existing_user_id` only** — a `parent_id` row is
 * her guardian's application about a different child and is somebody else's
 * record.
 */
export async function destroyEducationalRecord(
  tx: Prisma.TransactionClient,
  subjectId: string,
): Promise<void> {
  const byStudent = { studentId: subjectId } as const;
  const [submissions, grades, attendance, quranLogs, surahProgress, groupLinks, enrolments] =
    await Promise.all([
      tx.studentExamSubmission.findMany({ where: byStudent, select: { id: true } }),
      tx.grade.findMany({ where: byStudent, select: { id: true } }),
      tx.attendance.findMany({ where: byStudent, select: { id: true } }),
      tx.quranProgressLog.findMany({ where: byStudent, select: { id: true } }),
      tx.studentSurahProgress.findMany({ where: byStudent, select: { id: true } }),
      tx.studentTeachingGroup.findMany({ where: byStudent, select: { id: true } }),
      tx.enrollment.findMany({ where: byStudent, select: { id: true } }),
    ]);
  const educationalIds = [
    ...submissions,
    ...grades,
    ...attendance,
    ...quranLogs,
    ...surahProgress,
    ...groupLinks,
    ...enrolments,
  ].map((r) => r.id);

  const submissionIds = submissions.map((r) => r.id);
  if (submissionIds.length > 0) {
    // Answer options cascade from answers; answers are Restrict on the
    // submission, so they go first.
    await tx.studentExamAnswer.deleteMany({ where: { submissionId: { in: submissionIds } } });
  }
  await tx.studentExamSubmission.deleteMany({ where: byStudent });
  await tx.grade.deleteMany({ where: byStudent });
  await tx.attendance.deleteMany({ where: byStudent });
  await tx.quranProgressLog.deleteMany({ where: byStudent });
  await tx.studentSurahProgress.deleteMany({ where: byStudent });
  await tx.studentTeachingGroup.deleteMany({ where: byStudent });
  await tx.enrollment.deleteMany({ where: byStudent });

  /**
   * **The application that carries her copied identity.**
   *
   * `ChildApplication` holds her names, sex and birth date **independently of
   * the `User` row**, so an erasure that cleared the account and left the
   * application intact would have erased nothing at all. The whole row goes
   * rather than being stripped: a husk with every identifying column nulled
   * still carries a `consent_text_version` recording consent for a child whose
   * record no longer exists — evidence with nothing left to evidence — and the
   * decision itself survives in the audit trail, which has its own purpose and
   * its own schedule.
   */
  const applications = await tx.childApplication.findMany({
    where: { OR: [{ childUserId: subjectId }, { matchedExistingUserId: subjectId }] },
    select: { id: true },
  });
  const applicationIds = applications.map((a) => a.id);
  if (applicationIds.length > 0) {
    await tx.childApplication.deleteMany({ where: { id: { in: applicationIds } } });
  }

  // Every tombstone naming a row this transaction destroyed. Keyed on the ids
  // themselves rather than on entity names, so nothing belonging to anybody else
  // can be caught by it.
  const destroyed = [...educationalIds, ...applicationIds];
  if (destroyed.length > 0) {
    await tx.trash.deleteMany({ where: { targetId: { in: destroyed } } });
  }
  await tx.trash.deleteMany({ where: { targetId: subjectId } });
}
