import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as scope from '../policies/branch-scope.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import { enqueue, JOB_QUEUES } from '../repositories/jobs.repository.js';
import type { Actor } from '../policies/actor.js';
import { assertStaffAccountsAvailable } from './staffing-integrity.service.js';

/**
 * The Trash — **soft-deleted records, browsable; restorable where restoration is
 * PROVEN** (§7, TD-5, BR-15, SRS Revision 52).
 *
 * ## Why restoration is per entity type rather than a single button
 *
 * §7 states the hazard and this service exists to respect it:
 *
 * > the runbook **must explicitly capture and reinstate the relationship rows the
 * > TD-5 cascade removed** — `FamilyLink`, `Enrollment`, `StudentTeachingGroup`,
 * > `CourseScheduleStaff`, `UserBranchRole` and `UserIdentity` deactivations —
 * > **a User restored without their links, enrollments and roles is a
 * > half-restored, silently broken account.**
 *
 * Clearing `deleted_at` is the easy tenth of the problem, and every failure of
 * the other nine is **silent**: the row returns, every screen looks right, and
 * the person is enrolled in nothing.
 *
 * So the capability is decided **here, per entity type, and published on every
 * row** — never inferred by a client. A screen cannot know which deletions
 * cascade, and one that guessed would offer a button that quietly breaks people.
 *
 * ## What makes a type restorable
 *
 * **Its deletion is GUARDED rather than CASCADING.** These four refuse to delete
 * while anything references them — a Branch with rooms, a Subject a Level still
 * teaches — so nothing was removed alongside them and clearing the tombstone
 * genuinely restores the whole record.
 *
 * Everything else cascades and stays read-only until its reinstatement is
 * written and tested: a `Level` takes its Administrative Groups, a
 * `TeachingGroup` releases its members, a `RecurringCourseSchedule` removes
 * future Sessions, and a `User` reaches all six relationship types above.
 */
/** The delegate names on a transaction client — `keyof PrismaClient` would
 *  include `$connect` and friends, which are not models. */
type ModelName =
  | 'branch'
  | 'category'
  | 'subject'
  | 'room'
  | 'exam'
  | 'hijriMonthStart'
  | 'user';

/** Delegates a purge plan may destroy. Separate from `ModelName` because the
 *  restorable set and the purgeable set are different questions. */
type PurgeModel =
  | ModelName
  | 'event'
  | 'recurringCourseSchedule'
  | 'session'
  | 'educationalContent'
  | 'administrativeGroup'
  | 'teachingGroup'
  | 'level'
  | 'enrollment'
  | 'studentTeachingGroup'
  | 'levelSubject'
  | 'sessionContent'
  | 'familyLink'
  | 'examStaff'
  | 'courseScheduleStaff'
  | 'sessionStaff'
  | 'eventBranch'
  | 'eventCategory'
  | 'eventLevel'
  | 'eventAdministrativeGroup'
  | 'levelSurah'
  | 'hijriMonthStart';

/**
 * Compile-time bridge from each declared owned-child delegate to its generated
 * Prisma filter fields. Purge plans are necessarily dynamic, but their FK names
 * must not be untyped strings: `SessionContent` maps the database column
 * `educational_content_id` to the Prisma field `contentId`, and the former
 * `educationalContentId` assumption made every content purge fail at runtime.
 */
interface ChildWhereByModel {
  eventBranch: Prisma.EventBranchWhereInput;
  eventCategory: Prisma.EventCategoryWhereInput;
  eventLevel: Prisma.EventLevelWhereInput;
  eventAdministrativeGroup: Prisma.EventAdministrativeGroupWhereInput;
  levelSurah: Prisma.LevelSurahWhereInput;
  studentTeachingGroup: Prisma.StudentTeachingGroupWhereInput;
  sessionStaff: Prisma.SessionStaffWhereInput;
  sessionContent: Prisma.SessionContentWhereInput;
  examStaff: Prisma.ExamStaffWhereInput;
}

