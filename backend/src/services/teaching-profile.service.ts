import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { firstOverlap } from '../policies/teaching-profile.js';
import * as audit from '../repositories/audit.repository.js';
import { assertStaffAccountsAvailable } from './staffing-integrity.service.js';

/**
 * **The teaching profile (§E, R88) — planning data, never authority.**
 *
 * What a مؤطِّرة declares she can teach and when she is free, so the
 * administration can build the year's schedule. **It authorises nothing**: a
 * person who declares حفظ القرآن and is assigned no حفظ class reaches no
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
  mode?: 'in_person' | 'online' | 'both' | null;
}

export interface TeachingProfileInput {
  subjectIds: string[];
  categoryIds: string[];
  availability: AvailabilityInput[];
}

export interface TeachingProfile {
  userId: string;
  /**
   * General willingness captured with the staff request (R115). It remains
   * read-only here: a weekly range and an approval-time preference answer
   * different planning questions, and neither is authority.
   */
  framing: {
    mode: 'in_person' | 'online' | 'both';
    all_branches: boolean;
    branches: { id: string; name: string }[];
  } | null;
  subjects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  availability: {
    id: string;
    weekday: string;
    start_time: string;
    end_time: string;
    mode: 'in_person' | 'online' | 'both' | null;
  }[];
}

/**
 * Her own profile **plus what she may choose from** (Owner, 2026-08-30).
 *
 * Only `GET /me/teaching-profile` returns this. The catalogue is carried on the
 * read she already makes rather than sent to a separate endpoint, because the
 * alternative was to let a مؤطِّرة call `/admin/subjects` — and **widening a
 * permission to make a screen work is the one fix that is never right** (rule
 * O). It is also rule AX: the form that decides what is saved contains the
 * options it saves from.
 *
 * Names only, and only live rows. Subjects and Categories are curriculum
 * reference data she already sees on her own schedules; this discloses no
 * person, no enrolment and nothing about anybody else.
 */
export interface OwnTeachingProfile extends TeachingProfile {
  selectable_subjects: { id: string; name: string }[];
  selectable_categories: { id: string; name: string }[];
}

/** Managing somebody's planning data is an administrative act (TD-2). */
function assertMayManage(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes) && !scope.hasRole(actor.roleScopes, 'admin')) {
    throw new AppError('FORBIDDEN', 'managing a teaching profile requires an administrator');
  }
}

/**
 * **The capability rules, stated once** (2026-08-30).
 *
 * Both writers apply them: the administrator replacing somebody's profile and,
 * since the Owner opened it, the مؤطِّرة replacing her own. Extracted rather
 * than copied — a second statement of *«a retired Subject is refused»* is a
 * second statement that can drift, and the self-service path is exactly where a
 * looser copy would not be noticed.
 */
async function resolveCapabilities(
  prisma: PrismaClient,
  rawSubjectIds: readonly string[],
  rawCategoryIds: readonly string[],
): Promise<{ subjectIds: string[]; categoryIds: string[] }> {
  // Duplicates within one request are the caller repeating itself, not two
  // declarations — collapsed rather than refused.
  const subjectIds = [...new Set(rawSubjectIds)];
  const categoryIds = [...new Set(rawCategoryIds)];

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
  return { subjectIds, categoryIds };
}

const time = (d: Date): string => d.toISOString().slice(11, 16);
const asTime = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);

/**
 * **Who may enter her OWN availability** (SRS Revision 106).
 *
 * R88.2 reserved this question in terms — *"a مؤطِّرة may not edit her own,
 * because who may assert their own availability, and whether the administration
 * may then rely on it, is a separate decision the Owner has not taken."* The
 * Owner has now taken it, and R106 grants **availability only**: what she can
 * TEACH stays the administration's (R88.2), because a declaration of capability
 * is the association's planning record of her, while a declaration of *when she
 * is free* is a statement only she can make.
 *
 * **The grant is safe for a reason worth keeping in front of the next reader:**
 * R88.3 makes availability planning data that grants nothing — no beneficiary,
 * no memorisation, no grade, no content, no occurrence — and R88.4 makes a
 * mismatch WARN rather than block. So unlike `CourseScheduleStaff`, which is
 * authority, nothing here can widen her reach. That asymmetry is exactly why
 * R106 is a small decision and why creating a Recurring Course Schedule
 * (TD-2 `⊘`, R71.0/R94.2) remains a large one that is NOT granted.
 */
function assertIsTeacher(actor: Actor): void {
  if (!scope.hasRole(actor.roleScopes, 'teacher')) {
    throw new AppError('FORBIDDEN', 'entering your own availability requires the teaching role');
  }
}

