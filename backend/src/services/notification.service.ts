import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../policies/actor.js";
import { assertMayDeleteEvent, assertMayEdit } from "./event.service.js";
import { loadForWrite } from "./session.service.js";
import { AppError } from "../lib/errors.js";
import {
  page,
  pageWindow,
  type Page,
  type PageParams,
} from "../lib/pagination.js";
import {
  eventAudienceWhere,
  resolveAudience,
  audienceWhere,
  type AudienceSpec,
  type EventScopeRows,
  audienceForSession,
  examAudienceWhere,
  assertExamInTeacherScope,
} from "../policies/roster-resolution.js";
import { effectiveOn } from "../policies/effective-staffing.js";
import * as users from "../repositories/user.repository.js";

/**
 * **The minimum MVP notification surface** (§4.8, R77/R78/R82/R83/R93).
 *
 * ## What this is not
 *
 * It is not §10.1's framework arriving early. There is no tier, no
 * `NotificationPreference`, no channel and no catalogue — R6 postponed all of
 * that and the later notification revisions left it postponed. What returned is
 * a bounded set of domain events and the smallest entity that can carry them.
 *
 * ## Why a row rather than a derived read
 *
 * *"Sessions in my calendar that are cancelled"* needs no table and was
 * seriously considered. It fails on **read state**: with nothing stored there is
 * nothing to mark read, so a screen can only ever say *this class is cancelled*
 * and never *this is news*. And a student who leaves a Level would lose the
 * notice of last week's cancellation — exactly when they need it. A notification
 * is a **delivered fact**, not a projection of current state, and the two differ
 * the moment either side moves.
 *
 * ## Who is notified
 *
 * The Session's resolved audience (§4.4c) — through `resolveAudience`, the *same*
 * predicate that produces the `session.cancel` audit row's `audience_size`. Two
 * implementations that agree today are two that drift, and a notification list
 * disagreeing with the audit's count would make both unusable.
 *
 * ## Who is notified, as R78.3 narrows it
 *
 * R77.3 said *students only, not staff, who take the decision*. R78 keeps the
 * reason and drops the over-reach: **the audience of an event is notified, and a
 * person is never notified of their own act.** An administrator cancelling a
 * class is telling the assigned مؤطرة something she did not decide; a مؤطرة
 * cancelling her own is telling herself nothing.
 *
 * So the recipient set is *(enrolled students ∪ assigned staff) − the actor*.
 * Parents remain outside it: §4.3's child context is not a mailbox of their own
 * in the MVP.
 */

/**
 * The recipients of an event about one Session — **the audience predicate,
 * written once** (R78.3).
 *
 * Both halves are resolved from live rows: the students through
 * `resolveAudience`, which is the same predicate the `session.cancel` audit row
 * counts, and the staff through the Session's own snapshot (R43.4) rather than
 * the schedule's, so a مؤطرة who covered this occurrence is told about it and
 * one merely removed from the schedule is not.
 */
async function recipientsFor(
  tx: Prisma.TransactionClient,
  sessionId: string,
  spec: AudienceSpec,
  actorUserId: string,
): Promise<string[]> {
  const [students, session] = await Promise.all([
    resolveAudience(tx as unknown as PrismaClient, spec),
    tx.session.findUnique({
      where: { id: sessionId },
      select: {
        visibility: true,
        staff: {
          where: { deletedAt: null },
          select: { userId: true, position: true },
        },
      },
    }),
  ]);
  if (!session) return [];
  const hidden = session.visibility === 'hidden';
  const staff = session.staff.filter(
    (person) => !hidden || person.position === 'teacher',
  );
  const everyone = new Set([
    ...(hidden ? [] : students.map((s) => s.id)),
    ...staff.map((s) => s.userId),
  ]);
  // **Never notified of your own act** — the whole of R78.3's narrowing.
  everyone.delete(actorUserId);
  return [...everyone];
}

export type NotificationKind =
  | "registration_review_required"
  | "registration_approved"
  | "registration_rejected"
  | "family_link_requested"
  | "family_link_approved"
  | "family_link_rejected"
  | "family_link_revoked"
  | "role_assignments_changed"
  | "platform_ownership_received"
  | "enrollment_changed"
  | "session_cancelled"
  | "session_restored"
  | "session_assigned"
  | "session_unassigned"
  | "session_rescheduled"
  | "event_created"
  | "event_rescheduled"
  | "event_cancelled"
  | "event_staff_assigned"
  | "event_staff_unassigned"
  | "exam_teacher_assigned"
  | "exam_teacher_unassigned"
  | "exam_scheduled"
  | "exam_rescheduled"
  | "exam_changed"
  | "exam_cancelled"
  | "grade_published"
  | "assessment_published";

/**
 * One row, **exactly one of whose targets is present** (R82.1). The reader
 * renders from whichever it finds; the CHECK constraint is what guarantees there
 * is one and only one to find.
 */
export interface NotificationRow {
  id: string;
  type: NotificationKind;
  sessionId: string | null;
  eventId: string | null;
  examId: string | null;
  subjectUserId: string | null;
  readAt: Date | null;
  createdAt: Date;
  session: {
    date: Date;
    startTime: Date;
    cancellationReason: string | null;
    schedule: {
      subject: { name: string } | null;
      level: { name: string } | null;
    };
  } | null;
  event: {
    title: string;
    startDate: Date;
    startTime: Date | null;
  } | null;
  exam: {
    title: string;
    date: Date;
    startTime: Date | null;
    subject: { name: string } | null;
  } | null;
  subjectUser: { nameArabic: string } | null;
}

/**
 * Locks a prospective recipient set and returns only accounts that still have
 * an inbox.
 *
 * Roster resolution already excludes a User whose tombstone was committed
 * before the query. That alone leaves a check/write race: final R111
 * de-identification can delete this person's notifications after resolution,
 * then a stale writer can insert one again. Taking every governing User lock in
 * UUID order gives both serial outcomes the same result: either this insert
 * commits first and de-identification removes it, or deletion commits first and
 * the recipient is omitted.
 */
async function liveNotificationRecipients(
  tx: Prisma.TransactionClient,
  userIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(userIds)].sort();
  for (const id of ids) await users.lockUser(tx, id);
  if (ids.length === 0) return [];

  const live = await tx.user.findMany({
    // Only an Active account has an inbox. Pending reaches only `/me` and
    // logout; Rejected/Suspended receives no authenticated session at all.
    // Persisting a row for any of them would record a delivery that cannot be
    // read and could later surface stale coordinates after reactivation.
    where: { id: { in: ids }, accountStatus: 'active', deletedAt: null },
    select: { id: true },
  });
  const liveIds = new Set(live.map((row) => row.id));
  return ids.filter((id) => liveIds.has(id));
}

/**
 * **What a notice needs to be readable, per target** (R82.1).
 *
 * Four different shapes, which is the concrete reason R82/R116 chose foreign
 * keys over a `target_type`/`target_id` pair: a polymorphic id could not be
 * joined at all, and the screen would need a second round trip per row to say
 * anything more than *something happened*.
 */
