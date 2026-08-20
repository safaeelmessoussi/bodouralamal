import type { OnlineMediaMode, PrismaClient } from "../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import { publicDisplayName } from "../lib/display-name.js";
import type {
  JoinCredentials,
  OnlineClassProvider,
} from "../lib/online-class-provider.js";
import type { Actor } from "../policies/actor.js";
import * as scope from "../policies/branch-scope.js";
import { assertFreshActive } from "../policies/freshness.policy.js";
import {
  grantsFor,
  joinWindowFor,
  roomNameForSession,
  tokenSecondsFor,
  windowState,
  type ParticipantRole,
} from "../policies/online-class.js";
import {
  audienceForSession,
  audienceWhere,
  staffsSession,
} from "../policies/roster-resolution.js";
import { resolveActingStudent } from "../middleware/child-context.js";

/**
 * **Joining an online class (SRS Revision 98, §4.4c, §4.3).**
 *
 * The rule this whole module exists to hold, stated once:
 *
 * > **بذور الأمل authorizes; the media provider executes the media session.**
 *
 * Authorization runs to completion **before** a token exists, and it runs
 * against the platform's own canonical resolvers — R92's `audienceForSession`
 * for a beneficiary, R91's `staffsSession` for a مؤطِّرة, §4.3's approved
 * `FamilyLink` for a guardian, and TD-2's branch scope for an administrator.
 * **None of them is re-implemented here**; a second audience query is the
 * failure R92 names in terms.
 *
 * The inverse direction is never taken: the provider is never asked who is in a
 * room, whether a room exists, or what a participant may do. It is told.
 *
 * ## What the client may say, and what it may not
 *
 * The request carries **the Session id and nothing else**. Participant identity,
 * display name, room, role, grants and expiry are all derived here. A caller
 * who could name their own identity could enter as somebody else; a caller who
 * could name their own grants could arrive as a moderator. Both are refused by
 * the contract's shape rather than by validation, which is why
 * `onlineJoinSchema` is an empty `.strict()` object.
 */

/** Who this person is in this room, and what the room is. */
export interface JoinAuthorization {
  sessionId: string;
  room: string;
  /** The **acting person's** id — a guardian acting for a child gets the
   *  child's, never her own (R98.7). */
  identity: string;
  displayName: string;
  role: ParticipantRole;
  mediaMode: OnlineMediaMode;
  opensAt: Date;
  closesAt: Date;
}

export interface JoinResult extends JoinCredentials {
  authorization: JoinAuthorization;
}

/**
 * **Authorization, complete, with no provider involved.**
 *
 * Separated from token minting so the whole decision is testable without a
 * media platform, and so the one place that could be tempted to consult the
 * provider demonstrably cannot: it has no reference to one.
 */
