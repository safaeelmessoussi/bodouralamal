import type { PrismaClient } from '../generated/prisma/client.js';
import { issueAccessToken, issueAccessTokenWithExpiryCap } from '../lib/access-token.js';
import { AppError } from '../lib/errors.js';
import { postLoginDestination } from '../lib/role-home.js';
import { narrowToRole } from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import type { Db } from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';
import type { ResolvedAccount } from '../repositories/user.repository.js';
import {
  issueNewSession,
  refreshAccessSession,
  type IssuedRefreshToken,
} from './refresh-token.service.js';

/**
 * Login resolution and routing (SRS §4.1b steps 3–4, TD-1, TD-4.10).
 *
 * The whole security posture of the platform starts here, so the order of
 * operations is the SRS's, verbatim, and each branch names its clause.
 */

export type LoginRoute =
  /** 4a/4b with `Active` — role dashboard. */
  | { kind: 'active'; account: ResolvedAccount; boundNow: boolean }
  /** 4a/4b with `Pending` — approval-status screen, ZERO data access (TD-1). */
  | { kind: 'pending'; account: ResolvedAccount; boundNow: boolean }
  /**
   * Rejected, Suspended, or soft-deleted → the "Account deactivated" screen
   * (§4.1b 4a as completed in Revision 16). Authenticating NEVER reactivates.
   */
  | { kind: 'deactivated'; reason: 'rejected' | 'suspended' | 'deleted' }
  /** 4c — brand-new person: issue an onboarding token and send them to the form. */
  | { kind: 'onboarding' };

export type FinalizedLogin =
  | { kind: 'deactivated'; reason: 'rejected' | 'suspended' | 'deleted' }
  | {
      kind: 'active' | 'pending';
      account: ResolvedAccount;
      accessToken: string;
      refreshSession: IssuedRefreshToken;
    };

/**
 * Applies the §4.1b step-4a routing condition **in full**: status alone is not
 * enough, because a soft-delete sets `deleted_at` without necessarily moving
 * `account_status` — routing on status alone would hand a deleted user a
 * dashboard (Revision 16).
 */
function routeByStatus(account: ResolvedAccount, boundNow: boolean): LoginRoute {
  if (account.user.deletedAt !== null) return { kind: 'deactivated', reason: 'deleted' };
  switch (account.user.accountStatus) {
    case 'active':
      return { kind: 'active', account, boundNow };
    case 'pending':
      return { kind: 'pending', account, boundNow };
    case 'rejected':
      return { kind: 'deactivated', reason: 'rejected' };
    case 'suspended':
      return { kind: 'deactivated', reason: 'suspended' };
  }
}

/**
 * §4.1b steps 3–4. Resolution order is fixed: the provider identity first
 * (every login after the first takes that path), then the pre-provisioned
 * email fallback among non-deleted users, then onboarding.
 *
 * Binding (4b) runs in a transaction with its audit row (TD-4.10). Two
 * concurrent first logins resolve first-wins on the `(provider,
 * provider_subject_id)` unique constraint; the loser re-reads and finds the
 * account already bound (TD-15.3).
 */
