import type {
  Prisma,
  PrismaClient,
  Session,
  SessionStatus,
} from "../generated/prisma/client.js";
import { notifyRestored } from "./notification.service.js";
import { AppError } from "../lib/errors.js";
import { atMidnightUtc } from "../lib/recurrence.js";
import * as scope from "../policies/branch-scope.js";
import {
  audienceForSession,
  audienceSize,
  audienceWhere,
  staffsSession,
} from "../policies/roster-resolution.js";
import * as audit from "../repositories/audit.repository.js";
import * as trash from "../repositories/trash.repository.js";
import { updateWithVersion } from "../repositories/optimistic-lock.js";
import {
  protectionReasonsFor,
  SELECT_PROTECTABLE,
} from "../policies/session-protection.js";
import type { Actor } from "../policies/actor.js";

/**
 * Sessions — the materialized dated occurrence (SRS §4.4, TD-1, TD-8,
 * Revision 43).
 *
 * **The distinction this file exists to hold: a reschedule is a FIELD EDIT, a
 * cancellation is a TRANSITION** (TD-1). Moving a class to another room or hour
 * sets the session's own values and marks it `overridden`; cancelling it moves
 * `scheduled → cancelled` and keeps the row, carrying its reason, because *"a
 * vanished class is indistinguishable from one that never existed"*.
 *
 * **`overridden` is what protects a human decision from the next schedule edit**
 * (§20 rule 24). Setting it is therefore not bookkeeping — it is the entire
 * mechanism by which `session.materialize` knows to leave a row alone.
 *
 * **TD-2:** Admins act within branch scope; a **Teacher may act only on sessions
 * they staff** (§4.4c resolves that, and this file does not restate it).
 */

const MANAGING_ROLE = "admin";

const isSuperAdmin = (actor: Actor): boolean =>
  scope.isSuperAdmin(actor.roleScopes);
const isAdmin = (actor: Actor): boolean =>
  scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor);
const isTeacher = (actor: Actor): boolean =>
  scope.hasRole(actor.roleScopes, "teacher");

/**
 * TD-1's exhaustive transition table. **Anything absent is prohibited and
 * answers `STATE_CONFLICT`** (§20 rule 12) — the table is the specification, so
 * it is written out rather than inferred from a chain of `if`s.
 */
const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  scheduled: ["cancelled", "held"],
  cancelled: ["scheduled"],
  held: [],
};

function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(
      "STATE_CONFLICT",
      `a ${from} session cannot become ${to}`,
      {
        reason: "INVALID_TRANSITION",
        from,
        to,
        allowed: TRANSITIONS[from],
      },
    );
  }
}

/**
 * Authorises an action on one session and returns what the caller needs.
 *
 * **Out-of-scope answers `404`, never `403`** (§20 rule 17): a `403` would
 * confirm that a class exists at a branch — or in a course — the caller may not
 * see.
 */
/**
 * **Exported for R83.3's optional send**: whoever may change an occurrence may
 * announce the change, and the announcement asks the SAME question the write
 * asked. A second implementation of *may this person touch this session* would
 * be a second answer, and the two would drift.
 */
export async function loadForWrite(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
): Promise<
  Session & {
    schedule: {
      branchId: string;
      teachingMode: string;
      levelId: string | null;
      administrativeGroupId: string | null;
      teachingGroupId: string | null;
    };
  }
> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: {
      schedule: {
        select: {
          branchId: true,
          teachingMode: true,
          levelId: true,
          administrativeGroupId: true,
          teachingGroupId: true,
        },
      },
    },
  });
  if (!session) throw new AppError("NOT_FOUND", "no such session");

  if (isAdmin(actor)) {
    scope.assertCanActOnBranch(
      actor.roleScopes,
      MANAGING_ROLE,
      session.schedule.branchId,
      "no such session",
    );
    return session;
  }

  if (isTeacher(actor)) {
    // TD-2: "only sessions they staff". Co-teachers and assistants both count —
    // §4.4c gives them one table and one rule.
    if (!(await staffsSession(prisma, actor.userId, sessionId))) {
      throw new AppError("NOT_FOUND", "no such session");
    }
    return session;
  }

  throw new AppError(
    "FORBIDDEN",
    "session management requires admin or the teaching staff",
  );
}