const LIST_INCLUDE = {
  session: {
    select: {
      date: true,
      startTime: true,
      cancellationReason: true,
      schedule: {
        select: {
          subject: { select: { name: true } },
          level: { select: { name: true } },
        },
      },
    },
  },
  /**
   * **An Event carries no cancellation reason, and none is invented here.**
   * `Session.cancellation_reason` exists because R77 added it for exactly that
   * notice; an Event is cancelled by being soft-deleted into Trash (R59), which
   * records who and when in the audit log but asks for no reason. So an
   * `event_cancelled` notice names the event, its date and its time — and the
   * DTO publishes `reason: null` rather than a column that does not exist.
   */
  event: {
    select: { title: true, startDate: true, startTime: true },
  },
  // The exam and its subject — enough to say WHICH grade was published. The
  // score is deliberately absent: the notice says it is available, and her own
  // screen shows the current number (R82.4).
  exam: {
    select: {
      title: true,
      date: true,
      startTime: true,
      subject: { select: { name: true } },
    },
  },
  subjectUser: { select: { nameArabic: true } },
} satisfies Prisma.NotificationInclude;

/**
 * Writes the cancellation notices, **inside the caller's transaction** (R77.4).
 *
 * A committed cancellation with no notifications is a class nobody was told
 * about, and a retry cannot tell that state apart from one already notified —
 * so the two facts commit together or neither does.
 *
 * `skipDuplicates` against the `(user, session, type)` unique index is what makes
 * it idempotent: cancelling twice, or retrying after a dropped response, writes
 * the same rows rather than a second copy of the same news.
 */
export async function notifyCancelled(
  tx: Prisma.TransactionClient,
  sessionId: string,
  spec: AudienceSpec,
  actorUserId: string,
): Promise<number> {
  return writeFor(
    tx,
    sessionId,
    "session_cancelled",
    await recipientsFor(tx, sessionId, spec, actorUserId),
  );
}

/**
 * `session_rescheduled` — an occurrence's date or time changed (R78.4).
 *
 * **One row, however many times it moves.** The notification points at the
 * Session and the DTO renders that Session's *current* date and time, so a
 * second reschedule needs no second row and the unique index gives that for
 * nothing. A student always reads where the class is now, never a trail of
 * where it used to be.
 *
 * It is deliberately **not** a cancellation plus a new occurrence: that would
 * tell her the class is off and, separately, that a different one exists — two
 * false statements in place of one true one (R78's rejected alternative).
 */
export async function notifyRescheduled(
  tx: Prisma.TransactionClient,
  sessionId: string,
  spec: AudienceSpec,
  actorUserId: string,
): Promise<number> {
  return writeFor(
    tx,
    sessionId,
    "session_rescheduled",
    await recipientsFor(tx, sessionId, spec, actorUserId),
  );
}

/**
 * `session_assigned` — these people were ADDED to the staffing (R78.2).
 *
 * Only the newly added are told, which is what makes a re-save that changes
 * nothing write nothing. The actor is excluded for the same reason as
 * everywhere else: assigning yourself is not news to you.
 */
export async function notifyAssigned(
  tx: Prisma.TransactionClient,
  sessionId: string,
  addedUserIds: readonly string[],
  actorUserId: string,
): Promise<number> {
  return writeFor(
    tx,
    sessionId,
    "session_assigned",
    addedUserIds.filter((id) => id !== actorUserId),
  );
}

/**
 * The write itself. `skipDuplicates` against the `(user, session, type)` unique
 * index is what makes every one of these idempotent: a retry after a dropped
 * response writes the same rows rather than a second copy of the same news.
 */
async function writeFor(
  tx: Prisma.TransactionClient,
  sessionId: string,
  type:
    | "session_cancelled"
    | "session_rescheduled"
    | "session_assigned"
    | "session_unassigned",
  userIds: readonly string[],
): Promise<number> {
  const recipients = await liveNotificationRecipients(tx, userIds);
  if (recipients.length === 0) return 0;
  const created = await tx.notification.createMany({
    data: recipients.map((userId) => ({ userId, sessionId, type })),
    skipDuplicates: true,
  });
  return created.count;
}

/* ── Events (R82) ─────────────────────────────────────────────────────────── */

/**
 * **Who an Event's notice goes to** — resolved here, from the event's own scope
 * rows, and never from anything a client sent.
 *
 * Two halves, unioned: the people the scope places in its audience
 * (`eventAudienceWhere`, the same enrolment relations the Session predicate
 * uses) and the **staff assigned to the event itself**, who are concerned by
 * definition whatever the scope says.
 *
 * The actor is removed last, so an administrator who staffs the event she just
 * moved is still not told about her own act (R78.3).
 */
export async function eventRecipients(
  prisma: PrismaClient,
  eventId: string,
  actorUserId: string,
): Promise<string[]> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null },
    select: {
      visibility: true,
      branchScopes: { select: { branchId: true } },
      categoryScopes: { select: { categoryId: true } },
      levelScopes: { select: { levelId: true } },
      administrativeGroupScopes: { select: { administrativeGroupId: true } },
      staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
    },
  });
  if (!event) throw new AppError("NOT_FOUND", "no such event");

  return recipientsFromEventScope(
    prisma,
    {
      branchIds: event.branchScopes.map((r) => r.branchId),
      categoryIds: event.categoryScopes.map((r) => r.categoryId),
      levelIds: event.levelScopes.map((r) => r.levelId),
      administrativeGroupIds: event.administrativeGroupScopes.map(
        (r) => r.administrativeGroupId,
      ),
    },
    event.visibility,
    event.staff,
    actorUserId,
  );
}

/**
 * The one recipient calculation for both live Events and a deleted Event whose
 * scope is being read from Trash. Deletion changes where the scope rows live;
 * it must not create a second interpretation of what those rows mean (R82.7).
 */
async function recipientsFromEventScope(
  prisma: PrismaClient,
  scopes: EventScopeRows,
  visibility: 'public' | 'private' | 'hidden',
  staff: readonly { userId: string; position: 'responsible' | 'assistant' }[],
  actorUserId: string,
): Promise<string[]> {
  const where = eventAudienceWhere(scopes);

  // A GLOBAL event resolves to no audience at all (R82.7) — but its own staff
  // are still concerned by it, which is a different question from its scope.
  const audience =
    visibility === 'hidden' || where === null
      ? []
      : await prisma.user.findMany({
          // `eventAudienceWhere` already carries this boundary. Repeat it at
          // the read site as an auditable invariant: a future alternate scope
          // predicate must not silently make a deleted account a recipient.
          where: { ...where, deletedAt: null },
          select: { id: true },
        });

  const staffUserIds = staff
    .filter((person) => visibility !== 'hidden' || person.position === 'responsible')
    .map((person) => person.userId);

  const everyone = new Set([
    ...audience.map((u) => u.id),
    ...staffUserIds,
  ]);
  everyone.delete(actorUserId);
  return [...everyone];
}

/**
 * Reads the scope shape written by `deleteEvent` before it hard-removes the
 * four join tables. A malformed or historical snapshot fails closed: treating
 * a missing array as empty could turn a scoped Event into a global one and
 * quietly report that nobody was notified.
 */
function eventScopeFromTrash(snapshot: Prisma.JsonValue): EventScopeRows {
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    throw new Error("Event Trash snapshot is not an object");
  }
  const scope = (snapshot as Prisma.JsonObject)["scope"];
  if (scope === null || Array.isArray(scope) || typeof scope !== "object") {
    throw new Error("Event Trash snapshot has no scope");
  }

  const ids = (key: string): string[] => {
    const value = (scope as Prisma.JsonObject)[key];
    if (!Array.isArray(value)) {
      throw new Error(`Event Trash snapshot has invalid ${key}`);
    }
    return value.map((id) => {
      if (typeof id !== "string") {
        throw new Error(`Event Trash snapshot has invalid ${key}`);
      }
      return id;
    });
  };

  return {
    branchIds: ids("branch_ids"),
    categoryIds: ids("category_ids"),
    levelIds: ids("level_ids"),
    administrativeGroupIds: ids("administrative_group_ids"),
  };
}

