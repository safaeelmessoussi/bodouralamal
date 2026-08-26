import type { Prisma } from "../generated/prisma/client.js";
import * as scope from "./branch-scope.js";
import type { RoleScope } from "./branch-scope.js";

/**
 * **SRS Revision 109 — the three-tier visibility model, for all three kinds of
 * scheduling item.**
 *
 * ## What changed, and what deliberately did not
 *
 * Before this revision only an `Event` carried a tier. A حصة was public to the
 * world because §4.4 (Revision 43) said *"Sessions are PUBLIC — anonymous
 * visitors browse the timetable"*, and an امتحان had no tier at all because
 * §4.6 said it *"appears to the audience that can see the level it belongs
 * to"* — which is a statement about **audience**, not about **publication**.
 * The association could therefore announce a celebration and not a class, and
 * could not arrange a sitting quietly at all.
 *
 * R109 gives حصة and امتحان a tier of their own and **narrows `hidden`**. The
 * `public` and `private` tiers are §4.4's, unchanged and re-used rather than
 * restated:
 *
 * | tier | who reads it |
 * |---|---|
 * | `public` | everyone, including an unauthenticated visitor |
 * | `private` | any approved account; **staff bounded by their branch scope** |
 * | `hidden` | **the responsible person, and Super Admins. Nobody else.** |
 *
 * ## `hidden` is now OWNERSHIP, not scope
 *
 * §4.4's `hidden` read *"Teachers whose scope intersects … and **all Admins
 * regardless of branch scope**"*. R109 replaces both arms with one: the person
 * who answers for the item, plus Super Admin. **This REMOVES access somebody
 * has today** — every Admin currently sees every hidden Event in the platform —
 * and that narrowing is the Owner's decision rather than a side effect.
 *
 * Who "the responsible person" is, is a fact each kind already records:
 *
 * | kind | responsible | dated? |
 * |---|---|---|
 * | نشاط `Event` | `EventStaff.position = 'responsible'` (R71.3) | no |
 * | حصة `Session` | `SessionStaff.position = 'teacher'` | **yes — see below** |
 * | امتحان `Exam` | `ExamStaff.position = 'supervisor'` | no |
 *
 * ## The one that is dated: ONE MAIN TEACHER PER DATE, NOT PER SERIES
 *
 * R91 withdrew `@@unique([scheduleId, userId])`, so one schedule may hold
 * several `position = 'teacher'` rows with different effective periods — Safa
 * until November, Amina in December, Safa again in January. *"At most one main
 * on any given DATE"* is an enforced invariant
 * (`OVERLAPPING_MAIN_TEACHER`); *"one main for the series"* is not true at all.
 *
 * So a hidden occurrence's owner must be resolved **on that occurrence's own
 * date**. Resolving it as of *now* would strip a replaced مؤطِّرة of the very
 * occurrences she taught and hand her ones she did not — the exact defect
 * caught in R106's exam scope, written down here rather than rediscovered.
 *
 * **`SessionStaff` is how that resolution is spelled, and it is not a
 * shortcut.** The snapshot is written by `session.materialize` from
 * `staffOn(schedule.staff, date)` — i.e. from `CourseScheduleStaff` effective on
 * that occurrence's own date (R43.4, R91) — so the ratified rule holds by
 * construction. Where the two can differ at all is a past, overridden or
 * otherwise protected occurrence, and there the snapshot is *the correct
 * answer*: R91 states it in terms — **"schedule staffing answers who is
 * assigned for this period; `SessionStaff` answers who took this class."**
 *
 * It is also the only form expressible as a query filter. Correlating a parent
 * row's `date` column against a related row's effective range is not something
 * Prisma's `where` can say, so the alternative would have been to materialise
 * ids per request — a snapshot of a set that can change between resolving it
 * and using it, which `roster-resolution` refuses for exactly this reason.
 *
 * ## An assistant does NOT read a hidden item
 *
 * R87 §G — *"an assistant IS the main teacher for operational authorization"* —
 * is about acting on a class she staffs: attendance, memorisation, the roster.
 * `hidden` is not an operation on the class; it is **who the item belongs to**,
 * and the Owner named the responsible position explicitly for each kind. The
 * asymmetry is deliberate and matches `EventStaff`'s, which R71.3 already draws
 * between *both positions see* and *only `responsible` may edit*.
 *
 * ## Where these filters apply — and where they must not
 *
 * These gate **reading the calendar and the public occurrence surfaces**. §4.4
 * titles the model *"Three-Tier Calendar Event Visibility"*, and that is its
 * scope: `GET /calendar`, `GET /me/calendar`, the §5.2 session page, and the
 * sessions a content item is used by.
 *
 * They are **not** applied to the management lists — `GET /admin/events`,
 * `/admin/course-schedules`, `/admin/exams` — which are governed by role plus
 * branch scope as they always have been, and **no exception is made for any of
 * them.**
 *
 * That boundary is a decision and not an oversight. `hidden` is a
 * **publication** tier, not an administration one: an Admin who could no longer
 * see a hidden class in the management list could no longer un-hide it, so
 * applying the tier there would make hidden items *unadministrable* rather than
 * confidential — and the person left unable to fix a mistake would be the only
 * person able to fix it. Who may reach a management list at all is TD-2's
 * question and is unchanged; R109 decides only who may READ the item on a
 * calendar.
 */