export async function authorizeJoin(
  prisma: PrismaClient,
  actor: Actor,
  sessionId: string,
  activeChildHeader: string | undefined,
  now: Date = new Date(),
): Promise<JoinAuthorization> {
  /**
   * **TD-12 freshness, and this endpoint earns it.**
   *
   * Entering a room with minors is precisely the kind of operation TD-12 says
   * an unexpired token is not sufficient for: a مؤطِّرة suspended this morning
   * must not walk into this afternoon's class on a token minted before. Roles
   * and scopes are rebuilt from live rows and the token's are discarded.
   */
  const fresh = await assertFreshActive(
    prisma,
    actor.userId,
    ["super_admin", "admin", "teacher", "student", "parent"],
    actor.activeRole,
  );

  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      deliveryMode: true,
      onlineMediaMode: true,
      schedule: { select: { branchId: true, deletedAt: true } },
    },
  });
  // §20 rule 17 — out of reach and non-existent are one answer.
  if (!session || session.schedule.deletedAt !== null) {
    throw new AppError("NOT_FOUND", "no such session");
  }

  /**
   * **Only an online occurrence can be joined** (R98.4).
   *
   * Checked before authorization deliberately: *this class is not online* is
   * true for everybody and leaks nothing, and answering it first keeps the
   * message an administrator sees honest instead of a generic refusal.
   */
  if (session.deliveryMode !== "online" || session.onlineMediaMode === null) {
    throw new AppError(
      "STATE_CONFLICT",
      "this occurrence is delivered in person",
      { reason: "NOT_ONLINE" },
    );
  }
  if (session.status === "cancelled") {
    throw new AppError("STATE_CONFLICT", "this occurrence is cancelled", {
      reason: "CANCELLED",
    });
  }

  const participant = await resolveParticipant(
    prisma,
    fresh,
    session.id,
    session.schedule.branchId,
    activeChildHeader,
  );

  /**
   * **The window is checked LAST, after authorization succeeded.**
   *
   * The order is a disclosure decision: *«الحصة لم تبدأ بعد»* tells the reader
   * when a class they are entitled to attend begins, and telling that to
   * somebody who is **not** entitled would confirm the occurrence exists and
   * when it runs. An unauthorised caller gets `404` and learns nothing about
   * the timetable.
   */
  const window = joinWindowFor(session);
  const state = windowState(window, now);
  if (state !== "open") {
    throw new AppError(
      "STATE_CONFLICT",
      state === "too_early"
        ? "the join window has not opened yet"
        : "the join window has closed",
      {
        reason: state === "too_early" ? "BEFORE_WINDOW" : "AFTER_WINDOW",
        opens_at: window.opensAt.toISOString(),
        closes_at: window.closesAt.toISOString(),
      },
    );
  }

  return {
    sessionId: session.id,
    room: roomNameForSession(session.id),
    identity: participant.identity,
    displayName: participant.displayName,
    role: participant.role,
    mediaMode: session.onlineMediaMode,
    opensAt: window.opensAt,
    closesAt: window.closesAt,
  };
}

/**
 * **Authorize, then mint.** The provider is reached only on the last line, and
 * only with values this platform decided.
 *
 * Idempotent by construction (R98.17): the room name is derived, no row is
 * written, and a refresh produces another short-lived token for the same person
 * in the same room. **Nothing is persisted by joining** — attendance is §4.7 and
 * is still not built, and a media platform's participant list is not it.
 */
export async function joinOnlineClass(
  prisma: PrismaClient,
  provider: OnlineClassProvider | null,
  actor: Actor,
  sessionId: string,
  activeChildHeader: string | undefined,
  now: Date = new Date(),
): Promise<JoinResult> {
  const authorization = await authorizeJoin(
    prisma,
    actor,
    sessionId,
    activeChildHeader,
    now,
  );

  if (provider === null) {
    // The operator's problem, said in the operator's terms (TD-3.8 `details`)
    // rather than as "try again later" — the failure this project has already
    // had once with an unset platform setting.
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "the online-class provider is not configured",
      { settings: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] },
    );
  }

  const window = {
    opensAt: authorization.opensAt,
    closesAt: authorization.closesAt,
  };
  const credentials = await provider.issueJoinCredentials({
    room: authorization.room,
    identity: authorization.identity,
    displayName: authorization.displayName,
    grants: grantsFor(authorization.role, authorization.mediaMode),
    ttlSeconds: tokenSecondsFor(window, now),
  });

  return { ...credentials, authorization };
}

/* ───────────────────────────── who is asking ───────────────────────────── */

interface Participant {
  identity: string;
  displayName: string;
  role: ParticipantRole;
}

/**
 * The three doors into a classroom, in precedence order — **staff, then
 * administration, then the beneficiary side**.
 *
 * Order matters for a dual-role account: a مؤطِّرة who is also a parent opens
 * the class she teaches as its مؤطِّرة, not as somebody's guardian. R60's active
 * role has already narrowed `fresh.roles` when the session declares one, so a
 * Super Administrator working as مؤطِّرة is resolved as a مؤطِّرة here.
 */