export interface SessionOverride {
  date?: Date;
  startTime?: Date;
  endTime?: Date;
  roomId?: string | null;
  /** The occurrence's own staffing (Revision 43.4). Supplying it REPLACES the
   *  snapshot for this session; omitting it leaves the snapshot untouched. */
  staff?: { userId: string; position: "teacher" | "assistant" }[];
  version: number;
}

/**
 * Reschedules, moves, or re-staffs one occurrence — **a field edit, not a
 * transition** (TD-1).
 *
 * Always marks the row `overridden`, even when the new values happen to equal
 * the schedule's: the flag records that **a human decided about this
 * occurrence**, and that is what must survive the next schedule edit. Inferring
 * it from "differs from the schedule" would silently un-protect a session whose
 * schedule later moved to match it.
 */
export async function overrideSession(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  data: SessionOverride,
): Promise<Session> {
  const session = await loadForWrite(prisma, actor, sessionId);

  if (session.status === "held") {
    throw new AppError(
      "STATE_CONFLICT",
      "a held session cannot be rescheduled",
      {
        reason: "ALREADY_HELD",
      },
    );
  }

  if (data.roomId) {
    const room = await prisma.room.findFirst({
      where: { id: data.roomId, deletedAt: null },
      select: { branchId: true },
    });
    if (!room) throw new AppError("NOT_FOUND", "no such room");
    if (room.branchId !== session.schedule.branchId) {
      throw new AppError("VALIDATION_FAILED", "room is at a different branch", {
        reason: "ROOM_BRANCH_MISMATCH",
      });
    }
    // BR-23: capacity is not consulted here either.
  }

  // Plain strings so the payload is a valid JSON value for the audit column,
  // and so a reviewer reading the row sees exactly what an operator saw.
  const changed: Record<string, { from: string | null; to: string | null }> =
    {};
  const track = (
    key: string,
    from: string | null,
    to: string | null | undefined,
  ): void => {
    if (to !== undefined && from !== to) changed[key] = { from, to };
  };
  track(
    "date",
    session.date.toISOString().slice(0, 10),
    data.date?.toISOString().slice(0, 10),
  );
  track(
    "start_time",
    session.startTime.toISOString(),
    data.startTime?.toISOString(),
  );
  track("end_time", session.endTime.toISOString(), data.endTime?.toISOString());
  track("room_id", session.roomId, data.roomId);

  return prisma.$transaction(async (tx) => {
    const updated = await updateWithVersion<Session>({
      delegate: tx.session,
      id: sessionId,
      expectedVersion: data.version,
      requireNotDeleted: true,
      data: {
        ...(data.date === undefined ? {} : { date: atMidnightUtc(data.date) }),
        ...(data.startTime === undefined ? {} : { startTime: data.startTime }),
        ...(data.endTime === undefined ? {} : { endTime: data.endTime }),
        ...(data.roomId === undefined ? {} : { roomId: data.roomId }),
        overridden: true,
      },
    });

    if (data.staff !== undefined) {
      const before = await tx.sessionStaff.findMany({
        where: { sessionId, deletedAt: null },
        select: { userId: true, position: true },
      });
      await replaceSessionStaff(tx, sessionId, data.staff);
      changed["staff"] = {
        from:
          before
            .map((b) => `${b.position}:${b.userId}`)
            .sort()
            .join(",") || null,
        to:
          data.staff
            .map((b) => `${b.position}:${b.userId}`)
            .sort()
            .join(",") || null,
      };
    }

    /**
     * **R78.4 — a reschedule is a change of WHEN, not of anything else.**
     *
     * Moving a class to another room is not news a student must act on; moving
     * it to another day is. So the notice is written only when the date or a
     * time actually changed — `changed` already records exactly that, having
     * been built from old-versus-new rather than from what was submitted.
     */
    /**
     * **R83.3 — a reschedule notice is the actor's decision, taken after this
     * commits**, exactly as a cancellation's now is. R78.4 wrote it here; the
     * write and the telling are separated so declining creates nothing.
     *
     * `moved_in_time` still travels on the audit row, because *whether this
     * edit actually moved the class* is a fact about the edit and the screen
     * uses it to decide whether to offer the notice at all — retiming nothing
     * is not news.
     */
    const movedInTime = ["date", "start_time", "end_time"].some(
      (k) => k in changed,
    );

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.override",
      targetEntity: "Session",
      targetId: sessionId,
      // TD-8: the fields old→new, which is exactly the distinction that
      // protects this row from the next materialization.
      detail: { changed, moved_in_time: movedInTime },
    });
    return updated;
  });
}