/**
 * The post-delete half of R82.5.
 *
 * The Event row remains soft-deleted for its existing Trash lifecycle, and its
 * staff rows remain frozen. The four audience joins do not: their authoritative
 * post-delete representation is the Trash snapshot. Requiring BOTH the Event
 * tombstone and that snapshot to name the current actor as deleter is the
 * authorization check for the separate request — only the person who made this
 * saved change can decide to announce it.
 */
async function deletedEventRecipients(
  prisma: PrismaClient,
  eventId: string,
  actorUserId: string,
): Promise<string[]> {
  const [event, entry] = await Promise.all([
    prisma.event.findFirst({
      where: {
        id: eventId,
        deletedAt: { not: null },
        deletedById: actorUserId,
      },
      select: {
        visibility: true,
        staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
      },
    }),
    prisma.trash.findFirst({
      where: {
        targetEntity: "Event",
        targetId: eventId,
        deletedById: actorUserId,
      },
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      select: { snapshot: true },
    }),
  ]);
  if (!event || !entry) throw new AppError("NOT_FOUND", "no such deleted event");

  return recipientsFromEventScope(
    prisma,
    eventScopeFromTrash(entry.snapshot),
    event.visibility,
    event.staff,
    actorUserId,
  );
}

/**
 * `POST /events/{id}/notify` — **the optional send, after the change is saved**
 * (R82.5).
 *
 * A separate request against the already-saved row, deliberately: a flag on the
 * write would make a failure to notify able to roll back a change that
 * succeeded, and the person has not decided yet at the moment the write leaves
 * the form. Declining costs nothing because nothing is called.
 *
 * Idempotent through the partial unique index on `(user, event, type)`: pressing
 * send twice, or retrying after a dropped response, writes the same rows.
 */
export async function notifyEventChange(
  prisma: PrismaClient,
  actor: Actor,
  eventId: string,
  change: "created" | "rescheduled" | "cancelled",
): Promise<{ notified: number }> {
  let userIds: string[];
  if (change === "cancelled") {
    // The delete already committed and removed the live scope joins. The Trash
    // entry proves both who made that change and which audience it addressed.
    assertMayDeleteEvent(actor);
    userIds = await deletedEventRecipients(prisma, eventId, actor.userId);
  } else {
    // Creation/rescheduling are unchanged: authorization and audience come
    // from the live Event through the same guard as the write itself.
    await assertMayEdit(
      prisma as unknown as Prisma.TransactionClient,
      actor,
      eventId,
    );
    userIds = await eventRecipients(prisma, eventId, actor.userId);
  }

  const type = (
    {
      created: "event_created",
      rescheduled: "event_rescheduled",
      cancelled: "event_cancelled",
    } as const
  )[change];
  if (userIds.length === 0) return { notified: 0 };

  return prisma.$transaction(async (tx) => {
    const recipients = await liveNotificationRecipients(tx, userIds);
    if (recipients.length === 0) return { notified: 0 };
    const created = await tx.notification.createMany({
      data: recipients.map((userId) => ({ userId, eventId, type })),
      skipDuplicates: true,
    });
    return { notified: created.count };
  });
}

/**
 * `POST /sessions/{id}/notify` — **the optional send for an occurrence** (R83.3).
 *
 * The Session equivalent of `notifyEventChange`, and deliberately the same
 * shape: R77.4 and R78.4 wrote these notices inside the changing transaction,
 * and R83 separated them so the person is **asked** rather than the platform
 * deciding. Declining creates nothing; a failure here cannot roll back a
 * cancellation or a reschedule that already committed.
 *
 * The audience is the one R77.3/R78.3 already define — the schedule's resolved
 * students plus the occurrence's own staff, minus the actor — through
 * `recipientsFor`, which is the same predicate the `session.cancel` audit row
 * counts. Idempotent through `(user, session, type)`.
 */
export async function notifySessionChange(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  change: "cancelled" | "rescheduled",
): Promise<{ notified: number }> {
  // **Authorization is the occurrence's own**: whoever may change it may
  // announce the change, asked through the same guard the write used.
  const session = await loadForWrite(prisma, actor, sessionId);

  /**
   * **R92 — the recipients are the OCCURRENCE's audience.**
   *
   * Falling back to the schedule's single branch after an override exists is the
   * precise failure R92's shared resolver exists to prevent: the second branch's
   * beneficiaries would see the combined class on their calendars and be told
   * nothing when it was cancelled.
   */
  const spec = (await audienceForSession(prisma, sessionId)) ?? {
    teachingMode: session.schedule.teachingMode as never,
    levelId: session.schedule.levelId,
    administrativeGroupId: session.schedule.administrativeGroupId,
    teachingGroupId: session.schedule.teachingGroupId,
    branchId: session.schedule.branchId,
    // Period-blind: who this class concerns, not who was expected on a day.
    on: null,
  };

  return prisma.$transaction(async (tx) => {
    const userIds = await recipientsFor(tx, sessionId, spec, actor.userId);
    const notified = await writeFor(
      tx,
      sessionId,
      change === "cancelled" ? "session_cancelled" : "session_rescheduled",
      userIds,
    );
    return { notified };
  });
}

/* ── Grades (R82.4) ───────────────────────────────────────────────────────── */

/**
 * **Written at publication — and RE-ACTIVATED when a published grade changes.**
 *
 * A draft sheet is a مؤطرة's working document, so a draft save writes nothing
 * (BR-8); the caller is `publishGrades`, inside its transaction, because
 * publication and the notice that it happened are one fact.
 *
 * ## Why the original rule was not enough
 *
 * R82.4 made re-publication write nothing, absorbed by the
 * `(user, exam, type)` unique index, on the reasoning that *the row points at
 * the exam, so a student already told her grade is available is not told again
 * because the number changed — her screen shows the current one.*
 *
 * **That reasoning holds only if she looks again.** A student who read the
 * notice, saw 12, and was later given 17 has nothing anywhere telling her to
 * look — the platform knows her mark changed and says nothing. Reported from
 * real use, and it is the whole point of the notice.
 *
 * ## The semantics, chosen and stated
 *
 * **One row per (student, exam), reactivated on a real change.** Not a second
 * row: a list of *your grade was published* repeated four times is noise, and
 * the fact being announced is the same fact each time.
 *
 * | | |
 * |---|---|
 * | first publish | the row is created, unread |
 * | republish after the score changed | the row becomes **unread again**, and moves to the top |
 * | republish with nothing changed | **nothing happens** |
 *
 * *Changed* is `grade.updated_at > notification.created_at` — the row was
 * written after she was last told. It needs no new column and cannot drift from
 * the grade, because it IS the grade's own timestamp; and since publication
 * only writes rows that were draft, an unchanged republish touches nothing and
 * so moves no timestamp.
 *
 * The actor is excluded like everywhere else, which matters for a مؤطرة who is
 * also enrolled somewhere (R79 makes that expressible).
 */