export async function resolveLogin(
  prisma: PrismaClient,
  identity: { email: string; providerSubjectId: string },
): Promise<LoginRoute> {
  // TD-12: every lookup runs against the lowercased email.
  const email = identity.email.toLowerCase();

  // ── Step 3.1 — the provider identity.
  const bound = await users.findByProviderIdentity(prisma, 'google', identity.providerSubjectId);
  if (bound) {
    // A deactivated identity (TD-5 user soft-delete) resolves to the
    // deactivated screen, NOT to onboarding: §4.1 forbids silently
    // re-registering a deleted account, and falling through would do exactly
    // that. The identity is found and refused, rather than not found.
    const route = bound.identityActive
      ? routeByStatus(bound, false)
      : ({ kind: 'deactivated', reason: 'deleted' } as const);
    if (route.kind === 'deactivated') await writeLoginAudit(prisma, route, bound.user.id);
    return route;
  }

  // ── Step 3.2 — pre-provisioned account awaiting its first binding.
  const preProvisioned = await users.findByPreProvisionedEmail(prisma, email);
  if (!preProvisioned) return { kind: 'onboarding' }; // Step 4c.

  // A Suspended/deleted match routes to "Account deactivated" and is NEVER
  // bound or reactivated by the act of logging in (§4.1, §4.1b 4b).
  const preRoute = routeByStatus(preProvisioned, false);
  if (preRoute.kind === 'deactivated') {
    await writeLoginAudit(prisma, preRoute, preProvisioned.user.id);
    return preRoute;
  }

  // ── Step 4b — bind transactionally with the authoritative User state
  // (TD-4.10). The pre-provision lookup above is discovery, not authority: a
  // suspension may commit between it and this transaction.
  try {
    return await prisma.$transaction(async (tx): Promise<LoginRoute> => {
      // Email ownership is the outer lock for every writer. It closes the race
      // with a stale onboarding token while the User lock below continues to
      // serialize binding against suspension and rejection.
      await users.lockNormalizedEmail(tx, email);
      if (!(await users.lockUser(tx, preProvisioned.user.id))) {
        return { kind: 'deactivated', reason: 'deleted' };
      }
      const current = await users.findAccountById(tx, preProvisioned.user.id);
      if (!current) return { kind: 'deactivated', reason: 'deleted' };

      const claimingUsers = await users.emailClaimingUserIds(tx, email);
      if (
        claimingUsers.length !== 1 ||
        claimingUsers[0] !== current.user.id
      ) {
        throw new AppError('DUPLICATE', 'email ownership changed before identity binding', {
          reason: 'EMAIL_ALREADY_CLAIMED',
        });
      }

      const currentRoute = routeByStatus(current, false);
      if (currentRoute.kind === 'deactivated') {
        await writeLoginAudit(tx, currentRoute, current.user.id);
        return currentRoute;
      }

      await users.bindIdentity(tx, {
        userId: current.user.id,
        provider: 'google',
        providerSubjectId: identity.providerSubjectId,
        email,
      });
      /**
       * **R68 / §4.3 (R62.9) — a minor has just become a person with a login.**
       *
       * If this account has approved parent links, someone has been acting for
       * them and now they can act for themselves. §4.3 is explicit that the
       * links are **not revoked automatically**: a non-blocking review item is
       * raised and an administrator decides.
       *
       * **Non-blocking is enforced here, not promised.** This is an
       * `updateMany` over rows that may well be empty; it reads nothing, it
       * refuses nothing, and no outcome of it can stop the login. The links go
       * on working while the stamp is set.
       *
       * Inside the binding transaction so the marker and the identity commit
       * together — a login that succeeded while the review was lost is exactly
       * the silent state this exists to prevent.
       */
      const raised = await tx.familyLink.updateMany({
        where: {
          studentId: current.user.id,
          status: 'approved',
          deletedAt: null,
          // Idempotent: a re-entry after a partial failure re-stamps nothing,
          // and an administrator's decision is never quietly undone.
          identityReviewRaisedAt: null,
        },
        data: { identityReviewRaisedAt: new Date() },
      });

      await audit.write(tx, {
        actorUserId: current.user.id,
        actionType: audit.AUDIT_ACTIONS.identityBound,
        targetEntity: 'User',
        targetId: current.user.id,
        // `pre_provisioned_email` is retained, not cleared (§7), so the
        // provenance of how this account was created survives the binding.
        detail: {
          provider: 'google',
          matched_by: 'pre_provisioned_email',
          // Named on the binding row itself: *this* is the moment the review
          // became necessary, and the trail should say so where it happened.
          ...(raised.count > 0 ? { family_links_flagged_for_review: raised.count } : {}),
        },
      });
      return routeByStatus(current, true);
    });
  } catch (error) {
    // Lost the race to a concurrent first login: re-read and continue as 4a.
    if ((error as { code?: unknown } | null)?.code === 'P2002') {
      const nowBound = await users.findByProviderIdentity(
        prisma,
        'google',
        identity.providerSubjectId,
      );
      if (nowBound) {
        const route = routeByStatus(nowBound, false);
        if (route.kind === 'deactivated') await writeLoginAudit(prisma, route, nowBound.user.id);
        return route;
      }
    }
    throw error;
  }
}