/**
 * Cancels one occurrence (TD-1 `scheduled → cancelled`).
 *
 * **The reason is OPTIONAL (R83.2).** R43's `session_cancellation_reason_check`
 * and R77's insistence are both retired: a class is sometimes simply not held,
 * and demanding a sentence before the platform will record that is a gate with
 * no purpose. `null` and `''` are one state, normalised at the boundary, so a
 * notice renders the reason when there is one and says only that the class is
 * cancelled when there is not.
 *
 * The audit row records **how many students this affected**, resolved at the
 * moment of the action (§4.4c). That number is unanswerable later once the
 * roster has moved on, and a cancellation is the one calendar action
 * beneficiaries actually notice.
 */
export async function cancelSession(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  reason: string | null,
  version: number,
): Promise<Session> {
  const session = await loadForWrite(prisma, actor, sessionId);
  assertTransition(session.status, "cancelled");

  /**
   * **Normalised HERE, not at the boundary** (R83.2).
   *
   * The validator trims too, but a service that trusted it would store `'   '`
   * for any caller that is not an HTTP request — which a test calling the
   * service directly proved immediately. *Absent* and *blank* must be one
   * state, or a notice renders an empty reason line for a cancellation that
   * gave none.
   */
  const stated = reason === null || reason.trim() === "" ? null : reason.trim();

  // ONE spec, used by both the audit count and the notification write (R77.3):
  // two resolutions that agree today are two that drift, and a notification list
  // disagreeing with the audit's `audience_size` would make both unusable.
  // **R92 — the OCCURRENCE's audience, not its schedule's.** A combined
  // occurrence draws from two branches, and the count written into the audit row
  // is *how many people this cancellation affected* — which is the people who
  // were expected at THIS class, not the ones the recurring rule usually gathers.
  // Built through `audienceForSession` so it cannot disagree with the
  // notification list resolved from the same function moments later.
  const spec = (await audienceForSession(prisma, sessionId)) ?? {
    teachingMode: session.schedule.teachingMode as never,
    levelId: session.schedule.levelId,
    administrativeGroupId: session.schedule.administrativeGroupId,
    teachingGroupId: session.schedule.teachingGroupId,
    branchId: session.schedule.branchId,
  };
  const affected = await audienceSize(prisma, spec);

  return prisma.$transaction(async (tx) => {
    const updated = await updateWithVersion<Session>({
      delegate: tx.session,
      id: sessionId,
      expectedVersion: version,
      requireNotDeleted: true,
      data: { status: "cancelled", cancellationReason: stated },
    });
    /**
     * **The notice is no longer written here (R83.3).**
     *
     * R77.4 wrote it inside this transaction, fearing *a committed cancellation
     * nobody was told about*. The Owner's answer is better than the guard: the
     * person is **asked, every time**, through `POST /sessions/{id}/notify`
     * after this commits. Declining then creates nothing — which R77.4 could
     * not express at all — and a failure to notify can never roll back a
     * cancellation that succeeded.
     *
     * Idempotency now carries the whole weight and already did the work: the
     * `(user, session, type)` unique index makes a repeated send the same rows.
     */
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.cancel",
      targetEntity: "Session",
      targetId: sessionId,
      detail: {
        reason: stated,
        date: session.date.toISOString().slice(0, 10),
        audience_size: affected,
      },
    });
    return updated;
  });
}