export async function notifyGradePublished(
  tx: Prisma.TransactionClient,
  examId: string,
  studentIds: readonly string[],
  actorUserId: string,
): Promise<number> {
  const recipients = await liveNotificationRecipients(
    tx,
    studentIds.filter((id) => id !== actorUserId),
  );
  if (recipients.length === 0) return 0;

  const created = await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      examId,
      type: "grade_published" as const,
    })),
    skipDuplicates: true,
  });

  /**
   * The ones that already had a notice. Each is reactivated only if her grade
   * has been written since — so an unchanged republish is silent, and a
   * corrected mark surfaces as unread at the top of her bell.
   */
  const existing = await tx.notification.findMany({
    where: {
      examId,
      type: "grade_published",
      userId: { in: [...recipients] },
      deletedAt: null,
    },
    select: { id: true, userId: true, createdAt: true },
  });
  const grades = await tx.grade.findMany({
    where: { examId, studentId: { in: existing.map((n) => n.userId) } },
    select: { studentId: true, updatedAt: true },
  });
  const changedFor = new Map(grades.map((g) => [g.studentId, g.updatedAt]));

  let reactivated = 0;
  for (const notice of existing) {
    const written = changedFor.get(notice.userId);
    if (!written || written <= notice.createdAt) continue;
    await tx.notification.update({
      where: { id: notice.id },
      data: {
        // Unread again — the only thing that makes a bell say *look*.
        readAt: null,
        // And newest, so it is not buried under notices she has already seen.
        createdAt: new Date(),
      },
    });
    reactivated += 1;
  }

  // Both count as *people newly told*, which is what the caller reports.
  return created.count + reactivated;
}

/**
 * Reconciles the notices when a cancellation is reversed (R77.5).
 *
 * **Unread notices are deleted** — an unread notice of something that is no
 * longer true is worth nothing. **A read one becomes `session_restored`**, and
 * that asymmetry is the whole point: silently removing something a person has
 * already read would leave them believing a class is cancelled with nothing on
 * the platform to correct them, which is a worse failure than the one R77
 * exists to fix.
 *
 * Idempotent on both halves — a second restore finds nothing unread to delete
 * and collides harmlessly on the unique index.
 */
export async function notifyRestored(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<{ withdrawn: number; corrected: number }> {
  const cancelled = await tx.notification.findMany({
    where: { sessionId, type: "session_cancelled", deletedAt: null },
    select: { id: true, userId: true, readAt: true },
  });
  const read = cancelled.filter((n) => n.readAt !== null);
  const unread = cancelled.filter((n) => n.readAt === null);
  const liveReadIds = new Set(
    await liveNotificationRecipients(
      tx,
      read.map((notice) => notice.userId),
    ),
  );
  const liveRead = read.filter((notice) => liveReadIds.has(notice.userId));

  if (unread.length > 0) {
    // A hard delete, deliberately: the audit log already holds both the cancel
    // and the restore, so nothing historical is lost, and a soft-deleted notice
    // would keep the list read filtering rows nobody may ever see again.
    await tx.notification.deleteMany({
      where: { id: { in: unread.map((n) => n.id) } },
    });
  }
  if (liveRead.length > 0) {
    await tx.notification.createMany({
      data: liveRead.map((n) => ({
        userId: n.userId,
        sessionId,
        type: "session_restored" as const,
      })),
      skipDuplicates: true,
    });
    // The corrected notice replaces the one it corrects; leaving both would put
    // two contradictory statements about one class in the same list.
    await tx.notification.deleteMany({
      where: { id: { in: read.map((n) => n.id) } },
    });
  }
  return { withdrawn: unread.length, corrected: read.length };
}

/**
 * `GET /notifications` — **the caller's own, and nobody else's** (R77.6).
 *
 * The `userId` is taken from the authenticated actor and is not a parameter:
 * there is no id to pass, so there is nothing to tamper with, and no role —
 * Admin or Super Admin — can widen it.
 */
export async function listNotifications(
  prisma: PrismaClient,
  actor: Actor,
  params: PageParams & { unread_only?: boolean },
): Promise<Page<NotificationRow>> {
  const where: Prisma.NotificationWhereInput = {
    userId: actor.userId,
    deletedAt: null,
    ...(params.unread_only === true ? { readAt: null } : {}),
  };
  const window = pageWindow(params);
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: LIST_INCLUDE,
      // Newest first, with R76.3's deterministic tiebreaker — without it two
      // notices written in the same transaction share a `created_at` and can
      // land on two pages or on neither.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: window.skip,
      take: window.take,
    }),
    prisma.notification.count({ where }),
  ]);
  return page(rows as unknown as NotificationRow[], window, total);
}

/** How many the caller has not read — the count the screen shows. */
export async function unreadCount(
  prisma: PrismaClient,
  actor: Actor,
): Promise<number> {
  return prisma.notification.count({
    where: { userId: actor.userId, deletedAt: null, readAt: null },
  });
}

/**
 * `POST /notifications/{id}/read` — idempotent.
 *
 * A row belonging to somebody else answers **`404`, never `403`** (§20 rule 17):
 * a `403` would confirm that a particular notification exists, which is a fact
 * about another person's session.
 */
export async function markRead(
  prisma: PrismaClient,
  actor: Actor,
  notificationId: string,
  now: Date = new Date(),
): Promise<NotificationRow> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId: actor.userId, deletedAt: null },
    select: { id: true, readAt: true },
  });
  if (existing === null) {
    throw new AppError("NOT_FOUND", "no such notification");
  }
  // Already read: return it unchanged rather than moving the timestamp, so a
  // retried request does not rewrite when the person actually read it.
  if (existing.readAt !== null) {
    return (await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
      include: LIST_INCLUDE,
    })) as unknown as NotificationRow;
  }
  return (await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: now },
    include: LIST_INCLUDE,
  })) as unknown as NotificationRow;
}

/* ── Event staffing (R93) ─────────────────────────────────────────────────── */

/**
 * **«you are working on this», which is not «this is happening»** (R93).
 *
 * `event_created` announces an activity to the people it is for. A مؤطرة named
 * as an assistant needs the other thing entirely — that she is rostered — so
 * she can tell the administration if she cannot be there. Announcing it as
 * `event_created` would tell her the association is holding a celebration:
 * true, and not the thing she has to act on.
 *
 * **Automatic, and deliberately not part of the optional audience question.**
 * R82.5 makes announcing a change a decision the administrator takes after it
 * is saved; an assignment is communication *to the person assigned*, and
 * declining the announcement must not leave her rostered without knowing.
 *
 * **Only the NEW ones.** Renaming an event, moving it, or re-saving the same
 * staffing tells nobody again: the recipients are the difference between the
 * staffing that was there and the staffing submitted. A person removed and
 * later re-added **is** newly assigned, and is told — the row was withdrawn in
 * between, and the second assignment is a second fact.
 *
 * **The actor is excluded**, like everywhere else: a مؤطرة who names herself
 * responsible on the event she just created is not told she was assigned to it.
 */