/**
 * Final authority boundary for a successful Google login.
 *
 * Resolution and first-login identity binding may have happened earlier, but
 * neither snapshot is allowed to mint credentials. The stable User row
 * serializes this transaction with suspension/user-wide revocation; account
 * status and roles are then re-read under that lock. The refresh anchor/token
 * and successful-login audit commit together, and the access token is returned
 * only after that commit succeeds.
 */
export async function finalizeLoginSession(
  prisma: PrismaClient,
  params: { userId: string; boundNow: boolean; signingKey: string },
): Promise<FinalizedLogin> {
  return prisma.$transaction(async (tx): Promise<FinalizedLogin> => {
    if (!(await users.lockUser(tx, params.userId))) {
      return { kind: 'deactivated', reason: 'deleted' };
    }

    const account = await users.findAccountById(tx, params.userId);
    if (!account) return { kind: 'deactivated', reason: 'deleted' };

    const route = routeByStatus(account, params.boundNow);
    if (route.kind === 'deactivated') {
      await writeLoginAudit(tx, route, account.user.id);
      return route;
    }
    if (route.kind === 'onboarding') {
      // `routeByStatus` cannot produce this branch; keeping the exhaustiveness
      // guard local prevents a future route addition from minting credentials.
      return { kind: 'deactivated', reason: 'deleted' };
    }

    const issued = issueAccessToken(
      {
        userId: account.user.id,
        roleScopes: account.roleScopes,
        accountStatus: account.user.accountStatus,
      },
      params.signingKey,
    );
    const refreshSession = await issueNewSession(tx, account.user.id);
    await writeLoginAudit(tx, route, account.user.id);

    return {
      kind: route.kind,
      account,
      accessToken: issued.token,
      refreshSession,
    };
  });
}

export type ExistingSessionRoute =
  /** No live refresh session under the presented cookie — proceed with the
   *  ordinary Google OAuth flow. */
  | { kind: 'none' }
  /** A live session already exists; send the browser straight to its
   *  destination and never contact Google. */
  | { kind: 'redirect'; destination: string; rotatedRefresh: { rawToken: string } | null };

/**
 * **`GET /auth/google` while already signed in never reaches Google.**
 *
 * A person who clicks or navigates to a login entry point with a live session
 * cookie is not starting a new login — she already has one, and re-running
 * OAuth would ask her to pick a Google account for an identity binding that is
 * already settled, or worse, invite a SECOND identity to be bound. §4.1b's
 * "role-based dashboard redirect" is what a completed login produces; this is
 * that same redirect, reached without a Google round trip because the
 * round trip already happened.
 *
 * **Reuses `refreshAccessSession` rather than a second validity check.** That
 * function is the platform's one answer to *"is this refresh cookie live, and
 * for whom"* — rotation, the grace window, and reuse detection all apply
 * identically here, because a forged/stale/replayed cookie presented at the
 * login DOOR is exactly as dangerous as one presented at the refresh endpoint,
 * and a second implementation of that check is a second place for it to drift.
 * `rejected`/`reuse_detected` both mean *no live session*, so the caller falls
 * through to the ordinary anonymous OAuth flow — including the case where the
 * detected replay revokes the whole chain: the visitor still reaches Google
 * and can sign back in normally afterward.
 *
 * **The destination is read from LIVE rows, not the token** (the same
 * discipline `switchActiveRole` states): `refreshAccessSession` only proves
 * the account is `active` or `pending` (TD-1) and returns no more than that,
 * so this makes one further read of the authoritative account to learn WHICH
 * of the two, and its role scopes, before naming a path — a Pending caller
 * goes to `/pending-approval`, exactly as a fresh callback login does, never
 * to a dashboard she cannot use.
 *
 * **Mints no new OAuth/PKCE flow state and binds no identity.** The only
 * possible mutation is the SAME refresh-token rotation `POST /auth/refresh`
 * already performs on every ordinary page load; declining to forward a
 * `rotated` outcome's new cookie would leave the browser holding a dead
 * value, so the caller MUST set it exactly as `/auth/refresh` does.
 */