/**
 * Reverses a cancellation (TD-1 `cancelled → scheduled`) — **only before the
 * date**. Restoring a class that has already passed would put a session on the
 * calendar claiming it happened, which nobody can act on and no attendance can
 * ever be recorded against.
 *
 * The former reason is **kept**: why a class was once cancelled is history worth
 * having, and the CHECK constraint deliberately does not demand it be cleared.
 */
export async function restoreSession(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  version: number,
  now: Date = new Date(),
): Promise<Session> {
  const session = await loadForWrite(prisma, actor, sessionId);
  assertTransition(session.status, "scheduled");

  if (atMidnightUtc(session.date) < atMidnightUtc(now)) {
    throw new AppError("STATE_CONFLICT", "a past session cannot be restored", {
      reason: "SESSION_IN_PAST",
      date: session.date.toISOString().slice(0, 10),
    });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await updateWithVersion<Session>({
      delegate: tx.session,
      id: sessionId,
      expectedVersion: version,
      requireNotDeleted: true,
      data: { status: "scheduled" },
    });
    // R77.5 — an unread notice of something no longer true is withdrawn; one
    // already read is CORRECTED instead, because silently removing it would
    // leave a person believing the class is cancelled with nothing to tell them
    // otherwise.
    const reconciled = await notifyRestored(tx, sessionId);
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.restore",
      targetEntity: "Session",
      targetId: sessionId,
      detail: { date: session.date.toISOString().slice(0, 10), ...reconciled },
    });
    return updated;
  });
}

/** Marks an occurrence as having taken place (TD-1 `scheduled → held`).
 *  Terminal — attendance attaches here when §4.7 ships. */
export async function markHeld(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  version: number,
): Promise<Session> {
  const session = await loadForWrite(prisma, actor, sessionId);
  assertTransition(session.status, "held");

  return prisma.$transaction(async (tx) => {
    const updated = await updateWithVersion<Session>({
      delegate: tx.session,
      id: sessionId,
      expectedVersion: version,
      requireNotDeleted: true,
      data: { status: "held" },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.held",
      targetEntity: "Session",
      targetId: sessionId,
      detail: { date: session.date.toISOString().slice(0, 10) },
    });
    return updated;
  });
}

/**
 * Links existing Educational Content to a Session (§4.9).
 *
 * **A Session REFERENCES content; it never owns it.** One semester PDF is
 * referenced by every session that uses it, and unlinking never deletes the
 * file — which is why this is a join row rather than an FK on the content.
 */
export async function linkContent(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  contentId: string,
): Promise<{ id: string }> {
  await loadForWrite(prisma, actor, sessionId);

  const content = await prisma.educationalContent.findFirst({
    where: { id: contentId, deletedAt: null },
    select: { id: true },
  });
  if (!content) throw new AppError("NOT_FOUND", "no such content");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sessionContent.findFirst({
      where: { sessionId, contentId },
      select: { id: true, deletedAt: true },
    });
    if (existing && existing.deletedAt === null) {
      throw new AppError(
        "DUPLICATE",
        "content is already linked to this session",
      );
    }

    const row = existing
      ? await tx.sessionContent.update({
          where: { id: existing.id },
          data: { deletedAt: null, deletedById: null },
          select: { id: true },
        })
      : await tx.sessionContent.create({
          data: { sessionId, contentId },
          select: { id: true },
        });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.content_link",
      targetEntity: "Session",
      targetId: sessionId,
      detail: { educational_content_id: contentId },
    });
    return row;
  });
}