type DeclaredChild = {
  [Model in keyof ChildWhereByModel]: {
    model: Model;
    fk: Extract<keyof ChildWhereByModel[Model], string>;
  };
}[keyof ChildWhereByModel];

const RESTORABLE: Record<
  string,
  {
    model: ModelName;
    parent?: { field: string; model: ModelName };
    /** Rows soft-deleted WITH the record, un-deleted with it. Only where the
     *  reinstatement is a single well-defined statement (R59.3). */
    children?: DeclaredChild[];
  }
> = {
  /**
   * R111 is the deliberate exception to the older User-cascade warning below.
   * Account soft deletion removes no relationship row: it stamps `deleted_at`,
   * revokes sessions and keeps identity, roles, family and educational history
   * intact during the three-day window. Clearing the tombstone is therefore a
   * complete restoration; revoked credentials stay revoked and the person signs
   * in again. Permanent de-identification removes the Trash row transactionally,
   * so this path can never reconstruct an already-erased identity.
   */
  User: { model: 'user' },
  // No parent: nothing above them can be missing.
  Branch: { model: 'branch' },
  Category: { model: 'category' },
  Subject: { model: 'subject' },
  // A Room belongs to a Branch, and restoring one into a deleted Branch would
  // produce a room nobody can reach — see `restoreEntry`.
  Room: { model: 'room', parent: { field: 'branchId', model: 'branch' } },
  /**
   * **R59.3 — the first CASCADING type to join the set**, and it qualifies for
   * the reason the standard has always named: its reinstatement is *written and
   * tested*, not assumed. Deleting an exam soft-deletes exactly one child table,
   * `ExamStaff`, and bringing those rows back is one statement — unlike a `User`,
   * whose six relationship types are the hazard §7 describes.
   */
  Exam: { model: 'exam', children: [{ model: 'examStaff', fk: 'examId' }] },
  /**
   * R59.5 — nothing cascades, so restoration is the tombstone and nothing else.
   * The withdrawal rule means the run is contiguous when it is put back: only
   * the last month can be withdrawn, so restoring it appends rather than fills.
   */
  HijriMonthStart: { model: 'hijriMonthStart' },
};

/**
 * Why a type cannot be restored yet, in the terms an administrator would use.
 *
 * **Stable codes**: they appear in the API response and a screen renders them,
 * so renaming one changes what an administrator is told about their own data.
 */
const BLOCKED_REASON: Record<string, string> = {
  Level: 'CASCADE_CHILDREN',
  AdministrativeGroup: 'CASCADE_CHILDREN',
  TeachingGroup: 'CASCADE_CHILDREN',
  // Deleting a schedule takes its unprotected future occurrences with it, and a
  // restore has to decide which of them to bring back — `session.materialize`
  // would regenerate them, but not the ones protection deliberately spared.
  RecurringCourseSchedule: 'CASCADE_CHILDREN',
  Session: 'CASCADE_CHILDREN',
  // An Event's scope joins are HARD deleted, so restoring the row alone would
  // produce an event with no audience — visible to nobody, which is worse than
  // absent because it looks restored.
  Event: 'CASCADE_RELATIONSHIPS',
  Enrollment: 'CASCADE_RELATIONSHIPS',
  StudentTeachingGroup: 'CASCADE_RELATIONSHIPS',
  FamilyLink: 'CASCADE_RELATIONSHIPS',
  EducationalContent: 'CASCADE_RELATIONSHIPS',
};