export async function notifyEventStaffAssigned(
  tx: Prisma.TransactionClient,
  eventId: string,
  newlyAssigned: readonly string[],
  actorUserId: string,
): Promise<number> {
  const added = [...new Set(newlyAssigned)];
  if (added.length > 0) {
    await tx.notification.deleteMany({
      where: { eventId, type: 'event_staff_unassigned', userId: { in: added } },
    });
  }
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      visibility: true,
      staff: {
        where: { userId: { in: added }, deletedAt: null },
        select: { userId: true, position: true },
      },
    },
  });
  if (!event) return 0;
  const eligible = new Set(
    event.staff
      .filter((person) => event.visibility !== 'hidden' || person.position === 'responsible')
      .map((person) => person.userId),
  );
  const recipients = await liveNotificationRecipients(
    tx,
    added.filter((id) => id !== actorUserId && eligible.has(id)),
  );
  if (recipients.length === 0) return 0;

  const created = await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      eventId,
      type: 'event_staff_assigned' as const,
    })),
    // The `(user, event, type)` unique index. A re-assignment after a removal
    // collides with the old row rather than creating a second — see the
    // reactivation below, which is what makes the second assignment visible.
    skipDuplicates: true,
  });

  /**
   * **Re-assignment surfaces again.** Somebody removed in March and named again
   * in May has a spent notice sitting read at the bottom of her bell; leaving it
   * there would mean the platform knew she was rostered and said nothing. The
   * row becomes unread and moves to the top — the same shape R82.4's grade
   * notice takes, and for the same reason.
   */
  const existing = await tx.notification.findMany({
    where: {
      eventId,
      type: 'event_staff_assigned',
      userId: { in: recipients },
      deletedAt: null,
      readAt: { not: null },
    },
    select: { id: true },
  });
  for (const row of existing) {
    await tx.notification.update({
      where: { id: row.id },
      data: { readAt: null, createdAt: new Date() },
    });
  }

  return created.count + existing.length;
}

/** The counterpart of R93: a person removed from live event staffing is told. */
export async function notifyEventStaffUnassigned(
  tx: Prisma.TransactionClient,
  eventId: string,
  removedUserIds: readonly string[],
  actorUserId: string,
): Promise<number> {
  const removed = [...new Set(removedUserIds)];
  if (removed.length > 0) {
    await tx.notification.deleteMany({
      where: { eventId, type: 'event_staff_assigned', userId: { in: removed } },
    });
  }
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { visibility: true },
  });
  // Once hidden, the target is readable only by its current responsible
  // person. A former staff member cannot receive a target-bearing removal row
  // without that row itself bypassing R109.
  if (!event || event.visibility === 'hidden') return 0;
  const recipients = await liveNotificationRecipients(
    tx,
    removed.filter((id) => id !== actorUserId),
  );
  if (recipients.length === 0) return 0;
  const created = await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      eventId,
      type: 'event_staff_unassigned' as const,
    })),
    skipDuplicates: true,
  });
  const spent = await tx.notification.findMany({
    where: {
      eventId,
      type: 'event_staff_unassigned',
      userId: { in: recipients },
      readAt: { not: null },
      deletedAt: null,
    },
    select: { id: true },
  });
  const now = new Date();
  for (const row of spent) {
    await tx.notification.update({
      where: { id: row.id },
      data: { readAt: null, createdAt: now },
    });
  }
  return created.count + spent.length;
}

/** Withdraws target-bearing rows when a staff member loses hidden-read status. */
export async function withdrawEventStaffNotificationAccess(
  tx: Prisma.TransactionClient,
  eventId: string,
  userIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  await tx.notification.deleteMany({ where: { eventId, userId: { in: ids } } });
}

/**
 * Reconciles an Event visibility transition without turning publication into a
 * staffing mutation. Hidden retains rows only for the live responsible person;
 * widening from hidden tells assistants whose existing responsibility has just
 * become readable, while audience announcements remain explicitly optional.
 */
export async function reconcileEventNotificationVisibility(
  tx: Prisma.TransactionClient,
  eventId: string,
  previous: 'public' | 'private' | 'hidden',
  current: 'public' | 'private' | 'hidden',
  actorUserId: string,
): Promise<void> {
  if (previous === current) return;
  const staff = await tx.eventStaff.findMany({
    where: { eventId, deletedAt: null },
    select: { userId: true, position: true },
  });
  if (current === 'hidden') {
    const allowed = staff
      .filter((person) => person.position === 'responsible')
      .map((person) => person.userId);
    await tx.notification.deleteMany({
      where: {
        eventId,
        ...(allowed.length === 0 ? {} : { userId: { notIn: allowed } }),
      },
    });
    return;
  }
  if (previous === 'hidden') {
    await notifyEventStaffAssigned(
      tx,
      eventId,
      staff.filter((person) => person.position === 'assistant').map((person) => person.userId),
      actorUserId,
    );
  }
}

/** One deterministic lock boundary for an Event's added and removed people. */
export async function notifyEventStaffChanged(
  tx: Prisma.TransactionClient,
  eventId: string,
  addedUserIds: readonly string[],
  removedUserIds: readonly string[],
  actorUserId: string,
): Promise<{ assigned: number; unassigned: number }> {
  await liveNotificationRecipients(
    tx,
    [...addedUserIds, ...removedUserIds].filter((id) => id !== actorUserId),
  );
  return {
    assigned: await notifyEventStaffAssigned(
      tx,
      eventId,
      addedUserIds,
      actorUserId,
    ),
    unassigned: await notifyEventStaffUnassigned(
      tx,
      eventId,
      removedUserIds,
      actorUserId,
    ),
  };
}

/** Explicit occurrence restaffing, with stale opposite notices withdrawn. */
export async function notifySessionStaffChanged(
  tx: Prisma.TransactionClient,
  sessionId: string,
  input: {
    previousVisibility: 'public' | 'private' | 'hidden';
    currentVisibility: 'public' | 'private' | 'hidden';
    previousStaff: readonly { userId: string; position: 'teacher' | 'assistant' }[];
    currentStaff: readonly { userId: string; position: 'teacher' | 'assistant' }[];
  },
  actorUserId: string,
): Promise<{ assigned: number; unassigned: number }> {
  const previousRaw = new Set(input.previousStaff.map((person) => person.userId));
  const currentRaw = new Set(input.currentStaff.map((person) => person.userId));
  const visible = (
    visibility: 'public' | 'private' | 'hidden',
    staff: readonly { userId: string; position: 'teacher' | 'assistant' }[],
  ) =>
    new Set(
      staff
        .filter((person) => visibility !== 'hidden' || person.position === 'teacher')
        .map((person) => person.userId),
    );
  const previousVisible = visible(input.previousVisibility, input.previousStaff);
  const currentVisible = visible(input.currentVisibility, input.currentStaff);
  const rawAdded = [...currentRaw].filter((id) => !previousRaw.has(id));
  const rawRemoved = [...previousRaw].filter((id) => !currentRaw.has(id));
  const accessGained = [...currentRaw].filter(
    (id) => previousRaw.has(id) && !previousVisible.has(id) && currentVisible.has(id),
  );
  const accessLost = [...previousRaw].filter(
    (id) => currentRaw.has(id) && previousVisible.has(id) && !currentVisible.has(id),
  );
  const added = [
    ...rawAdded.filter((id) => currentVisible.has(id)),
    ...accessGained,
  ];
  const removed =
    input.currentVisibility === 'hidden'
      ? []
      : rawRemoved.filter((id) => previousVisible.has(id));
  await liveNotificationRecipients(
    tx,
    [...previousRaw, ...currentRaw].filter((id) => id !== actorUserId),
  );
  if (input.currentVisibility === 'hidden') {
    const allowed = [...currentVisible];
    await tx.notification.deleteMany({
      where: {
        sessionId,
        ...(allowed.length === 0 ? {} : { userId: { notIn: allowed } }),
      },
    });
  } else if (accessLost.length > 0) {
    await tx.notification.deleteMany({
      where: { sessionId, userId: { in: accessLost } },
    });
  }
  if (rawAdded.length > 0) {
    await tx.notification.deleteMany({
      where: { sessionId, type: 'session_unassigned', userId: { in: rawAdded } },
    });
  }
  if (rawRemoved.length > 0) {
    await tx.notification.deleteMany({
      where: { sessionId, type: 'session_assigned', userId: { in: rawRemoved } },
    });
  }
  const assigned = await writeFor(
    tx,
    sessionId,
    'session_assigned',
    added.filter((id) => id !== actorUserId),
  );
  const unassigned = await writeFor(
    tx,
    sessionId,
    'session_unassigned',
    removed.filter((id) => id !== actorUserId),
  );
  return { assigned, unassigned };
}