/** The minimum a tier decision needs. `CalendarActor` and `Actor` both satisfy
 *  it, so no caller converts anything. */
export interface TierActor {
  userId: string;
  roleScopes: RoleScope[];
  accountStatus: string;
}

const isSuperAdmin = (a: TierActor) => scope.isSuperAdmin(a.roleScopes);
const isAdmin = (a: TierActor) =>
  scope.hasRole(a.roleScopes, "admin") || isSuperAdmin(a);
const isTeacher = (a: TierActor) => scope.hasRole(a.roleScopes, "teacher");

/**
 * **Nothing but the public tier**, for an anonymous visitor or an account that
 * is not yet approved.
 *
 * A `Pending` user is exactly an anonymous visitor here (§4.4, TD-1): the
 * account exists and grants nothing.
 */
const publicOnly = <T>(): T => ({ visibility: "public" }) as T;

/** Whether this caller reads at the public tier alone. */
export function readsPublicTierOnly(actor: TierActor | null): boolean {
  return actor === null || actor.accountStatus !== "active";
}

/**
 * **Which branches bound this caller's `private` tier**, or `null` for *all of
 * them*.
 *
 * §4.4(2) — *"and to Staff **within their branch scope**"*. The platform's
 * definition of a staff member's branch scope is `UserBranchRole`
 * (`branch-scope.ts`), which is a fact the actor already carries: no query, and
 * — the point — **no date**, so this cannot repeat R106's as-of-today defect.
 */
function privateBranches(actor: TierActor): string[] | null {
  return scope.reachableBranches(
    actor.roleScopes,
    isAdmin(actor) ? ["admin"] : ["teacher"],
  );
}

/* ── حصة — a materialized class occurrence ──────────────────────────────── */

export function sessionTierWhere(
  actor: TierActor | null,
): Prisma.SessionWhereInput {
  if (readsPublicTierOnly(actor)) return publicOnly<Prisma.SessionWhereInput>();
  const a = actor as TierActor;
  if (isSuperAdmin(a)) return {};

  /**
   * **The occurrence's own responsible teacher, on its own date.** See the
   * module note: `SessionStaff` IS `CourseScheduleStaff` effective on this
   * date, materialized.
   */
  const responsible: Prisma.SessionWhereInput = {
    visibility: "hidden",
    staff: {
      some: { userId: a.userId, position: "teacher", deletedAt: null },
    },
  };

  if (isAdmin(a) || isTeacher(a)) {
    const branches = privateBranches(a);
    return {
      OR: [
        { visibility: "public" },
        branches === null
          ? { visibility: "private" }
          : {
              visibility: "private",
              schedule: { branchId: { in: branches } },
            },
        responsible,
      ],
    };
  }

  // Approved Student or Parent: public and private, never hidden. Private is
  // deliberately unfiltered by branch or group (§4.4, Risk R-6) — the same
  // accepted trade-off an Event's private tier already makes.
  return { OR: [{ visibility: "public" }, { visibility: "private" }] };
}

/* ── امتحان — one dated sitting ─────────────────────────────────────────── */

export function examTierWhere(actor: TierActor | null): Prisma.ExamWhereInput {
  if (readsPublicTierOnly(actor)) return publicOnly<Prisma.ExamWhereInput>();
  const a = actor as TierActor;
  if (isSuperAdmin(a)) return {};

  const responsible: Prisma.ExamWhereInput = {
    visibility: "hidden",
    staff: {
      some: { userId: a.userId, position: "supervisor", deletedAt: null },
    },
  };

  if (isAdmin(a) || isTeacher(a)) {
    const branches = privateBranches(a);
    return {
      OR: [
        { visibility: "public" },
        branches === null
          ? { visibility: "private" }
          : {
              visibility: "private",
              // A branchless exam belongs to every branch rather than to none —
              // the same reading `EventBranch`'s empty set already gets (§4.4).
              OR: [{ branchId: { in: branches } }, { branchId: null }],
            },
        responsible,
      ],
    };
  }

  return { OR: [{ visibility: "public" }, { visibility: "private" }] };
}

/* ── نشاط — the Event layer ─────────────────────────────────────────────── */

/**
 * **The `hidden` arm, and ONLY the hidden arm, is R109's.**
 *
 * `private` for an Event keeps the scope intersection §4.4 gave it and this
 * module deliberately does not touch: an Event states its audience through four
 * explicit scope joins, and R109 superseded one clause of §4.4 rather than the
 * section.
 */
export function eventResponsibleWhere(
  actor: TierActor,
): Prisma.EventWhereInput {
  return {
    visibility: "hidden",
    staff: {
      some: { userId: actor.userId, position: "responsible", deletedAt: null },
    },
  };
}