/**
 * **R88.6 — overlapping ranges on one day are refused; touching ranges are not.**
 *
 * Shared by the administrative writer and by R106's self-service one, because
 * *what counts as a clash* is one rule about one model. Written twice it would
 * be two rules that happen to agree today, and this project's own record says
 * the copy that drifts still passes its own tests.
 */
function assertNoOverlap(availability: readonly AvailabilityInput[]): void {
  const clash = firstOverlap(
    availability.map((a) => ({ weekday: a.weekday, start: a.startTime, end: a.endTime })),
  );
  if (clash) {
    throw new AppError('VALIDATION_FAILED', 'two availability ranges overlap', {
      reason: 'OVERLAPPING_AVAILABILITY',
      ranges: clash,
    });
  }
}

/** The profile itself, with no authorization of its own — every caller above
 *  has already decided whose profile it may read, and doing it once is what
 *  keeps the two readers returning the same shape. */
async function loadProfile(prisma: PrismaClient, userId: string): Promise<TeachingProfile> {
  const [framing, subjects, categories, availability] = await Promise.all([
    prisma.framingPreference.findUnique({
      where: { userId },
      select: {
        mode: true,
        allBranches: true,
        branches: {
          select: { branch: { select: { id: true, name: true } } },
          orderBy: { branch: { name: 'asc' } },
        },
      },
    }),
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
    framing: framing
      ? {
          mode: framing.mode,
          all_branches: framing.allBranches,
          branches: framing.branches.map((entry) => entry.branch),
        }
      : null,
    subjects: subjects.map((r) => r.subject),
    categories: categories.map((r) => r.category),
    availability: availability.map((r) => ({
      id: r.id,
      weekday: String(r.weekday),
      start_time: time(r.startTime),
      end_time: time(r.endTime),
      mode: r.mode,
    })),
  };
}

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

  return loadProfile(prisma, userId);
}

/**
 * **Her own profile, read by her** (R106).
 *
 * The whole profile, not only the availability half: she is shown what the
 * administration has recorded she can teach — read-only — beside the ranges she
 * may edit. Showing only the editable half would leave her entering
 * availability with no idea what it is availability *for*, and the declared
 * Subjects are hers in the sense that they describe her.
 */