/* ── Revision 116 — actionable account and exam changes ─────────────────── */

export type SubjectUserNotificationKind =
  | 'registration_review_required'
  | 'registration_approved'
  | 'registration_rejected'
  | 'family_link_requested'
  | 'family_link_approved'
  | 'family_link_rejected'
  | 'family_link_revoked'
  | 'role_assignments_changed'
  | 'platform_ownership_received'
  | 'enrollment_changed';

/**
 * Writes one semantic account/relationship notice and resurfaces it only when
 * the caller has proved a new domain transition occurred.
 *
 * The unique coordinate is `(recipient, affected person, type)`. That is
 * deliberate for recurring facts such as placement or role changes: the bell
 * carries the current actionable state, while AuditLog remains the history.
 * Callers MUST NOT invoke this helper for an unchanged save.
 */
export async function notifySubjectUserChange(
  tx: Prisma.TransactionClient,
  input: {
    type: SubjectUserNotificationKind;
    subjectUserId: string;
    recipientUserIds: readonly string[];
    actorUserId: string;
  },
): Promise<number> {
  const recipients = await liveNotificationRecipients(
    tx,
    [...new Set(input.recipientUserIds)].filter((id) => id !== input.actorUserId),
  );
  if (recipients.length === 0) return 0;

  const created = await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      subjectUserId: input.subjectUserId,
      type: input.type,
    })),
    skipDuplicates: true,
  });
  const spent = await tx.notification.findMany({
    where: {
      userId: { in: recipients },
      subjectUserId: input.subjectUserId,
      type: input.type,
      deletedAt: null,
      readAt: { not: null },
    },
    select: { id: true },
  });
  const now = new Date();
  for (const row of spent) {
    await tx.notification.update({
      where: { id: row.id },
      data: { readAt: null, createdAt: now },
    });
  }
  return created.count + spent.length;
}