/**
 * **What destroying a record actually removes** (R59.1).
 *
 * A purge is irreversible, so the plan is **declared per entity type rather than
 * inferred**, on exactly the reasoning `RESTORABLE` uses above: a generic
 * "delete the row and let the database sort it out" would either fail on a
 * foreign key nobody anticipated, or — worse, if any relation were ever
 * `Cascade` — silently take rows the entry does not describe.
 *
 * ## Owned children versus independent referrers
 *
 * Every plan below lists only the rows that **exist as part of** the record and
 * were removed with it: an Event's four scope joins, a Schedule's staffing and
 * its Sessions, an Exam's supervisors. They have no life of their own, and a
 * purge that left them would leave rows pointing at nothing.
 *
 * Everything else that references the record is a **record in its own right**,
 * and the purge does not touch it. It does not need to enumerate them either:
 * the foreign keys are `Restrict`, so PostgreSQL refuses, and `purgeEntry`
 * turns that refusal into `DEPENDENTS_EXIST`. **The database is the authority on
 * what still points at a row** — a hand-maintained list of blockers would be a
 * second copy of the schema, and it would drift.
 *
 * ## Why `User` has no plan, and is not an oversight
 *
 * A person's row is referenced by `AuditLog` and `Trash` themselves. Destroying
 * it would take the accountability record BR-15 exists to preserve — *who
 * deleted what, and when* — which is the one thing a safeguarding platform may
 * not lose. Account deletion needs its own decision about anonymisation versus
 * destruction, and that decision is R54's, not this one's.
 */
const PURGEABLE: Record<string, { model: PurgeModel; children?: DeclaredChild[] }> = {
  // No owned children: a Branch's rooms, groups and schedules are all records of
  // their own, so a Branch with any of them left is refused rather than emptied.
  Branch: { model: 'branch', children: [{ model: 'eventBranch', fk: 'branchId' }] },
  Category: { model: 'category', children: [{ model: 'eventCategory', fk: 'categoryId' }] },
  Subject: { model: 'subject' },
  Room: { model: 'room' },

  // The Level's curriculum mapping and calendar scope join go with it; its
  // groups, schedules and enrolments are records of their own and block.
  Level: {
    model: 'level',
    children: [
      { model: 'levelSurah', fk: 'levelId' },
      { model: 'eventLevel', fk: 'levelId' },
    ],
  },
  AdministrativeGroup: {
    model: 'administrativeGroup',
    children: [{ model: 'eventAdministrativeGroup', fk: 'administrativeGroupId' }],
  },
  // Its members ARE the group (§4.4c) — a split with nobody in it is not a
  // record somebody would want kept.
  TeachingGroup: {
    model: 'teachingGroup',
    children: [{ model: 'studentTeachingGroup', fk: 'teachingGroupId' }],
  },

  // An Event IS its audience: the four scope joins carry no information apart
  // from the event they scope.
  Event: {
    model: 'event',
    children: [
      { model: 'eventBranch', fk: 'eventId' },
      { model: 'eventCategory', fk: 'eventId' },
      { model: 'eventLevel', fk: 'eventId' },
      { model: 'eventAdministrativeGroup', fk: 'eventId' },
    ],
  },

  // A Session's staffing and content links belong to the occurrence. The
  // Sessions themselves belong to the schedule that materialized them (TD-4.6c).
  Session: {
    model: 'session',
    children: [
      { model: 'sessionStaff', fk: 'sessionId' },
      { model: 'sessionContent', fk: 'sessionId' },
    ],
  },

  // R58 — supervisors belong to the sitting. A `Grade` or a submission against
  // the exam is academic record and blocks the purge, which is correct: those
  // outlive the arrangements, exactly as §4.6 says.
  Exam: { model: 'exam', children: [{ model: 'examStaff', fk: 'examId' }] },

  // The link rows belong to the content; the bytes are handled separately by the
  // caller, because they live outside the transaction (R59.1).
  EducationalContent: {
    model: 'educationalContent',
    children: [{ model: 'sessionContent', fk: 'contentId' }],
  },

  // Join rows with nothing beneath them.
  HijriMonthStart: { model: 'hijriMonthStart' },
  Enrollment: { model: 'enrollment' },
  StudentTeachingGroup: { model: 'studentTeachingGroup' },
  LevelSubject: { model: 'levelSubject' },
  SessionContent: { model: 'sessionContent' },
  FamilyLink: { model: 'familyLink' },
};

