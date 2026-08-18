import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { Actor } from '../policies/actor.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import { resolveAudience, type AudienceSpec } from '../policies/roster-resolution.js';

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
 * **Students only.** Not staff, who take the decision; not parents, whose access
 * is §4.3's child context and is not a mailbox of their own in the MVP.
 */

export interface NotificationRow {
  id: string;
  type: 'session_cancelled' | 'session_restored';
  sessionId: string;
  readAt: Date | null;
  createdAt: Date;
  session: {
    date: Date;
    startTime: Date;
    cancellationReason: string | null;
    schedule: { subject: { name: string } | null; level: { name: string } | null };
  };
}

const LIST_INCLUDE = {
  session: {
    select: {
      date: true,
      startTime: true,
      cancellationReason: true,
      schedule: {
        select: { subject: { select: { name: true } }, level: { select: { name: true } } },
      },
    },
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
): Promise<number> {
  const audience = await resolveAudience(tx as unknown as PrismaClient, spec);
  if (audience.length === 0) return 0;
  const created = await tx.notification.createMany({
    data: audience.map((student) => ({
      userId: student.id,
      sessionId,
      type: 'session_cancelled' as const,
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
    where: { sessionId, type: 'session_cancelled', deletedAt: null },
    select: { id: true, userId: true, readAt: true },
  });
  const read = cancelled.filter((n) => n.readAt !== null);
  const unread = cancelled.filter((n) => n.readAt === null);

  if (unread.length > 0) {
    // A hard delete, deliberately: the audit log already holds both the cancel
    // and the restore, so nothing historical is lost, and a soft-deleted notice
    // would keep the list read filtering rows nobody may ever see again.
    await tx.notification.deleteMany({ where: { id: { in: unread.map((n) => n.id) } } });
  }
  if (read.length > 0) {
    await tx.notification.createMany({
      data: read.map((n) => ({
        userId: n.userId,
        sessionId,
        type: 'session_restored' as const,
      })),
      skipDuplicates: true,
    });
    // The corrected notice replaces the one it corrects; leaving both would put
    // two contradictory statements about one class in the same list.
    await tx.notification.deleteMany({ where: { id: { in: read.map((n) => n.id) } } });
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
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    }),
    prisma.notification.count({ where }),
  ]);
  return page(rows as unknown as NotificationRow[], window, total);
}

/** How many the caller has not read — the count the screen shows. */
export async function unreadCount(prisma: PrismaClient, actor: Actor): Promise<number> {
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
    throw new AppError('NOT_FOUND', 'no such notification');
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