/** Everyone whose live Admin/Super-Admin assignment gives them the approvals queue. */
export async function approvalReviewRecipients(
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: 'active',
      branchRoles: {
        some: {
          deletedAt: null,
          userStatus: 'active',
          role: { name: { in: ['admin', 'super_admin'] } },
        },
      },
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

interface ExamNoticeSpec {
  levelId: string;
  administrativeGroupId: string | null;
  branchId: string;
  visibility: 'public' | 'private' | 'hidden';
}

interface ExamNoticeStaff {
  userId: string;
  position: 'supervisor' | 'assistant';
}

/** R109 permits only the responsible supervisor to read a hidden sitting. */
function examStaffRecipients(
  spec: ExamNoticeSpec,
  staff: readonly ExamNoticeStaff[],
): string[] {
  return staff
    .filter((person) => spec.visibility !== 'hidden' || person.position === 'supervisor')
    .map((person) => person.userId);
}

/**
 * The exam roster is the grade-sheet roster, not a new interpretation: a named
 * Administrative Group or the whole Level at the sitting's branch. Hidden is
 * a publication rule and therefore yields no student scheduling notice.
 */
async function examStudentRecipients(
  tx: Prisma.TransactionClient,
  spec: ExamNoticeSpec,
): Promise<string[]> {
  if (spec.visibility === 'hidden') return [];
  const where =
    spec.administrativeGroupId === null
      ? audienceWhere({
          teachingMode: 'entire_level',
          levelId: spec.levelId,
          administrativeGroupId: null,
          teachingGroupId: null,
          branchId: spec.branchId,
          // Period-blind: recipients are who the exam concerns (R123).
          on: null,
        })
      : audienceWhere({
          teachingMode: 'administrative_group',
          levelId: null,
          administrativeGroupId: spec.administrativeGroupId,
          teachingGroupId: null,
          branchId: spec.branchId,
          // Period-blind: recipients are who the exam concerns (R123).
          on: null,
        });
  const rows = await tx.user.findMany({
    // `audienceWhere` is also live-only; keep the recipient read itself
    // explicit so every soft-deletable read fails closed under source audit.
    where: { ...where, deletedAt: null },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

type ExamNotificationKind =
  | 'exam_teacher_assigned'
  | 'exam_teacher_unassigned'
  | 'exam_scheduled'
  | 'exam_rescheduled'
  | 'exam_changed'
  | 'exam_cancelled';

async function writeExamNotice(
  tx: Prisma.TransactionClient,
  examId: string,
  type: ExamNotificationKind,
  userIds: readonly string[],
  actorUserId: string,
): Promise<number> {
  const recipients = await liveNotificationRecipients(
    tx,
    [...new Set(userIds)].filter((id) => id !== actorUserId),
  );
  if (recipients.length === 0) return 0;
  const created = await tx.notification.createMany({
    data: recipients.map((userId) => ({ userId, examId, type })),
    skipDuplicates: true,
  });
  const spent = await tx.notification.findMany({
    where: {
      examId,
      type,
      userId: { in: recipients },
      deletedAt: null,
      readAt: { not: null },
    },
    select: { id: true },
  });
  const now = new Date();
  for (const row of spent) {
    await tx.notification.update({
      where: { id: row.id },
      data: { readAt: null, createdAt: now },
    });
  }
  return created.count + spent.length;
}

async function reconcileExamStaffNotices(
  tx: Prisma.TransactionClient,
  examId: string,
  addedUserIds: readonly string[],
  removedUserIds: readonly string[],
  actorUserId: string,
): Promise<{ assigned: number; unassigned: number }> {
  const added = [...new Set(addedUserIds)];
  const removed = [...new Set(removedUserIds)];

  // A stale opposite statement must not survive a real state transition.
  if (added.length > 0) {
    await tx.notification.deleteMany({
      where: { examId, type: 'exam_teacher_unassigned', userId: { in: added } },
    });
  }
  if (removed.length > 0) {
    await tx.notification.deleteMany({
      where: { examId, type: 'exam_teacher_assigned', userId: { in: removed } },
    });
  }

  const assigned = await writeExamNotice(
    tx,
    examId,
    'exam_teacher_assigned',
    added,
    actorUserId,
  );
  const unassigned = await writeExamNotice(
    tx,
    examId,
    'exam_teacher_unassigned',
    removed,
    actorUserId,
  );
  return { assigned, unassigned };
}

const EXAM_STUDENT_NOTICE_TYPES = [
  'exam_scheduled',
  'exam_rescheduled',
  'exam_changed',
  'exam_cancelled',
] as const;

/**
 * Withdraws student-facing statements that a real scope/publication transition
 * made stale. In particular, changing a sitting to `hidden` must remove the
 * previously delivered title/date rather than replacing it with a cancellation
 * that still discloses the hidden sitting. Assigned supervisors remain a
 * separate responsibility audience and are reconciled independently.
 */
async function withdrawExamStudentNotices(
  tx: Prisma.TransactionClient,
  examId: string,
  userIds: readonly string[],
  types: readonly (typeof EXAM_STUDENT_NOTICE_TYPES)[number][] = EXAM_STUDENT_NOTICE_TYPES,
): Promise<void> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;
  await tx.notification.deleteMany({
    where: {
      examId,
      userId: { in: recipients },
      type: { in: [...types] },
    },
  });
}

/** Scheduling and assignment facts join creation's transaction. */
export async function notifyExamCreated(
  tx: Prisma.TransactionClient,
  examId: string,
  spec: ExamNoticeSpec,
  staff: readonly ExamNoticeStaff[],
  actorUserId: string,
): Promise<{ assigned: number; scheduled: number }> {
  const students = await examStudentRecipients(tx, spec);
  const staffUserIds = examStaffRecipients(spec, staff);
  // One deterministic User-lock acquisition for the whole obligation. Staffing
  // and student delivery are distinct notices, but they must not acquire two
  // overlapping recipient sets in different orders.
  await liveNotificationRecipients(
    tx,
    [...staffUserIds, ...students].filter((id) => id !== actorUserId),
  );
  const staffNotices = await reconcileExamStaffNotices(
    tx,
    examId,
    staffUserIds,
    [],
    actorUserId,
  );
  const scheduled = await writeExamNotice(
    tx,
    examId,
    'exam_scheduled',
    students,
    actorUserId,
  );
  return { assigned: staffNotices.assigned, scheduled };
}

/**
 * Reconciles one actual exam edit. Newly scoped students are scheduled,
 * removed students are cancelled, retained students and retained staff are
 * rescheduled. Staff assignment/removal remains semantically distinct.
 */
export async function notifyExamUpdated(
  tx: Prisma.TransactionClient,
  examId: string,
  input: {
    previous: ExamNoticeSpec;
    current: ExamNoticeSpec;
    previousStaff: readonly ExamNoticeStaff[];
    currentStaff: readonly ExamNoticeStaff[];
    rescheduled: boolean;
    detailsChanged: boolean;
    audienceChanged: boolean;
  },
  actorUserId: string,
): Promise<void> {
  const previousRawStaff = new Set(input.previousStaff.map((person) => person.userId));
  const currentRawStaff = new Set(input.currentStaff.map((person) => person.userId));
  const previousVisibleStaff = new Set(examStaffRecipients(input.previous, input.previousStaff));
  const currentVisibleStaff = new Set(examStaffRecipients(input.current, input.currentStaff));
  const addedRawStaff = [...currentRawStaff].filter((id) => !previousRawStaff.has(id));
  const removedRawStaff = [...previousRawStaff].filter((id) => !currentRawStaff.has(id));
  const accessGained = [...currentRawStaff].filter(
    (id) => previousRawStaff.has(id) && !previousVisibleStaff.has(id) && currentVisibleStaff.has(id),
  );
  const accessLost = [...previousRawStaff].filter(
    (id) => currentRawStaff.has(id) && previousVisibleStaff.has(id) && !currentVisibleStaff.has(id),
  );
  const assignedNotices = [
    ...addedRawStaff.filter((id) => currentVisibleStaff.has(id)),
    ...accessGained,
  ];
  const unassignedNotices =
    input.current.visibility === 'hidden'
      ? []
      : removedRawStaff.filter((id) => previousVisibleStaff.has(id));
  const previousStudents = new Set(await examStudentRecipients(tx, input.previous));
  const currentStudents = new Set(await examStudentRecipients(tx, input.current));
  await liveNotificationRecipients(
    tx,
    [
      ...previousRawStaff,
      ...currentRawStaff,
      ...previousStudents,
      ...currentStudents,
    ].filter((id) => id !== actorUserId),
  );

  // Opposite facts become stale on a real staff transition even when the
  // person's new position is not eligible to read a hidden sitting.
  if (addedRawStaff.length > 0) {
    await tx.notification.deleteMany({
      where: { examId, type: 'exam_teacher_unassigned', userId: { in: addedRawStaff } },
    });
  }
  if (removedRawStaff.length > 0) {
    await tx.notification.deleteMany({
      where: { examId, type: 'exam_teacher_assigned', userId: { in: removedRawStaff } },
    });
  }
  // Visibility/position eligibility changed, not staffing. Withdraw coordinates
  // that are no longer readable without falsely telling an unchanged assistant
  // that she was removed from the exam.
  if (accessLost.length > 0) {
    await tx.notification.deleteMany({
      where: {
        examId,
        userId: { in: accessLost },
        type: { in: ['exam_teacher_assigned', 'exam_rescheduled', 'exam_changed'] },
      },
    });
  }
  await reconcileExamStaffNotices(
    tx,
    examId,
    assignedNotices,
    unassignedNotices,
    actorUserId,
  );
  if (!input.rescheduled && !input.detailsChanged && !input.audienceChanged) return;

  const retainedStaff = [...currentVisibleStaff].filter((id) => previousVisibleStaff.has(id));
  if (input.current.visibility === 'hidden') {
    // R109: students cannot read a hidden sitting. A cancellation notification
    // would still reveal its current title/date through the inbox projection,
    // so the only fail-closed transition is withdrawal of every student-facing
    // statement previously delivered for it. Staff responsibility remains
    // visible only to the retained/added staffing paths.
    await withdrawExamStudentNotices(tx, examId, [...previousStudents]);
    if (input.rescheduled || input.detailsChanged) {
      await writeExamNotice(
        tx,
        examId,
        input.rescheduled ? 'exam_rescheduled' : 'exam_changed',
        retainedStaff,
        actorUserId,
      );
    }
    return;
  }

  const newlyScoped = [...currentStudents].filter((id) => !previousStudents.has(id));
  const removed = [...previousStudents].filter((id) => !currentStudents.has(id));
  const retained = [...currentStudents].filter((id) => previousStudents.has(id));

  // A person re-entering the audience must not retain an old cancellation;
  // somebody leaving it must not retain a schedule/reschedule that now points
  // at an exam outside her scope.
  await withdrawExamStudentNotices(tx, examId, newlyScoped, ['exam_cancelled']);
  await withdrawExamStudentNotices(
    tx,
    examId,
    removed,
    ['exam_scheduled', 'exam_rescheduled'],
  );

  if (input.audienceChanged) {
    await writeExamNotice(tx, examId, 'exam_scheduled', newlyScoped, actorUserId);
    await writeExamNotice(tx, examId, 'exam_cancelled', removed, actorUserId);
  }
  if (input.rescheduled || input.detailsChanged) {
    await writeExamNotice(
      tx,
      examId,
      input.rescheduled ? 'exam_rescheduled' : 'exam_changed',
      [...retained, ...retainedStaff],
      actorUserId,
    );
  }
}

/** A deleted sitting tells its current roster and current staff atomically. */
export async function notifyExamCancelled(
  tx: Prisma.TransactionClient,
  examId: string,
  spec: ExamNoticeSpec,
  staff: readonly ExamNoticeStaff[],
  actorUserId: string,
): Promise<number> {
  const students = await examStudentRecipients(tx, spec);
  const staffUserIds = examStaffRecipients(spec, staff);
  const recipients = [...new Set([...students, ...staffUserIds])];
  // A cancellation is the current actionable state. Withdraw live scheduling
  // and assignment statements for the people who are still concerned, while
  // leaving former-staff unassignment history untouched.
  if (recipients.length > 0) {
    await tx.notification.deleteMany({
      where: {
        examId,
        userId: { in: recipients },
        type: {
          in: [
            'exam_scheduled',
            'exam_rescheduled',
            'exam_changed',
            'exam_teacher_assigned',
          ],
        },
      },
    });
  }
  return writeExamNotice(
    tx,
    examId,
    'exam_cancelled',
    recipients,
    actorUserId,
  );
}

/* ── The ONLINE assessment (R124) ─────────────────────────────────────────── */

/**
 * What `notifyAssessmentPublished` needs to resolve its two audiences. It is
 * the assessment row itself, not a re-derived summary of it, so nothing here
 * can disagree with what the paper actually targets.
 */
export interface AssessmentNoticeSpec {
  targetKind: string;
  levelId: string;
  branchId: string | null;
  administrativeGroupId: string | null;
  sessionId: string | null;
  teachingGroupId: string | null;
  studentId: string | null;
  subjectId: string | null;
  date: Date;
}

/**
 * **The مؤطِّرات an online assessment concerns.**
 *
 * ## Why this is not a new scope rule
 *
 * `assertExamInTeacherScope` already answers *may this مؤطِّرة organise this
 * paper*, and `examScopeWhereForTeacher` answers *which papers are hers*. Its
 * docstring says why they live side by side: **two grammars of one question
 * drift when they are written apart, and the drift is invisible.** A third
 * grammar — *whose paper is this* — would be a third place to drift, so this
 * does not write one. It narrows to a small candidate set and then asks **the
 * assertion itself**, which makes agreement structural rather than intended.
 *
 * The candidates are the people staffing a live schedule that teaches this
 * assessment's Level, **effective on the assessment's own date** (R91), which
 * is the same date the assertion judges authority on. Anyone the assertion
 * refuses is dropped, so a مؤطِّرة who staffs a group inside the Level but does
 * not reach this target is not told about a paper she cannot open.
 */
async function assessmentStaffRecipients(
  tx: Prisma.TransactionClient,
  spec: AssessmentNoticeSpec,
): Promise<string[]> {
  const schedules = await tx.recurringCourseSchedule.findMany({
    where: {
      deletedAt: null,
      OR: [
        { levelId: spec.levelId },
        { administrativeGroup: { levelId: spec.levelId } },
        { teachingGroup: { levelId: spec.levelId } },
      ],
    },
    select: {
      staff: {
        where: { deletedAt: null, ...effectiveOn(spec.date) },
        select: { userId: true },
      },
    },
  });
  const candidates = [
    ...new Set(schedules.flatMap((row) => row.staff.map((person) => person.userId))),
  ];

  const reaches: string[] = [];
  for (const userId of candidates) {
    try {
      await assertExamInTeacherScope(
        tx as unknown as PrismaClient,
        userId,
        {
          // An online assessment carries neither branch nor room; the empty
          // strings are the sentinel `assertExamInTeacherScope` already
          // documents for exactly this case, and they widen the question to
          // *do you teach anybody in this Level* rather than forcing an empty
          // UUID through a cast.
          branchId: spec.branchId ?? '',
          levelId: spec.levelId,
          subjectId: spec.subjectId ?? '',
          administrativeGroupId: spec.administrativeGroupId,
        },
        spec.date,
      );
      reaches.push(userId);
    } catch {
      // Refused by the authority predicate — she may not open this paper, so
      // she is not told it exists (§20 rule 17).
    }
  }
  return reaches;
}

/**
 * **`POST /assessments/{id}/publish` — the moment the paper reaches people.**
 *
 * ## The defect this closes
 *
 * R116 clause 5 wired the **physical** Exam lifecycle to the inbox and R124
 * built the **online** assessment afterwards, on the same `Exam` row but with a
 * lifecycle of its own. Publication — the one transition that makes a paper
 * visible to anybody — wrote a state change and an audit row and told **nobody
 * at all**. The notification capability was complete and had no reach into this
 * transition, which is this platform's most repeated defect shape.
 *
 * ## The student audience is the SAME predicate that lists her papers
 *
 * `examAudienceWhere` is what `eligible()` uses to decide whether she may open
 * this assessment and what `GET /me/assessments` filters on. Resolving
 * recipients through it means the inbox cannot disagree with the list —
 * R77.3's rule, that a notification list disagreeing with its own audience
 * makes both unusable, applied to R125's five target arms.
 *
 * It also makes the two-enrolment case correct **structurally rather than by a
 * de-duplication step**: the query selects `User` rows, so a مستفيدة enrolled in
 * this Level and another one is one row and therefore one notice.
 *
 * ## Idempotent, like every other type
 *
 * The `(user_id, exam_id, type)` coordinate carries it: re-publishing a
 * previously published paper is refused upstream by the state machine, and a
 * retried transaction writes the same rows.
 */
export async function notifyAssessmentPublished(
  tx: Prisma.TransactionClient,
  examId: string,
  spec: AssessmentNoticeSpec,
  actorUserId: string,
): Promise<{ students: number; staff: number }> {
  const where = await examAudienceWhere(tx, {
    targetKind: spec.targetKind,
    levelId: spec.levelId,
    branchId: spec.branchId,
    administrativeGroupId: spec.administrativeGroupId,
    sessionId: spec.sessionId,
    teachingGroupId: spec.teachingGroupId,
    studentId: spec.studentId,
    // R122 — resolved on the assessment's own date, exactly as `eligible` does.
    on: spec.date,
  });
  const students =
    where === null
      ? []
      : (
          await tx.user.findMany({
            // Written even though every arm already constrains it, so this read
            // is safe on its own reading (the rule `eligible` states beside the
            // identical call).
            where: { AND: [where, { deletedAt: null }] },
            select: { id: true },
          })
        ).map((row) => row.id);

  const staff = await assessmentStaffRecipients(tx, spec);

  // One deterministic lock acquisition for the whole obligation, as the exam
  // path does: the two audiences overlap whenever a مؤطِّرة also studies.
  await liveNotificationRecipients(
    tx,
    [...students, ...staff].filter((id) => id !== actorUserId),
  );

  await writeAssessmentNotice(tx, examId, [...students, ...staff], actorUserId);
  return {
    students: students.filter((id) => id !== actorUserId).length,
    staff: staff.filter((id) => id !== actorUserId).length,
  };
}

/** The insert half, shaped like `writeExamNotice` and sharing its rules: the
 *  actor is never a recipient (R78.3), inactive accounts are dropped under the
 *  lock, and the unique coordinate makes a retry silent. */
async function writeAssessmentNotice(
  tx: Prisma.TransactionClient,
  examId: string,
  userIds: readonly string[],
  actorUserId: string,
): Promise<number> {
  const recipients = await liveNotificationRecipients(
    tx,
    [...new Set(userIds)].filter((id) => id !== actorUserId),
  );
  if (recipients.length === 0) return 0;
  const result = await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      examId,
      type: 'assessment_published' as const,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