/** Why a type cannot be purged. Stable codes: a screen renders them. */
const PURGE_BLOCKED_REASON: Record<string, string> = {
  // Destroying a person takes the audit trail that says what they did — the one
  // record a safeguarding platform may not lose. R54's decision, not this one's.
  User: 'ACCOUNTABILITY_RECORD',
  // Its Sessions are materialized rows other records reference; destroying a
  // schedule is destroying a timetable's history, which needs its own decision.
  RecurringCourseSchedule: 'CASCADE_CHILDREN',
};

/** TD-2: the Trash is Super Admin only. It exposes every entity in the platform
 *  regardless of branch, so a branch-scoped Admin would see other branches'
 *  records — which no other surface allows. */
function assertSuperAdmin(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'the Trash is Super Admin only (TD-2)');
  }
}

/**
 * **The two write verbs are TD-12 high-risk, and the token is not enough.**
 *
 * `assertSuperAdmin` above reads the JWT, which is a snapshot taken when the
 * token was minted. That is fine for reading the list, and it is *not* fine for
 * restore and permanent delete: a Super Admin whose role is revoked would go on
 * destroying records irreversibly until their access token expired — the exact
 * window TD-12's freshness rule exists to close, on the most destructive verb
 * the platform has.
 *
 * Measured, not assumed: `/admin/settings` already refuses a validly signed
 * token claiming `super_admin` for a user who does not hold it, because it
 * re-reads live rows. `/admin/trash` answered `200` to the same request. Same
 * platform, same claim, two answers — and the weaker one guarded the deletions.
 *
 * One indexed read on a low-frequency endpoint, exactly as the policy describes.
 */
async function assertFreshSuperAdmin(prisma: PrismaClient, actor: Actor): Promise<void> {
  assertSuperAdmin(actor);
  await assertFreshActive(prisma, actor.userId, [scope.SUPER_ADMIN], actor.activeRole);
}

export interface TrashRow {
  id: string;
  targetEntity: string;
  targetId: string;
  /** A human-readable identifier pulled from the snapshot — a name where the
   *  entity has one. Without it the list is a page of UUIDs. */
  label: string | null;
  deletedAt: Date;
  deletedById: string | null;
  deletedByName: string | null;
  /** BR-15: when the 90-day window purges it permanently. */
  purgeAfter: Date;
  /** Decided by the SERVER, per entity type. */
  restorable: boolean;
  /** `null` when restorable; otherwise a stable code saying why not. */
  restoreBlockedReason: string | null;
  /**
   * R59.1 — whether a Super Admin may destroy it. Decided by the SERVER for the
   * same reason `restorable` is: a client cannot know which destructions are
   * written, and one that guessed would offer an irreversible button.
   */
  purgeable: boolean;
  /** `null` when purgeable; otherwise a stable code saying why not. */
  purgeBlockedReason: string | null;
}