/** Unlinks content from a session. **Never deletes the file** (§4.9). */
export async function unlinkContent(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  contentId: string,
): Promise<void> {
  await loadForWrite(prisma, actor, sessionId);

  await prisma.$transaction(async (tx) => {
    const row = await tx.sessionContent.findFirst({
      where: { sessionId, contentId, deletedAt: null },
    });
    if (!row)
      throw new AppError("NOT_FOUND", "content is not linked to this session");

    await tx.sessionContent.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    // R59.2 — a Teacher unlinking material from a lesson is a deliberate
    // deletion. The content itself is untouched; what was removed is the link,
    // and the link is what the entry describes.
    await trash.snapshot(tx, {
      targetEntity: "SessionContent",
      targetId: row.id,
      snapshot: JSON.parse(
        JSON.stringify({
          ...row,
          label:
            (
              await tx.educationalContent.findUnique({
                where: { id: contentId },
                select: { title: true },
              })
            )?.title ?? null,
        }),
      ) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.content_unlink",
      targetEntity: "Session",
      targetId: sessionId,
      detail: { educational_content_id: contentId },
    });
  });
}

/**
 * Replaces one occurrence's staffing snapshot.
 *
 * Shared by an explicit override and by regeneration below. Soft-deletes rather
 * than removes a dropped name, so who was once assigned stays visible in the
 * record — the same reasoning TD-5 applies everywhere else.
 */
async function replaceSessionStaff(
  tx: Prisma.TransactionClient,
  sessionId: string,
  staff: { userId: string; position: "teacher" | "assistant" }[],
): Promise<void> {
  const keep = new Set(staff.map((s) => s.userId));
  const existing = await tx.sessionStaff.findMany({
    where: { sessionId },
    select: { id: true, userId: true, deletedAt: true },
  });

  for (const row of existing) {
    if (!keep.has(row.userId) && row.deletedAt === null) {
      await tx.sessionStaff.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });
    }
  }
  for (const s of staff) {
    const found = existing.find((e) => e.userId === s.userId);
    if (found) {
      await tx.sessionStaff.update({
        where: { id: found.id },
        data: { position: s.position, deletedAt: null, deletedById: null },
      });
    } else {
      await tx.sessionStaff.create({
        data: { sessionId, userId: s.userId, position: s.position },
      });
    }
  }
}

/**
 * **The one sanctioned path by which a PROTECTED Session is brought back into
 * line with its schedule (§4.4, Revisions 43.4 / 43.5).**
 *
 * A Session is protected when it has already happened **or when it carries
 * educational work** — attendance, grades, recordings, notes, homework,
 * attached content — and the protection is deliberately **date-independent**: a
 * recording attached to next Tuesday's class is as much someone's labour as one
 * attached to last Tuesday's.
 *
 * **The caller must NAME the sessions.** There is no "regenerate everything"
 * option and no flag on the schedule edit, by design: §4.4 requires *explicit*
 * administrator confirmation, and **an option that can be defaulted true is not
 * a confirmation**. The workflow is two steps on purpose — edit the schedule,
 * read back which occurrences were left alone and why, then name the ones to
 * overwrite.
 *
 * **Admin-only.** A teacher may edit the sessions they staff, but overwriting
 * the record of a class that has already been taught, or discarding work
 * someone attached to one, is not a teaching action.
 *
 * Each session is audited **with why it was protected and what was overwritten**,
 * because after this runs the previous truth exists nowhere else.
 */
export async function regenerateSessions(
  prisma: PrismaClient,
  actor: Actor,
  sessionIds: string[],
): Promise<{ regenerated: string[] }> {
  if (!isAdmin(actor)) {
    throw new AppError(
      "FORBIDDEN",
      "regenerating a protected session is an Admin action",
    );
  }
  if (sessionIds.length === 0) {
    throw new AppError("VALIDATION_FAILED", "name the sessions to regenerate", {
      reason: "NO_SESSIONS_NAMED",
    });
  }

  const done: string[] = [];
  for (const sessionId of sessionIds) {
    // Per session, not one transaction for the batch: each is a separate
    // decision about a separate occurrence, and one failure must not silently
    // undo the others the administrator confirmed.
    await regenerateOne(prisma, actor, sessionId);
    done.push(sessionId);
  }
  return { regenerated: done };
}