async function resolveParticipant(
  prisma: PrismaClient,
  fresh: { userId: string; roles: string[]; roleScopes: scope.RoleScope[] },
  sessionId: string,
  branchId: string,
  activeChildHeader: string | undefined,
): Promise<Participant> {
  /**
   * **Teaching staff — R91's effective assignment, through the canonical
   * resolver.**
   *
   * `staffsSession` is `SessionStaff` first (the occurrence's own snapshot,
   * which is where a one-off cover lives) and then the schedule's assignments
   * **effective on this occurrence's date**. So an expired مؤطِّرة is refused,
   * one whose period has not begun is refused, and a cover for this Thursday
   * gets in on this Thursday and no other.
   *
   * **R88 declared capability is not consulted, here or anywhere.** *«I can
   * teach Quran»* is planning data; it staffs nothing and therefore opens
   * nothing.
   */
  if (fresh.roles.includes("teacher")) {
    if (await staffsSession(prisma, fresh.userId, sessionId)) {
      const position = await prisma.sessionStaff.findFirst({
        where: { sessionId, userId: fresh.userId, deletedAt: null },
        select: { position: true },
      });
      return {
        ...(await person(prisma, fresh.userId)),
        // Display and audit only — `grantsFor` gives both positions identical
        // authority (R87 §G).
        role: position?.position === "assistant" ? "assistant" : "teacher",
      };
    }
    // Falls through: a مؤطِّرة may also be an administrator, or a parent of a
    // beneficiary in this very class.
  }

  /**
   * **Administration — the SAME authority that already edits this occurrence.**
   *
   * `session.service.loadForWrite` admits an administrator scoped to the
   * schedule's branch and refuses one who is not; joining is not a wider power
   * than rescheduling or cancelling, so it reuses that rule rather than
   * inventing *«admin ⇒ every room»*, which is nowhere normative.
   */
  const isAdmin =
    scope.hasRole(fresh.roleScopes, "admin") ||
    scope.isSuperAdmin(fresh.roleScopes);
  if (isAdmin && scope.canActOnBranch(fresh.roleScopes, "admin", branchId)) {
    return { ...(await person(prisma, fresh.userId)), role: "admin" };
  }

  /**
   * **The beneficiary side — §4.3 decides WHO, R92 decides WHETHER.**
   *
   * A guardian acting for a linked child resolves to **the child**: the token
   * carries the child's identity and the child's name, and the guardian's own
   * `User` never enters the room in her place. She gains no student role by it —
   * the authority is the approved `FamilyLink`, re-read on this request, and a
   * revoked link or a forged child id is `404` from the shared resolver.
   */
  if (fresh.roles.includes("student") || fresh.roles.includes("parent")) {
    const acting = await resolveActingStudent(
      prisma,
      { userId: fresh.userId, roles: fresh.roles },
      activeChildHeader,
    );

    const spec = await audienceForSession(prisma, sessionId);
    if (spec === null) throw new AppError("NOT_FOUND", "no such session");

    /**
     * **One query, composed from the canonical `where`** — never a second
     * audience implementation, and never a materialised list of ids compared
     * afterwards. Whole-Level scope, Administrative-Group scope, Teaching-Circle
     * scope and R92's cross-branch override are all already inside it, so this
     * arm is correct for all four without naming any of them.
     */
    const inAudience = await prisma.user.count({
      where: {
        // `audienceWhere` already constrains it, and it is restated here on
        // purpose: the soft-delete guard reads the literal `where` at each call
        // site, and a composed predicate is invisible to it. Restating a
        // guaranteed condition is cheaper than a guard that cannot see the
        // property it exists for.
        deletedAt: null,
        AND: [{ id: acting.studentId }, audienceWhere(spec)],
      },
    });
    if (inAudience > 0) {
      return { ...(await person(prisma, acting.studentId)), role: "student" };
    }
  }

  throw new AppError("NOT_FOUND", "no such session");
}

/**
 * The participant's identity and the name others see.
 *
 * **Identity is the internal `User.id`** — stable, opaque, and already the
 * platform's answer to *who is this person*. Never an email, a phone number or a
 * QR reference: the first two are personal data the provider has no business
 * holding, and the third is a lookup key, not a credential (R96).
 *
 * The name is `publicDisplayName` — the same single answer every public surface
 * uses (§20 rule 21, R36.1) — and it is **presentation**: the provider shows it,
 * and nothing anywhere is decided from it.
 */
async function person(
  prisma: PrismaClient,
  userId: string,
): Promise<{ identity: string; displayName: string }> {
  const row = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, nameArabic: true, publicDisplayName: true },
  });
  if (!row) throw new AppError("NOT_FOUND", "no such session");
  return { identity: row.id, displayName: publicDisplayName(row) };
}
