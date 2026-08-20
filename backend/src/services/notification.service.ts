import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../policies/actor.js";
import { assertMayEdit } from "./event.service.js";
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
  type AudienceSpec,
  audienceForSession,
} from "../policies/roster-resolution.js";

/**
 * **The one MVP notification event** (§4.8 as narrowed by Revision 77).
 *
 * ## What this is not
 *
 * It is not §10.1's framework arriving early. There is no tier, no
 * `NotificationPreference`, no channel and no catalogue — R6 postponed all of
 * that and R77 left it postponed. What returned is one event and the smallest
 * entity that can carry it.
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
  const [students, staff] = await Promise.all([
    resolveAudience(tx as unknown as PrismaClient, spec),
    tx.sessionStaff.findMany({
      where: { sessionId, deletedAt: null },
      select: { userId: true },
    }),
  ]);
  const everyone = new Set([
    ...students.map((s) => s.id),
    ...staff.map((s) => s.userId),
  ]);
  // **Never notified of your own act** — the whole of R78.3's narrowing.
  everyone.delete(actorUserId);
  return [...everyone];
}

export type NotificationKind =
  | "session_cancelled"
  | "session_restored"
  | "session_assigned"
  | "session_rescheduled"
  | "event_created"
  | "event_rescheduled"
  | "event_cancelled"
  | "grade_published";

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
    subject: { name: string } | null;
  } | null;
}

/**
 * **What a notice needs to be readable, per target** (R82.1).
 *
 * Three different shapes, which is the concrete reason R82 chose three foreign
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
    select: { title: true, date: true, subject: { select: { name: true } } },
  },
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
  type: "session_cancelled" | "session_rescheduled" | "session_assigned",
  userIds: readonly string[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  const created = await tx.notification.createMany({
    data: userIds.map((userId) => ({ userId, sessionId, type })),
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
      branchScopes: { select: { branchId: true } },
      categoryScopes: { select: { categoryId: true } },
      levelScopes: { select: { levelId: true } },
      administrativeGroupScopes: { select: { administrativeGroupId: true } },
      staff: { where: { deletedAt: null }, select: { userId: true } },
    },
  });
  if (!event) throw new AppError("NOT_FOUND", "no such event");

  const where = eventAudienceWhere({
    branchIds: event.branchScopes.map((r) => r.branchId),
    categoryIds: event.categoryScopes.map((r) => r.categoryId),
    levelIds: event.levelScopes.map((r) => r.levelId),
    administrativeGroupIds: event.administrativeGroupScopes.map(
      (r) => r.administrativeGroupId,
    ),
  });

  // A GLOBAL event resolves to no audience at all (R82.7) — but its own staff
  // are still concerned by it, which is a different question from its scope.
  const audience =
    where === null
      ? []
      : await prisma.user.findMany({ where, select: { id: true } });

  const everyone = new Set([
    ...audience.map((u) => u.id),
    ...event.staff.map((s) => s.userId),
  ]);
  everyone.delete(actorUserId);
  return [...everyone];
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
  // **Authorization is the event's own**: whoever may edit it may announce it,
  // asked through the SAME assertion the write used rather than a second answer
  // to the same question.
  await assertMayEdit(
    prisma as unknown as Prisma.TransactionClient,
    actor,
    eventId,
  );

  const type = (
    {
      created: "event_created",
      rescheduled: "event_rescheduled",
      cancelled: "event_cancelled",
    } as const
  )[change];
  const userIds = await eventRecipients(prisma, eventId, actor.userId);
  if (userIds.length === 0) return { notified: 0 };

  const created = await prisma.notification.createMany({
    data: userIds.map((userId) => ({ userId, eventId, type })),
    skipDuplicates: true,
  });
  return { notified: created.count };
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
 * **Written at publication, and only there** (BR-8).
 *
 * A draft sheet is a مؤطرة's working document, so a draft save writes nothing —
 * the caller is `publishGrades`, inside its transaction, because publication and
 * the notice that it happened are one fact.
 *
 * **Re-publication writes nothing new.** The unique index on
 * `(user, exam, type)` absorbs it, and that is the coherent behaviour rather
 * than a limitation: the row points at the exam, so a student who has been told
 * her grade is available is not told a second time because the number changed —
 * her screen already shows the current one.
 *
 * The actor is excluded like everywhere else, which in practice matters for a
 * مؤطرة who is also enrolled somewhere (R79 makes that expressible).
 */
export async function notifyGradePublished(
  tx: Prisma.TransactionClient,
  examId: string,
  studentIds: readonly string[],
  actorUserId: string,
): Promise<number> {
  const recipients = studentIds.filter((id) => id !== actorUserId);
  if (recipients.length === 0) return 0;
  const created = await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      examId,
      type: "grade_published" as const,
    })),
    skipDuplicates: true,
  });
  return created.count;
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

  if (unread.length > 0) {
    // A hard delete, deliberately: the audit log already holds both the cancel
    // and the restore, so nothing historical is lost, and a soft-deleted notice
    // would keep the list read filtering rows nobody may ever see again.
    await tx.notification.deleteMany({
      where: { id: { in: unread.map((n) => n.id) } },
    });
  }
  if (read.length > 0) {
    await tx.notification.createMany({
      data: read.map((n) => ({
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