export interface TrashFilters extends PageParams {
  entity?: string;
  deletedById?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

/**
 * **A name from the snapshot, not a second query.**
 *
 * The snapshot is the row exactly as it was, so the label is already in hand —
 * and reading it from there is also the only correct source: the live row may be
 * gone entirely once BR-15 purges, and a join would show nothing.
 */
function labelOf(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const row = snapshot as Record<string, unknown>;
  for (const key of ['name', 'nameArabic', 'name_arabic', 'title', 'label']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

export async function listTrash(
  prisma: PrismaClient,
  actor: Actor,
  filters: TrashFilters = {},
): Promise<Page<TrashRow>> {
  // The read gets freshness too. It is not a mutation, but it is the one list in
  // the platform that spans **every entity across every branch** (§5.6), so a
  // revoked Super Admin browsing it on a still-valid token is a real disclosure
  // rather than a theoretical one — and leaving the read on the token while the
  // writes re-read live rows is the kind of inconsistency somebody later
  // "tidies" in the wrong direction. One indexed read, on a low-frequency page.
  await assertFreshSuperAdmin(prisma, actor);

  const where: Prisma.TrashWhereInput = {
    ...(filters.entity ? { targetEntity: filters.entity } : {}),
    ...(filters.deletedById ? { deletedById: filters.deletedById } : {}),
    ...(filters.from || filters.to
      ? {
          deletedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const window = pageWindow(filters);
  const [rows, total] = await Promise.all([
    prisma.trash.findMany({
      where,
      // Most recently deleted first: the record somebody is looking for is
      // almost always the one they just lost.
      orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
      include: { deletedBy: { select: { id: true, nameArabic: true } } },
    }),
    prisma.trash.count({ where }),
  ]);

  const mapped = rows.map((row) => {
    const restorable = RESTORABLE[row.targetEntity] !== undefined;
    const purgeable = PURGEABLE[row.targetEntity] !== undefined;
    return {
      id: row.id,
      targetEntity: row.targetEntity,
      targetId: row.targetId,
      label: labelOf(row.snapshot),
      deletedAt: row.deletedAt,
      deletedById: row.deletedById,
      deletedByName: row.deletedBy?.nameArabic ?? null,
      purgeAfter: row.purgeAfter,
      restorable,
      restoreBlockedReason: restorable
        ? null
        : (BLOCKED_REASON[row.targetEntity] ?? 'NOT_YET_SUPPORTED'),
      purgeable,
      purgeBlockedReason: purgeable
        ? null
        : (PURGE_BLOCKED_REASON[row.targetEntity] ?? 'NOT_YET_SUPPORTED'),
    };
  });

  // **Search is applied to the LABEL, after the page is read.** The label lives
  // inside a JSONB snapshot under a key that differs per entity, so a SQL
  // predicate would need one expression per entity type and would still miss any
  // type added later. Narrowing the page a reader is already looking at is
  // honest — and the entity and date filters above, which do run in SQL, are the
  // ones that make the page small enough for that to be true.
  const needle = filters.q?.trim().toLowerCase();
  const data = needle
    ? mapped.filter(
        (r) =>
          r.label?.toLowerCase().includes(needle) ||
          r.targetEntity.toLowerCase().includes(needle),
      )
    : mapped;

  return page(data, window, total);
}

/**
 * Restores one soft-deleted record — **only where §7's cascade problem does not
 * arise**.
 *
 * The refusal is deliberately loud rather than a hidden no-op. R111's account
 * deletion is restorable because its soft-delete phase removes no relationship
 * rows; entity types whose deletion really cascades remain outside RESTORABLE.
 */
export async function restoreEntry(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<{ targetEntity: string; targetId: string }> {
  await assertFreshSuperAdmin(prisma, actor);

  const entry = await prisma.trash.findUnique({ where: { id } });
  if (!entry) throw new AppError('NOT_FOUND', 'no such trash entry');

  const plan = RESTORABLE[entry.targetEntity];
  if (!plan) {
    throw new AppError('STATE_CONFLICT', 'restoring this entity type is not yet supported', {
      reason: BLOCKED_REASON[entry.targetEntity] ?? 'NOT_YET_SUPPORTED',
      target_entity: entry.targetEntity,
    });
  }

  return prisma.$transaction(async (tx) => {
    const delegate = tx[plan.model] as unknown as {
      findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
      update: (a: unknown) => Promise<unknown>;
    };

    const row = await delegate.findUnique({ where: { id: entry.targetId } });
    // BR-15 has purged the row itself, so there is nothing left to un-delete —
    // the snapshot alone cannot recreate it safely, because every foreign key it
    // points at may since have gone too.
    if (!row) {
      throw new AppError('STATE_CONFLICT', 'the record itself is gone — BR-15 purged it', {
        reason: 'ALREADY_PURGED',
      });
    }
    if (row['deletedAt'] === null) {
      throw new AppError('STATE_CONFLICT', 'that record is not deleted', { reason: 'NOT_DELETED' });
    }

    // **A child cannot be restored into a deleted parent.** Restoring a Room
    // whose Branch is still in the Trash would produce a room nobody can reach
    // through any screen — technically alive, practically lost.
    if (plan.parent) {
      const parentId = row[plan.parent.field];
      const parentDelegate = tx[plan.parent.model] as unknown as {
        findFirst: (a: unknown) => Promise<unknown>;
      };
      const parent = await parentDelegate.findFirst({
        where: { id: parentId, deletedAt: null },
      });
      if (!parent) {
        throw new AppError('STATE_CONFLICT', 'restore its parent first', {
          reason: 'PARENT_DELETED',
          parent_entity: String(plan.parent.model),
        });
      }
    }

    await delegate.update({
      where: { id: entry.targetId },
      data: { deletedAt: null, deletedById: null },
    });

    // **The children come back with it, or the restore is the half-restore §7
    // warns about** (R59.3). Only declared reinstatements run: a type whose
    // cascade is not written stays out of `RESTORABLE` entirely rather than
    // being restored partially here.
    // **The record's OWN tombstone is the reference, not the Trash entry's.**
    // The service stamps the record and its children from one `new Date()`
    // inside the transaction; the Trash row is written a few milliseconds later
    // from a different clock reading. Comparing against the entry therefore
    // excluded the very children it was meant to include — measured, not
    // supposed: the staff were 4 ms early and a restored exam came back with
    // nobody supervising it.
    const deletedAt = row['deletedAt'] as Date;

    /**
     * Restoring a FUTURE exam revives an operational obligation, not merely
     * history. An account may have been deleted after the exam was binned,
     * because its ExamStaff rows were correctly tombstoned at that moment.
     * Lock and re-check those people before revival so restore participates in
     * the same R111 serialization as ordinary staffing writes. Past exam staff
     * remain historical evidence and may still point at a de-identified User.
     */
    if (entry.targetEntity === 'Exam') {
      const examDate = row['date'];
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (examDate instanceof Date && examDate >= today) {
        const staff = await tx.examStaff.findMany({
          where: { examId: entry.targetId, deletedAt: { gte: deletedAt } },
          select: { userId: true },
        });
        await assertStaffAccountsAvailable(
          tx,
          staff.map((person) => person.userId),
        );
      }
    }

    for (const child of plan.children ?? []) {
      const childDelegate = tx[child.model] as unknown as {
        updateMany: (a: unknown) => Promise<{ count: number }>;
      };
      await childDelegate.updateMany({
        // Scoped to the rows removed BY this deletion: a supervisor taken off
        // the exam a week earlier stays off it, because that was a different
        // decision by a different person.
        where: { [child.fk]: entry.targetId, deletedAt: { gte: deletedAt } },
        data: { deletedAt: null, deletedById: null },
      });
    }
    // The tombstone goes with the restoration: the record is no longer deleted,
    // so leaving it listed would make the Trash disagree with the platform. The
    // audit row below is what keeps the event answerable afterwards.
    await tx.trash.delete({ where: { id } });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'trash.restore',
      targetEntity: entry.targetEntity,
      targetId: entry.targetId,
      detail: {
        deleted_at: entry.deletedAt.toISOString(),
        deleted_by: entry.deletedById,
      },
    });

    return { targetEntity: entry.targetEntity, targetId: entry.targetId };
  });
}

/**
 * **Destroys a soft-deleted record permanently** (SRS Revision 59.1).
 *
 * Super Admin only, asserted here against the actor's live role scopes — the
 * `/admin/` prefix is not the boundary (TD-2), and a client that hides a button
 * has secured nothing.
 *
 * ## Why this exists at all
 *
 * Revision 52 forbade it: *a manual "delete now" would bypass a retention rule
 * that exists for legal and safeguarding reasons*. Revision 59 supersedes that
 * for one reason — **"wait ninety days" is not an answer to a safeguarding
 * erasure request**. What the retention rule protects against is *accidental and
 * unaccountable* destruction, and an audited, confirmed, Super-Admin-only action
 * is neither. BR-15's window is unchanged and remains the default path for
 * everything nobody acts on.
 *
 * ## It is complete or it does not happen
 *
 * Children, then the record, then the tombstone, then the audit row — one
 * transaction. A partial destruction is the single outcome that would leave the
 * platform unable to say what was removed, which is worse than either extreme.
 *
 * ## The database decides what still depends on it
 *
 * Every foreign key into these tables is `Restrict`, so a live referrer makes
 * PostgreSQL refuse and that refusal becomes `DEPENDENTS_EXIST`. Enumerating
 * blockers in TypeScript would be a second copy of the schema, and the copy is
 * the one that drifts.
 */
export async function purgeEntry(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<{ targetEntity: string; targetId: string; alreadyPurged: boolean }> {
  await assertFreshSuperAdmin(prisma, actor);

  const entry = await prisma.trash.findUnique({ where: { id } });
  if (!entry) throw new AppError('NOT_FOUND', 'no such trash entry');

  const plan = PURGEABLE[entry.targetEntity];
  if (!plan) {
    throw new AppError('STATE_CONFLICT', 'destroying this entity type is not supported', {
      reason: PURGE_BLOCKED_REASON[entry.targetEntity] ?? 'NOT_YET_SUPPORTED',
      target_entity: entry.targetEntity,
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const delegate = tx[plan.model] as unknown as {
        findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
        delete: (a: unknown) => Promise<unknown>;
      };

      const row = await delegate.findUnique({ where: { id: entry.targetId } });

      // **The record is already gone and only the tombstone remains.** Removing
      // the entry is exactly what the caller asked for, so it succeeds and says
      // which of the two happened rather than raising over a state that is not
      // an error.
      if (!row) {
        await enqueueContentStorageRetirement(tx, entry.targetEntity, entry.targetId, entry.snapshot);
        await tx.trash.delete({ where: { id } });
        await audit.write(tx, {
          actorUserId: actor.userId,
          activeRole: actor.activeRole,
          actionType: 'trash.permanent_delete',
          targetEntity: entry.targetEntity,
          targetId: entry.targetId,
          detail: { already_purged: true, deleted_at: entry.deletedAt.toISOString() },
        });
        return { targetEntity: entry.targetEntity, targetId: entry.targetId, alreadyPurged: true };
      }

      // **A live record is never destroyed through the Trash.** Somebody
      // restored it since, and the tombstone is stale — destroying it now would
      // remove a record in active use with no deletion behind it.
      if (row['deletedAt'] === null) {
        throw new AppError('STATE_CONFLICT', 'that record is not deleted', { reason: 'NOT_DELETED' });
      }

      await enqueueContentStorageRetirement(tx, entry.targetEntity, entry.targetId, row);

      for (const child of plan.children ?? []) {
        const childDelegate = tx[child.model] as unknown as {
          deleteMany: (a: unknown) => Promise<{ count: number }>;
        };
        await childDelegate.deleteMany({ where: { [child.fk]: entry.targetId } });
      }

      await delegate.delete({ where: { id: entry.targetId } });
      await tx.trash.delete({ where: { id } });

      // Retained indefinitely: `trash.permanent_delete` is deliberately absent
      // from `PURGEABLE_ACTION_TYPES`, so the record of an irreversible act
      // outlives the audit-purge horizon.
      await audit.write(tx, {
        actorUserId: actor.userId,
        activeRole: actor.activeRole,
        actionType: 'trash.permanent_delete',
        targetEntity: entry.targetEntity,
        targetId: entry.targetId,
        detail: {
          already_purged: false,
          deleted_at: entry.deletedAt.toISOString(),
          deleted_by: entry.deletedById,
          label: labelOf(entry.snapshot),
        },
      });

      return { targetEntity: entry.targetEntity, targetId: entry.targetId, alreadyPurged: false };
    });
  } catch (error) {
    // P2003: a foreign key still points at the row. That is the answer, not a
    // failure — a record in use is not destroyed, and the caller is told which
    // constraint held it.
    if (isForeignKeyViolation(error)) {
      throw new AppError('STATE_CONFLICT', 'something still references this record', {
        reason: 'DEPENDENTS_EXIST',
        target_entity: entry.targetEntity,
        constraint: constraintOf(error),
      });
    }
    throw error;
  }
}

/**
 * Makes a content purge's database destruction and exact object-retirement
 * obligation indivisible. Storage cannot join the transaction, so the durable
 * pg-boss row is the committed promise; the worker performs idempotent deletes
 * afterwards and must fail/retry on an ambiguous storage response.
 *
 * The snapshot fallback closes purges whose content row was already removed by
 * an older/manual path. Missing or malformed coordinates fail the transaction
 * closed: erasing the final Trash locator would otherwise recreate the orphan
 * this obligation exists to prevent.
 */
async function enqueueContentStorageRetirement(
  tx: Prisma.TransactionClient,
  targetEntity: string,
  contentId: string,
  source: unknown,
): Promise<void> {
  if (targetEntity !== 'EducationalContent') return;
  if (typeof source !== 'object' || source === null) {
    throw new Error('EducationalContent purge has no storage snapshot');
  }
  const coordinate = source as Record<string, unknown>;
  const bucket = coordinate['storageBucket'];
  const storageKey = coordinate['storageKey'];
  if (typeof bucket !== 'string' || typeof storageKey !== 'string') {
    throw new Error('EducationalContent purge has no exact storage coordinate');
  }
  await enqueue(
    tx,
    JOB_QUEUES.contentQuarantinePurge,
    {
      operation: 'manual_permanent_delete',
      content_id: contentId,
      bucket,
      storage_key: storageKey,
    },
    `manual-purge:${contentId}`,
  );
}

/**
 * **A `RESTRICT` violation does not arrive as `P2003`.**
 *
 * Measured rather than assumed, and the assumption was wrong. `P2003` is
 * Prisma's *foreign key constraint failed* — PostgreSQL `23503`. A column
 * declared `onDelete: Restrict`, which is how every relation on this schema is
 * declared, raises **`23001` `restrict_violation`** instead, and the driver
 * adapter surfaces it as **`P2039`** with the SQLSTATE buried in a nested
 * `driverAdapterError.cause`.
 *
 * Matching only `P2003` therefore let the raw Prisma error escape to the client
 * as a 500 for the single most likely refusal this endpoint has. Both codes are
 * accepted, and the SQLSTATE is what is actually checked.
 */
const FK_SQLSTATES = new Set(['23001', '23503']);

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2003') return true;
  return FK_SQLSTATES.has(sqlStateOf(error) ?? '');
}

function sqlStateOf(error: unknown): string | null {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { code?: unknown } } } }).meta
    ?.driverAdapterError?.cause;
  return typeof cause?.code === 'string' ? cause.code : null;
}

/** The constraint that held the row — the useful half of the message, so an
 *  administrator learns WHICH relationship is in the way. */
function constraintOf(error: unknown): string | null {
  const meta = (error as {
    meta?: {
      field_name?: unknown;
      constraint?: unknown;
      driverAdapterError?: { cause?: { message?: unknown } };
    };
  }).meta;

  for (const value of [meta?.constraint, meta?.field_name]) {
    if (typeof value === 'string') return value;
  }
  const message = meta?.driverAdapterError?.cause?.message;
  if (typeof message === 'string') {
    return /foreign key constraint "([^"]+)"/.exec(message)?.[1] ?? null;
  }
  return null;
}