async function regenerateOne(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
): Promise<Session> {
  const session = await loadForWrite(prisma, actor, sessionId);

  const schedule = await prisma.recurringCourseSchedule.findFirst({
    where: { id: session.scheduleId, deletedAt: null },
    select: {
      startTime: true,
      endTime: true,
      roomId: true,
      staff: {
        where: { deletedAt: null },
        select: { userId: true, position: true },
      },
    },
  });
  if (!schedule)
    throw new AppError("NOT_FOUND", "the schedule no longer exists");

  const before = await prisma.sessionStaff.findMany({
    where: { sessionId, deletedAt: null },
    select: { userId: true, position: true },
  });
  // Asked of the one authoritative mechanism, so the audit row names whatever
  // safeguard actually applied — including one a module contributed that this
  // file has never heard of (§4.4, R43.6).
  const protectable = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: SELECT_PROTECTABLE,
  });
  const wasProtectedFor = await protectionReasonsFor(prisma, protectable);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.session.update({
      where: { id: sessionId },
      data: {
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        roomId: schedule.roomId,
        // Re-aligned with its schedule, so it is no longer a human's individual
        // decision — clearing the flag is what makes that true rather than
        // merely stated. Content links are NOT removed: regeneration re-points
        // the occurrence, it does not discard the work attached to it.
        overridden: false,
      },
    });
    await replaceSessionStaff(
      tx,
      sessionId,
      schedule.staff.map((x) => ({ userId: x.userId, position: x.position })),
    );

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.regenerate",
      targetEntity: "Session",
      targetId: sessionId,
      detail: {
        date: session.date.toISOString().slice(0, 10),
        status: session.status,
        // Why it was protected — the thing the administrator was asked to
        // confirm they understood.
        was_protected_for: wasProtectedFor,
        // What this overwrote. After this runs the previous truth exists
        // nowhere else, which is the whole reason the action is audited.
        overwrote: {
          room_id: session.roomId,
          start_time: session.startTime.toISOString(),
          end_time: session.endTime.toISOString(),
          staff: before.map((b) => `${b.position}:${b.userId}`).sort(),
        },
      },
    });
    return updated;
  });
}

/**
 * **Who is expected at this occurrence, and where it happens** (R92).
 *
 * Two facts, deliberately reported separately: the **venue** is the schedule's
 * branch and the occurrence's room; the **audience** is the branch populations
 * expected there. They were one field for as long as an occurrence had one
 * branch, and a combined lesson is exactly the case that separates them.
 */
