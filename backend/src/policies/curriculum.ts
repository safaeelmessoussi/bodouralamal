import type { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';

/**
 * **What a Level teaches** — the `LevelSubject` rule, stated once (§4.4b, R43).
 *
 * ## Why this is a policy and not three checks
 *
 * A Subject reaches a Level only through `LevelSubject`. Three surfaces depend
 * on that — splitting a Subject into Teaching Groups, scheduling a class, and
 * attaching educational content — and until this module existed, **two of them
 * enforced it and one did not**:
 *
 * | Surface | Before |
 * |---|---|
 * | `teaching-group.service.ts` | refused, `SUBJECT_NOT_IN_LEVEL` |
 * | `content.service.ts` | refused, `SUBJECT_NOT_AT_LEVEL` — *a second spelling of the same rule* |
 * | `course-schedule.service.ts` | **did not check at all** |
 *
 * The consequence was visible in the live database: three Course Schedules
 * existed while `level_subject` held **zero rows**, so the platform was
 * delivering Subjects at Levels that officially teach nothing — and then
 * refusing to attach content to those very classes. One rule, enforced in two
 * places out of three, with two different names, is the shape of drift this
 * project has been bitten by repeatedly.
 *
 * ## The reason code
 *
 * `SUBJECT_NOT_IN_LEVEL`, which predates the other spelling. It is a **stable
 * code**: clients render it, so the older name wins over the one that reads
 * marginally better.
 */

/** Accepts a transaction client so the check joins the caller's transaction —
 *  a pairing verified outside it could be revoked before the write lands. */
type Db = Pick<Prisma.TransactionClient, 'levelSubject'>;

export async function assertSubjectTaughtAtLevel(
  db: Db,
  levelId: string,
  subjectId: string,
): Promise<void> {
  const assigned = await db.levelSubject.findFirst({
    where: {
      levelId,
      subjectId,
      deletedAt: null,
      // A Level or Subject that is itself deleted teaches nothing: the join row
      // can outlive either, and treating a dangling assignment as valid is how
      // a deleted Subject keeps appearing on a form.
      level: { deletedAt: null },
      subject: { deletedAt: null },
    },
    select: { id: true },
  });

  if (!assigned) {
    throw new AppError('STATE_CONFLICT', 'subject is not assigned to this level', {
      reason: 'SUBJECT_NOT_IN_LEVEL',
      level_id: levelId,
      subject_id: subjectId,
    });
  }
}
