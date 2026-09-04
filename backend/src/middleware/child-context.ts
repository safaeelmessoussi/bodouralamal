import type { NextFunction, Request, Response } from 'express';

import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { NOT_SELF_MANAGED } from '../policies/self-management.js';
import { requireActor } from './authenticate.js';

/**
 * `X-Active-Child-ID` child-context verification (SRS §4.3, TD-12, §20 rule 6).
 *
 * The safeguarding centrepiece of the family model. Minor students are
 * login-less `User` rows, so **every** access path to a minor's data flows
 * through an `Approved` `FamilyLink` — and that link is re-checked on **every
 * request**, never cached in the JWT. §4.3 is explicit that the active child is
 * never a token claim: that is what makes revocation take effect on the very
 * next request.
 *
 * Acting-student resolution, in the order §4.3 mandates:
 *
 *   1. Header present  → the caller is acting as a **Parent**. An `Approved`
 *      `FamilyLink` must match **BOTH** the authenticated parent (JWT `sub`)
 *      **AND** the header's child. Matching the child alone is a vulnerability
 *      (§20 rule 6), so the parent side of the row is part of the query, not an
 *      afterthought.
 *   1b. **R132** — and the child must still BE a minor in §4.3's sense: an
 *      account with no active login identity. A beneficiary who has completed
 *      the self-managed transition answers her own requests, and a former
 *      guardian holding a historical link is refused exactly as any other
 *      non-holder is. The link is kept as evidence; it stops conferring
 *      authority.
 *   2. Header absent + caller holds the `Student` role → the check is bypassed
 *      **entirely**: the acting student is the caller, verified against the JWT
 *      `sub`. An adult student never needs, and never sends, the header.
 *   3. Header absent + caller is Parent-only → `400 VALIDATION_FAILED`. The
 *      request is genuinely ambiguous without a child.
 *
 * The order matters and is normative: a dual-role caller (Student **and**
 * Parent) who sends the header is acting as a parent, so case 1 governs. The
 * bypass must never be reachable by a Parent-only caller.
 *
 * Failure semantics (§4.3, TD-3.8): a header that resolves to no approved
 * (parent, child) link — pending, rejected, soft-deleted, nonexistent, or a link
 * belonging to a **different** parent — is `404 NOT_FOUND`, with **no
 * distinction** between "no such child" and "not your child". Distinguishing
 * them would leak the existence of other families' children. `FAMILY_LINK_PENDING`
 * is deliberately NOT used here: §4.3 and TD-3.8 reserve it for own-resource
 * contexts, because returning link status to a non-owner is exactly the leak the
 * `404` exists to prevent.
 */

export const ACTIVE_CHILD_HEADER = 'x-active-child-id';

/** Every id this system issues is a v4 UUID; anything else cannot name a child. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ActingStudent {
  /** The resolved student id downstream policies and repositories must use. */
  studentId: string;
  /** How it was resolved — `self` means the §4.3 case-2 bypass applied. */
  via: 'self' | 'family_link';
}

declare module 'express-serve-static-core' {
  interface Request {
    actingStudent?: ActingStudent;
  }
}

/**
 * Resolves the acting student for a child-scoped request.
 *
 * Returns the resolved id rather than a boolean so that callers cannot obtain a
 * "yes" and then read a student id from the body or query — §4.3 requires that
 * downstream code receive the *verified* id, and TD-12 forbids trusting a
 * student identifier from the request for authorization purposes.
 */
export async function resolveActingStudent(
  prisma: PrismaClient,
  actor: { userId: string; roles: readonly string[] },
  headerValue: string | undefined,
): Promise<ActingStudent> {
  const raw = headerValue?.trim();

  // ── Case 1: header present → acting as a Parent.
  if (raw) {
    // Shape-check BEFORE querying. Passing a non-UUID straight to Postgres made
    // it raise a cast error (Prisma P2007) that surfaced as a 500 — and a 500
    // for a malformed id versus a 404 for a valid-but-unauthorized one is an
    // observable difference, which is the very leak channel §4.3's uniform 404
    // exists to close. A malformed id is simply one more "nonexistent" case.
    if (!UUID_PATTERN.test(raw)) {
      throw new AppError('NOT_FOUND', 'no such child in this family context');
    }

    const link = await prisma.familyLink.findFirst({
      where: {
        parentId: actor.userId,
        studentId: raw,
        status: 'approved',
        deletedAt: null,
        student: {
          // A link to a soft-deleted child is not a path to that child's data.
          deletedAt: null,
          /**
           * **A SELF-MANAGED adult is not acted for** (R132, corrected by the
           * Owner's durable-authority decision of 2026-09-04).
           *
           * This read *"an account with no active login identity"* — §4.3's
           * structural test for a minor, reused so there would be one
           * definition. The reasoning was right and the fact was wrong:
           * **Option A deliberately deletes `UserIdentity`**, so a self-managed
           * adult who closed her account satisfied that test again and a former
           * guardian's historical link would have come back to life. It did not,
           * but only because the `deletedAt: null` clause above happened to hold
           * — authority surviving by coincidence is authority that will not
           * survive the next change.
           *
           * **Authority and authentication are now different facts.** An
           * approved `SelfManagedClaim` is durable: it survives identity
           * removal, logout, account closure and any later re-binding.
           *
           * **The link row is NOT deleted.** It is historical relationship
           * evidence; what ends is the CURRENT authority it conferred.
           */
          ...NOT_SELF_MANAGED,
        },
      },
      select: { studentId: true },
    });

    if (!link) {
      // Identical answer for every failure mode: pending, rejected, revoked,
      // nonexistent, or another parent's child (§4.3 — no existence leaks).
      throw new AppError('NOT_FOUND', 'no such child in this family context');
    }

    return { studentId: link.studentId, via: 'family_link' };
  }

  // ── Case 2: no header + Student role → the caller acts on their own data.
  if (actor.roles.includes('student')) {
    return { studentId: actor.userId, via: 'self' };
  }

  // ── Case 3: no header + Parent-only → ambiguous request.
  throw new AppError(
    'VALIDATION_FAILED',
    'X-Active-Child-ID is required on child-scoped requests for this caller (§4.3)',
  );
}

/**
 * Express middleware form. Mount on **student-context** endpoints only — those
 * where the caller acts on their own or their child's data.
 *
 * Staff access to a minor's record is a **different** authorization path (§4.3:
 * "through an approved `FamilyLink` **or through staff roles**"), resolved by
 * TD-2 plus `GroupTeacher` scoping. A staff-scoped endpoint must therefore not
 * mount this middleware, or a Teacher with legitimate group access would be
 * asked for a child header they have no reason to send.
 */
export function childContext(prisma: PrismaClient) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor = requireActor(req);
      req.actingStudent = await resolveActingStudent(
        prisma,
        { userId: actor.userId, roles: actor.roles },
        req.header(ACTIVE_CHILD_HEADER) ?? undefined,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Reads the resolved acting student, throwing if the middleware never ran.
 *
 * A handler that silently fell back to a body or query parameter here would
 * reintroduce precisely the vulnerability §20 rule 6 names, so the absence of a
 * resolution is a programming error rather than a request the handler may
 * interpret generously.
 */
export function requireActingStudent(req: Request): ActingStudent {
  const acting = req.actingStudent;
  if (!acting) {
    throw new Error('childContext middleware did not run for a child-scoped route (§4.3)');
  }
  return acting;
}