export async function resolveExistingSession(
  prisma: PrismaClient,
  params: { presentedRaw: string; signingKey: string },
): Promise<ExistingSessionRoute> {
  const outcome = await refreshAccessSession(prisma, {
    presentedRaw: params.presentedRaw,
    signingKey: params.signingKey,
  });
  if (outcome.kind === 'rejected' || outcome.kind === 'reuse_detected') {
    return { kind: 'none' };
  }

  const account = await users.findAccountById(prisma, outcome.userId);
  // Essentially unreachable — `refreshAccessSession` re-checked this account
  // moments earlier inside its own transaction — but a caller with no account
  // to route has no business being told it is signed in.
  if (!account) return { kind: 'none' };

  const destination =
    account.user.accountStatus === 'pending'
      ? '/pending-approval'
      : postLoginDestination(account.roleScopes.map((scope) => scope.role));

  return {
    kind: 'redirect',
    destination,
    rotatedRefresh: outcome.kind === 'rotated' ? { rawToken: outcome.rawToken } : null,
  };
}

export interface SwitchedRole {
  accessToken: string;
  accessExpiresAt: Date;
  activeRole: string;
}

/**
 * R60 role switching changes authority, never authentication lifetime.
 *
 * The User governing lock serializes this credential decision with suspension,
 * deletion and final login issuance. Account status and assignments are read
 * only after that lock. The replacement JWT is capped at the verified bearer's
 * original `exp`, so neither logout nor an absent refresh session can turn this
 * endpoint into an alternate refresh mechanism.
 */
export async function switchActiveRole(
  prisma: PrismaClient,
  params: {
    userId: string;
    requestedRole: string;
    presentedActiveRole?: string | undefined;
    presentedExp: number;
    signingKey: string;
  },
): Promise<SwitchedRole> {
  return prisma.$transaction(async (tx): Promise<SwitchedRole> => {
    if (!(await users.lockUser(tx, params.userId))) {
      throw new AppError('FORBIDDEN', 'account is not active');
    }
    const account = await users.findAccountById(tx, params.userId);
    if (
      !account ||
      account.user.deletedAt !== null ||
      account.user.accountStatus !== 'active'
    ) {
      throw new AppError('FORBIDDEN', 'account is not active');
    }

    const narrowed = narrowToRole(account.roleScopes, params.requestedRole);
    if (!narrowed) {
      throw new AppError('FORBIDDEN', 'that role is not assigned to this account', {
        reason: 'ROLE_NOT_ASSIGNED',
        role: params.requestedRole,
      });
    }

    const now = new Date();
    if (params.presentedExp <= Math.floor(now.getTime() / 1000)) {
      throw new AppError('AUTH_REQUIRED', 'access token expired during role switch');
    }
    const issued = issueAccessTokenWithExpiryCap(
      {
        userId: account.user.id,
        roleScopes: narrowed,
        activeRole: params.requestedRole,
        accountStatus: account.user.accountStatus,
      },
      params.signingKey,
      params.presentedExp,
      now,
    );

    await audit.write(tx, {
      actorUserId: account.user.id,
      activeRole: params.presentedActiveRole,
      actionType: 'auth.role_switch',
      targetEntity: 'User',
      targetId: account.user.id,
      detail: { from: params.presentedActiveRole ?? null, to: params.requestedRole },
    });

    return {
      accessToken: issued.token,
      accessExpiresAt: issued.expiresAt,
      activeRole: params.requestedRole,
    };
  });
}

/** TD-8: `auth.login` on success, `auth.login_denied` with the denial reason. */
async function writeLoginAudit(
  prisma: Db,
  route: LoginRoute,
  userId: string,
): Promise<void> {
  if (route.kind === 'deactivated') {
    await audit.write(prisma, {
      actorUserId: userId,
      actionType: audit.AUDIT_ACTIONS.loginDenied,
      targetEntity: 'User',
      targetId: userId,
      // TD-8 wants the denial reason; TD-14 forbids the identity email here.
      detail: { provider: 'google', reason: route.reason },
    });
    return;
  }
  // `onboarding` never reaches here — it has no account to attribute a login to.
  if (route.kind === 'onboarding') return;

  await audit.write(prisma, {
    actorUserId: userId,
    actionType: audit.AUDIT_ACTIONS.login,
    targetEntity: 'User',
    targetId: userId,
    detail: {
      provider: 'google',
      account_status: route.kind,
      ...(route.boundNow ? { bound_now: true } : {}),
    },
  });
}