export async function readSessionRoster(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
): Promise<{
  sessionId: string;
  venue: { branchId: string; branchName: string; roomName: string | null };
  audienceBranches: { id: string; name: string }[];
  overridden: boolean;
  students: { id: string; name: string; branchId: string | null }[];
}> {
  // **Called for its authorization, not its value**: out of scope answers 404
  // through the same guard every other occurrence read uses (§20 rule 17).
  await loadForWrite(prisma, actor, sessionId);

  const spec = await audienceForSession(prisma, sessionId);
  if (spec === null) throw new AppError("NOT_FOUND", "no such session");

  const branchIds =
    spec.audienceBranchIds && spec.audienceBranchIds.length > 0
      ? spec.audienceBranchIds
      : [spec.branchId];

  const [branches, venueRow, students] = await Promise.all([
    prisma.branch.findMany({
      // **`deletedAt` constrained, like every other read** — the trash-coverage
      // guard caught this one, and it is right to: a soft-deleted row must not
      // reappear through a new screen. Safe here rather than merely consistent,
      // because `session_audience_branch` holds a RESTRICT foreign key, so a
      // branch named by an override cannot be deleted at all.
      where: { id: { in: branchIds }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        room: { select: { name: true } },
        schedule: {
          select: { branchId: true, branch: { select: { name: true } } },
        },
      },
    }),
    // **Through the shared resolver**, so the roster cannot disagree with the
    // calendar or the notification list (R92 §B7).
    prisma.user.findMany({
      where: audienceWhere(spec),
      select: {
        id: true,
        nameArabic: true,
        levelEnrollments: {
          where: { deletedAt: null, branchId: { in: branchIds } },
          select: { branchId: true },
          take: 1,
        },
      },
      orderBy: { nameArabic: "asc" },
    }),
  ]);

  return {
    sessionId,
    venue: {
      branchId: venueRow.schedule.branchId,
      branchName: venueRow.schedule.branch.name,
      roomName: venueRow.room?.name ?? null,
    },
    audienceBranches: branches,
    overridden:
      spec.audienceBranchIds !== null && spec.audienceBranchIds !== undefined,
    students: students.map((s) => ({
      id: s.id,
      name: s.nameArabic,
      // Which branch she comes to it from — the fact that makes a combined
      // roster readable rather than a list of names from nowhere.
      branchId: s.levelEnrollments[0]?.branchId ?? null,
    })),
  };
}

/**
 * **Set this occurrence's audience branches** (R92) — or clear the override.
 *
 * **Replacement semantics, stated in one place**: the submitted list *is* the
 * occurrence's audience. An empty list removes the override and the audience
 * returns to the schedule's, which is what «العودة إلى الوضع المعتاد» does.
 *
 * **Only `entire_level`.** In the other two modes the branch is carried by the
 * target itself (§7 — a group IS at one branch), so a branch list has no
 * meaning; R92 §B6 implements the whole-Level case and refuses the rest rather
 * than inventing semantics nobody asked for.
 *
 * **Concurrency is the Session's own `version`** (TD-15) — no second mechanism.
 * The row is bumped inside the same transaction that rewrites the override, so
 * two administrators cannot silently lose one another's change.
 */
export async function setSessionAudienceBranches(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  version: number,
  branchIds: string[],
): Promise<{ branchIds: string[]; overridden: boolean }> {
  const session = await loadForWrite(prisma, actor, sessionId);

  if (session.schedule.teachingMode !== "entire_level") {
    throw new AppError(
      "VALIDATION_FAILED",
      "audience override applies to whole-Level classes",
      {
        reason: "AUDIENCE_OVERRIDE_MODE_UNSUPPORTED",
        teaching_mode: session.schedule.teachingMode,
      },
    );
  }

  const wanted = [...new Set(branchIds)];
  if (wanted.length > 0) {
    const found = await prisma.branch.count({
      where: { id: { in: wanted }, deletedAt: null },
    });
    // Refused rather than silently dropped: an administrator must never plan
    // against a branch the platform did not record.
    if (found !== wanted.length) {
      throw new AppError("VALIDATION_FAILED", "unknown branch", {
        reason: "UNKNOWN_BRANCH",
      });
    }
  }

  return prisma.$transaction(async (tx) => {
    await updateWithVersion<Session>({
      delegate: tx.session,
      id: sessionId,
      expectedVersion: version,
      requireNotDeleted: true,
      // No field changes — the version bump IS the concurrency control, and it
      // is what makes a second administrator's stale write fail rather than
      // overwrite.
      data: {},
    });

    await tx.sessionAudienceBranch.deleteMany({ where: { sessionId } });
    if (wanted.length > 0) {
      await tx.sessionAudienceBranch.createMany({
        data: wanted.map((branchId) => ({ sessionId, branchId })),
      });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: "session.audience",
      targetEntity: "Session",
      targetId: sessionId,
      // *Who decided that both branches attend this lesson* is a question
      // somebody asks later, and the override table itself keeps no history.
      detail: { branch_ids: wanted, cleared: wanted.length === 0 },
    });

    return { branchIds: wanted, overridden: wanted.length > 0 };
  });
}