export async function readOwnTeachingProfile(
  prisma: PrismaClient,
  actor: Actor,
): Promise<OwnTeachingProfile> {
  assertIsTeacher(actor);
  const [profile, subjects, categories] = await Promise.all([
    loadProfile(prisma, actor.userId),
    prisma.subject.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return { ...profile, selectable_subjects: subjects, selectable_categories: categories };
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

  const { subjectIds, categoryIds } = await resolveCapabilities(
    prisma,
    input.subjectIds,
    input.categoryIds,
  );

  assertNoOverlap(input.availability);

  await prisma.$transaction(async (tx) => {
    // R111 — the preflight lookup above gives the ordinary missing-target 404,
    // but it cannot govern the write: permanent account deletion may commit
    // between that read and this transaction. Take the same User lock as
    // deletion, then revalidate, so a stale profile save cannot recreate
    // planning satellites after final de-identification.
    await assertStaffAccountsAvailable(tx, [userId]);

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
          mode: a.mode ?? null,
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

/**
 * **`متى أنا متاحة` — she replaces her own availability, and nothing else**
 * (R106).
 *
 * ## Availability only, deliberately
 *
 * `TeacherSubjectCapability` and `TeacherCategoryCapability` are **not
 * touched** — not read, not written, not cleared. That is the difference
 * between this and `replaceTeachingProfile`, and it is the reason this is a
 * separate function rather than the same one with a looser guard: a shared
 * writer taking a partial profile would clear her declared Subjects the first
 * time a caller omitted them, which is precisely how a whole-object PUT
 * destroys the half nobody sent.
 *
 * ## The same model, the same rule, the same trail
 *
 * One `TeacherAvailability` table, one `assertNoOverlap`, one `settings.change`
 * audit row. R106 adds no parallel availability model, and the administration
 * reads exactly what she wrote through the endpoint it already has.
 *
 * The audit detail records **`self_service: true`**, because R88.2's open
 * question was *whether the administration may then rely on it* — and the
 * honest answer to that is legible only if the record says who asserted it.
 */
/**
 * **`المواد التي يمكنني تدريسها` و`الفئات` — she replaces her own declarations**
 * (Owner, 2026-08-30).
 *
 * ## What changed, and what did not
 *
 * R88.2 refused this in terms — *"a مؤطِّرة may not edit her own"* — and R106
 * took only the availability half. **The Owner has now taken the other half.**
 * `/teacher/availability` therefore stops rendering the capabilities as
 * read-only text and offers the same two controls the administrator's dialog
 * has, against the same two tables.
 *
 * ## It still grants nothing (R88.3, §4.4c, R73, R87)
 *
 * This is the part that must not be misread. `TeacherSubjectCapability` and
 * `TeacherCategoryCapability` are **planning metadata**: *«I can teach Quran»*
 * is information for the administration, not authorization.
 *
 * Teaching authority is an **assignment** — `CourseScheduleStaff` /
 * `SessionStaff`, resolved through `studentsTaughtBy` — and nothing here writes
 * either. So a مؤطِّرة declaring every Subject on the platform gains access to
 * no student, no class and no grade sheet; she has only told the administration
 * what to consider her for. That separation is what makes this grant safe, and
 * it is asserted rather than assumed.
 *
 * ## Her OWN profile, and only that
 *
 * There is **no `{id}` in the route** (`PUT /me/teaching-profile/capabilities`),
 * so there is nowhere in the request to name another person — the same
 * construction `replaceOwnAvailability` and `/students/me/quran` use. The
 * subject is the token's `sub`; a forged body cannot move it.
 *
 * ## Availability is untouched
 *
 * Deliberately a separate writer from `replaceOwnAvailability`, not a widened
 * one: she may be editing one and not the other, and a single whole-profile
 * self-service write would let a stale tab silently erase the half it did not
 * load. Each statement replaces only what it is about.
 *
 * `self_service: true` in the audit for R88.2's original reason — *whether the
 * administration may rely on it* is answerable only if the record says who
 * asserted it.
 */
export async function replaceOwnCapabilities(
  prisma: PrismaClient,
  actor: Actor,
  input: { subjectIds: readonly string[]; categoryIds: readonly string[] },
): Promise<OwnTeachingProfile> {
  assertIsTeacher(actor);

  const { subjectIds, categoryIds } = await resolveCapabilities(
    prisma,
    input.subjectIds,
    input.categoryIds,
  );

  await prisma.$transaction(async (tx) => {
    // A still-valid access token is not permission to recreate planning rows
    // after this account has been deleted — the same R111 lock the other two
    // writers take, and for the same reason.
    await assertStaffAccountsAvailable(tx, [actor.userId]);

    // Replaced whole: *these are my declarations now*. A diff would invite the
    // half-applied state the whole-profile writer's docstring describes.
    await tx.teacherSubjectCapability.deleteMany({ where: { userId: actor.userId } });
    await tx.teacherCategoryCapability.deleteMany({ where: { userId: actor.userId } });

    if (subjectIds.length > 0) {
      await tx.teacherSubjectCapability.createMany({
        data: subjectIds.map((subjectId) => ({ userId: actor.userId, subjectId })),
      });
    }
    if (categoryIds.length > 0) {
      await tx.teacherCategoryCapability.createMany({
        data: categoryIds.map((categoryId) => ({ userId: actor.userId, categoryId })),
      });
    }

    await audit.write(tx as unknown as Prisma.TransactionClient, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'settings.change',
      targetEntity: 'User',
      targetId: actor.userId,
      detail: {
        teaching_profile: { subjects: subjectIds.length, categories: categoryIds.length },
        self_service: true,
      },
    });
  });

  // The same shape the read answers, so a save leaves the page with everything
  // it needs — including the catalogue — rather than a profile missing the half
  // its own controls are built from.
  return readOwnTeachingProfile(prisma, actor);
}

export async function replaceOwnAvailability(
  prisma: PrismaClient,
  actor: Actor,
  availability: readonly AvailabilityInput[],
): Promise<OwnTeachingProfile> {
  assertIsTeacher(actor);
  assertNoOverlap(availability);

  await prisma.$transaction(async (tx) => {
    // A still-valid access token is not permission to recreate availability
    // after this account has been deleted. The governing User lock makes this
    // self-service writer serialize with R111 deletion/de-identification.
    await assertStaffAccountsAvailable(tx, [actor.userId]);

    // Replaced whole, like the administrative writer: *these are my ranges now*
    // is the statement being made, and a diff would invite a half-applied one.
    await tx.teacherAvailability.deleteMany({ where: { userId: actor.userId } });
    if (availability.length > 0) {
      await tx.teacherAvailability.createMany({
        data: availability.map((a) => ({
          userId: actor.userId,
          weekday: a.weekday as never,
          startTime: asTime(a.startTime),
          endTime: asTime(a.endTime),
          mode: a.mode ?? null,
        })),
      });
    }

    await audit.write(tx as unknown as Prisma.TransactionClient, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'settings.change',
      targetEntity: 'User',
      targetId: actor.userId,
      detail: {
        teaching_profile: { availability: availability.length },
        // R88.2 asked whether the administration may rely on a self-asserted
        // range. Recording WHO asserted it is what makes that answerable later.
        self_service: true,
      },
    });
  });

  return readOwnTeachingProfile(prisma, actor);
}
