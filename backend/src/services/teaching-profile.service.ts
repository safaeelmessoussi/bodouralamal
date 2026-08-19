import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { firstOverlap } from '../policies/teaching-profile.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * **The teaching profile (§E, R88) — planning data, never authority.**
 *
 * What a مؤطِّرة declares she can teach and when she is free, so the
 * administration can build the year's schedule. **It authorises nothing**: a
 * person who declares Quran and is assigned no Quran class reaches no
 * beneficiary's memorisation, and one assigned a Subject she never declared
 * teaches it with full authority the moment the assignment exists. That
 * separation is the whole point of the entity, and it is asserted in the tests
 * rather than merely stated here.
 *
 * **Administration owns it for now** (R88.2). Teacher self-service is a
 * different decision — who may assert their own availability, and whether the
 * administration may then rely on it — and the Owner has not taken it.
 *
 * **Replaced whole, not patched.** The profile is three small sets, and a
 * partial update over three tables invites the half-applied state where the
 * Subjects moved and the availability did not. One transaction, one meaning:
 * *this is her profile now*.
 */

export interface AvailabilityInput {
  weekday: string;
  startTime: string;
  endTime: string;
}

export interface TeachingProfileInput {
  subjectIds: string[];
  categoryIds: string[];
  availability: AvailabilityInput[];
}

export interface TeachingProfile {
  userId: string;
  subjects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  availability: { id: string; weekday: string; start_time: string; end_time: string }[];
}

/** Managing somebody's planning data is an administrative act (TD-2). */
function assertMayManage(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes) && !scope.hasRole(actor.roleScopes, 'admin')) {
    throw new AppError('FORBIDDEN', 'managing a teaching profile requires an administrator');
  }
}

const time = (d: Date): string => d.toISOString().slice(11, 16);
const asTime = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);

export async function readTeachingProfile(
  prisma: PrismaClient,
  actor: Actor,
  userId: string,
): Promise<TeachingProfile> {
  assertMayManage(actor);

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new AppError('NOT_FOUND', 'no such user');

  const [subjects, categories, availability] = await Promise.all([
    prisma.teacherSubjectCapability.findMany({
      where: { userId },
      select: { subject: { select: { id: true, name: true } } },
      orderBy: { subject: { displayOrder: 'asc' } },
    }),
    prisma.teacherCategoryCapability.findMany({
      where: { userId },
      select: { category: { select: { id: true, name: true } } },
      orderBy: { category: { displayOrder: 'asc' } },
    }),
    prisma.teacherAvailability.findMany({
      where: { userId },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    }),
  ]);

  return {
    userId,
    subjects: subjects.map((r) => r.subject),
    categories: categories.map((r) => r.category),
    availability: availability.map((r) => ({
      id: r.id,
      weekday: String(r.weekday),
      start_time: time(r.startTime),
      end_time: time(r.endTime),
    })),
  };
}

/**
 * Replaces the whole profile.
 *
 * **Overlapping ranges on one day are refused** rather than normalised: two
 * readings exist for what an overlap means and neither is canonical, so the
 * platform asks rather than guesses. **Touching ranges are accepted** —
 * 09:00–12:00 and 12:00–15:00 are how somebody free across both writes it, and
 * refusing would make her restate her own availability to satisfy the store.
 */
export async function replaceTeachingProfile(
  prisma: PrismaClient,
  actor: Actor,
  userId: string,
  input: TeachingProfileInput,
): Promise<TeachingProfile> {
  assertMayManage(actor);

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new AppError('NOT_FOUND', 'no such user');

  // Duplicates within one request are the caller repeating itself, not two
  // declarations — collapsed rather than refused.
  const subjectIds = [...new Set(input.subjectIds)];
  const categoryIds = [...new Set(input.categoryIds)];

  const [subjects, categories] = await Promise.all([
    prisma.subject.findMany({ where: { id: { in: subjectIds }, deletedAt: null }, select: { id: true } }),
    prisma.category.findMany({ where: { id: { in: categoryIds }, deletedAt: null }, select: { id: true } }),
  ]);
  // **A retired Subject is refused, not silently dropped**: a profile that
  // quietly loses a declaration would have the administration planning against
  // something it cannot see.
  if (subjects.length !== subjectIds.length) {
    throw new AppError('VALIDATION_FAILED', 'one of those subjects does not exist', {
      reason: 'UNKNOWN_SUBJECT',
    });
  }
  if (categories.length !== categoryIds.length) {
    throw new AppError('VALIDATION_FAILED', 'one of those categories does not exist', {
      reason: 'UNKNOWN_CATEGORY',
    });
  }

  const ranges = input.availability.map((a) => ({
    weekday: a.weekday,
    start: a.startTime,
    end: a.endTime,
  }));
  const clash = firstOverlap(ranges);
  if (clash) {
    throw new AppError('VALIDATION_FAILED', 'two availability ranges overlap', {
      reason: 'OVERLAPPING_AVAILABILITY',
      ranges: clash,
    });
  }

  await prisma.$transaction(async (tx) => {
    // Replaced whole: three `deleteMany`s and three inserts express *this is her
    // profile now*, where a diff would invite the half-applied state.
    await tx.teacherSubjectCapability.deleteMany({ where: { userId } });
    await tx.teacherCategoryCapability.deleteMany({ where: { userId } });
    await tx.teacherAvailability.deleteMany({ where: { userId } });

    if (subjectIds.length > 0) {
      await tx.teacherSubjectCapability.createMany({
        data: subjectIds.map((subjectId) => ({ userId, subjectId })),
      });
    }
    if (categoryIds.length > 0) {
      await tx.teacherCategoryCapability.createMany({
        data: categoryIds.map((categoryId) => ({ userId, categoryId })),
      });
    }
    if (input.availability.length > 0) {
      await tx.teacherAvailability.createMany({
        data: input.availability.map((a) => ({
          userId,
          weekday: a.weekday as never,
          startTime: asTime(a.startTime),
          endTime: asTime(a.endTime),
        })),
      });
    }

    // TD-8 — planning decisions are administrative acts about a person, and
    // *who decided she teaches Quran* is a question somebody will ask later.
    await audit.write(tx as unknown as Prisma.TransactionClient, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'settings.change',
      targetEntity: 'User',
      targetId: userId,
      detail: {
        teaching_profile: {
          subjects: subjectIds.length,
          categories: categoryIds.length,
          availability: input.availability.length,
        },
      },
    });

  });

  /**
   * **Read AFTER the transaction commits, not inside it.**
   *
   * The first version returned `readTeachingProfile(prisma, …)` from within the
   * callback: `prisma` is not `tx`, so it read the state as it was BEFORE the
   * writes — the caller got an empty profile back and a test caught it
   * immediately. Reading through `tx` would work too; reading afterwards is
   * clearer about what the answer describes.
   */
  return readTeachingProfile(prisma, actor, userId);
}
