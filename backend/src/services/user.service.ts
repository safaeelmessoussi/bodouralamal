import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { resolveSort, type SortableFields, type SortParams } from '../lib/sorting.js';
import { AppError, uniqueViolationFields } from '../lib/errors.js';
import { pageWindow, type Page } from '../lib/pagination.js';
import { MIN_QUERY_LENGTH, normalizePhone, normalizeSearchText } from '../lib/search-normalize.js';
import { branchesForRole } from '../policies/branch-scope.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import { revokeAllSessions } from './refresh-token.service.js';

/**
 * Staff pre-provisioning (SRS §3.1, §4.1b step 4b, §5.6 `/admin/users`, §7 R15).
 *
 * Under Google-only authentication there is no password to issue, so staff
 * "create an account" by recording the beneficiary's details together with the
 * **Google address authorized to claim it**. Nothing is bound yet: the account
 * has no `UserIdentity` at all, because §7 prohibits placeholder identity rows —
 * a half-populated identity would break the "has an identity ⇒ has
 * authenticated" predicate that the whole §4.1b login routing rests on.
 *
 * The binding happens on that address's first successful Google login (§4.1b
 * step 4b, TD-4.10), which is already implemented in the auth flow. This service
 * is the other half: creating the claimable account.
 *
 * `pre_provisioned_email` is stored lowercase (TD-12, with a database `CHECK`
 * backstop) and is unique among non-null values via a TD-6 partial unique index,
 * so one address can never be made claimable twice.
 */

/** TD-2 (§14.2 row "Create/edit users; assign roles & branch scopes"). */
const USER_ADMIN_ROLES = ['admin', 'super_admin'] as const;

/**
 * Roles staff may assign here. `super_admin` is deliberately absent: §15.1
 * bootstraps it and Revision 22 makes the database authoritative for
 * administrators thereafter, so it is never handed out through this endpoint.
 */
export type AssignableRole = 'admin' | 'teacher' | 'student' | 'parent';

export interface PreProvisionInput {
  /** R80.1 — captured at creation; there is no path that produces a person
   *  without one, and no way to acquire one later except explicit completion. */
  sex: 'female' | 'male';
  nameArabic: string;
  email: string;
  /** Optional: TD-2 grants creating users and assigning roles to the same actors. */
  role?: AssignableRole;
  /** Branch scope for the assignment; omitted means unscoped. */
  branchId?: string;
  /**
   * §4.1b step 4b: a pre-provisioned account routes by its own status on first
   * login — "typically `Pending` → status screen, or `Active` if staff
   * pre-approved". Default is `Pending`, matching §4.1's rule for new accounts.
   */
  preApproved?: boolean;
}

export async function preProvision(
  prisma: PrismaClient,
  /**
   * R60 — the full caller, not a bare id. The **active role** has to reach
   * `assertFreshActive` (which rebuilds from live rows and would otherwise hand
   * back this account's full authority) and the audit row (§60.8). Threading the
   * `Actor` rather than a second `activeRole` parameter keeps the two from
   * drifting apart, which is why the id alone is no longer enough.
   */
  caller: Actor,
  input: PreProvisionInput,
): Promise<{ id: string; accountStatus: string; preProvisionedEmail: string | null }> {
  // TD-12: user-management mutations are a high-risk surface, so the caller's
  // status and role are re-read from live rows rather than trusted from a token.
  const actor = await assertFreshActive(prisma, caller.userId, USER_ADMIN_ROLES, caller.activeRole);

  const email = input.email.trim().toLowerCase();
  const nameArabic = input.nameArabic.trim();
  if (!nameArabic) throw new AppError('VALIDATION_FAILED', 'name_arabic is required');

  if (input.role === 'admin' && !actor.roles.includes('super_admin')) {
    // An Admin creating another Admin is privilege propagation. TD-2 grants
    // "create/edit users" to both, but §2.1 makes Super Admin the unscoped
    // authority, so widening the administrator set stays with Super Admin.
    throw new AppError('FORBIDDEN', 'only a Super Admin may create another Admin');
  }

  return prisma.$transaction(async (tx) => {
    // Branch scope must exist and be live: an assignment pointing at a deleted
    // branch would be a scope that silently matches nothing.
    if (input.branchId) {
      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new AppError('NOT_FOUND', 'branch not found');
    }

    /**
     * **An email may be claimed by at most ONE live account** — and the unique
     * index alone does not say that.
     *
     * `pre_provisioned_email` is unique among itself, but an account that has
     * already **signed in** carries its address on `UserIdentity` and may have
     * no `pre_provisioned_email` at all. So pre-provisioning an address that
     * somebody is already using collided with nothing and was accepted: two
     * live accounts then claimed one address, and §4.1b's binding step would
     * have to choose between them at the next sign-in.
     *
     * **Reproduced before it was fixed** — `POST /admin/users` answered `201`
     * for an address with a live active identity.
     *
     * Checked here rather than declared, because the invariant spans two tables
     * and no unique index can express it. The window is the transaction's own;
     * the partial unique index still catches the pre-provisioned half, and
     * `bindIdentity`'s own uniqueness catches the identity half.
     */
    const claimed = await tx.userIdentity.findFirst({
      where: { email, isActive: true, user: { deletedAt: null } },
      select: { id: true },
    });
    if (claimed) {
      throw new AppError('DUPLICATE', 'that email already belongs to an account', {
        reason: 'EMAIL_ALREADY_CLAIMED',
      });
    }

    let user;
    try {
      user = await tx.user.create({
        data: {
          nameArabic,
          // R80.1 — captured at creation, like every other path.
          sex: input.sex,
          preProvisionedEmail: email,
          accountStatus: input.preApproved ? 'active' : 'pending',
        },
        select: { id: true, accountStatus: true, preProvisionedEmail: true },
      });
    } catch (error) {
      // The TD-6 partial unique index covers non-null values across ALL users,
      // deleted ones included, so this also catches an address that belonged to
      // a soft-deleted account — which must not be silently reclaimed (§4.1).
      if (uniqueViolationFields(error).some((f) => f.includes('pre_provisioned_email'))) {
        throw new AppError('DUPLICATE', 'that email is already authorized to claim an account');
      }
      throw error;
    }

    if (input.role) {
      const roleRow = await tx.role.findUnique({ where: { name: input.role } });
      if (!roleRow) throw new AppError('VALIDATION_FAILED', `unknown role ${input.role}`);
      await tx.userBranchRole.create({
        data: {
          userId: user.id,
          roleId: roleRow.id,
          branchId: input.branchId ?? null,
        },
      });
    }

    // TD-8's grid is a minimum and permits added coverage. Creating an account
    // that a named Google address may claim must be attributable to its creator.
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'user.create',
      targetEntity: 'User',
      targetId: user.id,
      detail: {
        pre_provisioned_email: email,
        role: input.role ?? null,
        branch_id: input.branchId ?? null,
        account_status: user.accountStatus,
      },
    });

    return user;
  });
}


/**
 * §14.2 Users screen: paginated, filtered, searchable list (TD-10).
 *
 * Columns are exactly what §14.2 specifies — Arabic name, Nickname, Role(s),
 * Branch scope, Status, Phone — and nothing more. Notably absent is anything
 * from `StudentSocialProfile`: §4.10 restricts those fields to assigned
 * teachers, so a list screen is the last place they belong.
 *
 * **Visibility is branch-scoped (§4.2, Revision 25).** A branch-scoped Admin
 * sees only users holding a live role assignment to one of that Admin's managed
 * branches. Users with **no** branch assignment — parents, unassigned students,
 * and pre-provisioned accounts not yet attached to one of those branches — are
 * visible to **Super Admins only**, so unrelated people are never exposed to a
 * branch-scoped administrator. An Admin whose own assignment is all-branches
 * (`NULL`) sees every user.
 *
 * Consequence worth knowing: the §4.1b registration transaction records no
 * branch, so a self-registered applicant is unassigned and therefore
 * Super-Admin-visible here until staff attach them to a branch. The §5.6
 * approval queue is a separate surface and is deliberately not scoped by this
 * rule, so it stays the path by which a branch Admin encounters applicants.
 */
export interface UserListFilters {
  q?: string;
  role?: string;
  branchId?: string;
  status?: string;
  /**
   * R79.7 — **only the institute's مستفيدات**, whatever their roles.
   *
   * Independent of enrolment: a beneficiary between placements, or one never yet
   * enrolled, is still a beneficiary. Independent of role in both directions: a
   * مؤطرة who studies is included, a guardian who does not is not.
   */
  beneficiariesOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface UserListItem {
  id: string;
  nameArabic: string;
  nickname: string | null;
  publicDisplayName: string | null;
  phone: string | null;
  accountStatus: string;
  roles: { role: string; branchId: string | null; branchName: string | null }[];
  /**
   * TD-15, and the reason the Users screen needs no second read.
   *
   * The edit dialog loads its row from this list and sends the version back;
   * a `GET /admin/users/{id}` returning the same fields plus one would be a
   * second projection of one concept, kept in step by hand.
   */
  version: number;
}

/** TD-10: default 25, max 100. */
/**
 * What `/admin/users` may be sorted by (R76.1) — **this endpoint's own
 * allow-list**, and deliberately narrow.
 *
 * `name` and `created_at` only. `account_status` was considered and left out: it
 * is an enum whose *alphabetical* order (`active`, `pending`, `suspended`) is not
 * its meaningful one, so a sort by it would look ordered and be arbitrary — the
 * status filter already answers the question a reader actually has.
 */
export const USER_SORT_FIELDS: SortableFields = {
  name: (dir) => [{ nameArabic: dir }],
  created_at: (dir) => [{ createdAt: dir }],
};

/** BR-19's order — the collated name, which is correct Arabic order natively. */
const USER_DEFAULT_ORDER = [{ nameArabic: 'asc' }];

export async function listUsers(
  prisma: PrismaClient,
  caller: Actor,
  filters: UserListFilters & SortParams = {},
): Promise<Page<UserListItem>> {
  // TD-12: browsing beneficiary records is a user-management surface, so the
  // caller's status and role are re-read from live rows on every request.
  const actor = await assertFreshActive(prisma, caller.userId, USER_ADMIN_ROLES, caller.activeRole);

  const { skip, take, page, pageSize } = pageWindow({ page: filters.page, pageSize: filters.pageSize });

  const where: Record<string, unknown> = { deletedAt: null };

  // R79.7 — the durable fact, never a role or an enrolment lookup.
  if (filters.beneficiariesOnly === true) where['isBeneficiary'] = true;

  // §4.2 Revision 25: visibility follows the caller's OWN admin scope. Resolved
  // per role — the branches reachable through some other role the caller holds
  // must not widen what they may browse here.
  const managed = branchesForRole(actor.roleScopes, 'admin');
  if (managed !== null) {
    // A branch-scoped Admin: only users assigned to one of those branches.
    // Unassigned people stay invisible, which is the point of the rule.
    where['branchRoles'] = { some: { deletedAt: null, branchId: { in: managed } } };
  }
  if (filters.status) where['accountStatus'] = filters.status;

  // Role and Branch filters (§14.2) both look at LIVE assignments: a revoked
  // role must not keep someone in a filtered list.
  const assignment: Record<string, unknown> = { deletedAt: null };
  if (filters.role) assignment['role'] = { name: filters.role };
  if (filters.branchId) assignment['branchId'] = filters.branchId;
  if (filters.role || filters.branchId) {
    // AND with the scope above rather than replacing it: a `branch_id` filter is
    // a narrowing convenience, never a way to reach outside one's own scope.
    const clauses = [{ branchRoles: { some: assignment } }];
    if (where['branchRoles']) {
      clauses.push({ branchRoles: where['branchRoles'] as never });
      delete where['branchRoles'];
    }
    where['AND'] = clauses;
  }

  if (filters.q) {
    const raw = filters.q.trim();
    if (raw.length < MIN_QUERY_LENGTH) {
      // TD-10 sets a two-character floor: a one-character substring matches most
      // of the table and is a scan, not a search.
      throw new AppError('VALIDATION_FAILED', `search query must be at least ${MIN_QUERY_LENGTH} characters`);
    }
    const text = normalizeSearchText(raw);
    const phone = normalizePhone(raw);
    const email = raw.toLowerCase();

    // TD-10's six search fields. Every text comparison runs against the indexed
    // shadow column, never against a per-row normalization. `contains` emits
    // LIKE '%…%', which is equivalent to TD-10's ILIKE here because both the
    // shadow columns and the query are already lowercased by the same rules.
    where['OR'] = [
      { nameArabicNormalized: { contains: text } },
      { nameFrenchNormalized: { contains: text } },
      { nicknameNormalized: { contains: text } },
      { phoneNormalized: { contains: phone } },
      // Email spans BOTH channels (Revision 15): a pre-provisioned account has
      // no identity row until first login, so searching only `UserIdentity`
      // would hide precisely the accounts staff most need to find.
      { preProvisionedEmail: { contains: email } },
      { identities: { some: { email: { contains: email } } } },
      // "Linked parent's name" — these are the links where this person is the
      // child, so the join reaches their parent.
      { childLinks: { some: { deletedAt: null, parent: { nameArabicNormalized: { contains: text } } } } },
    ];
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        nameArabic: true,
        nickname: true,
        publicDisplayName: true,
        phone: true,
        accountStatus: true,
        version: true,
        // **The two places an address can live, and both are needed** (R15,
        // TD-10). A pre-provisioned account has no `UserIdentity` row until its
        // first Google sign-in, so reading only the identity would leave exactly
        // the accounts staff most need to find showing no address at all —
        // which is the same reasoning TD-10 gives for searching both columns.
        preProvisionedEmail: true,
        // TD-5 **deactivates** an identity rather than deleting it, so the
        // filter is `is_active` — a soft-deleted account's address must not be
        // presented as a live one.
        identities: { where: { isActive: true }, select: { email: true }, take: 1 },
        branchRoles: {
          where: { deletedAt: null },
          select: { branchId: true, role: { select: { name: true } }, branch: { select: { name: true } } },
        },
      },
      // TD-10: `name_arabic` is natively collated ar-x-icu (TD-6a), so this is
      // correct Arabic order with no per-query COLLATE workaround. `id` is the
      // deterministic tiebreaker that keeps pagination stable.
      // The `id` tiebreaker is appended by `resolveSort` (R76.3), so it is not
      // repeated here — one place decides it for every endpoint.
      orderBy: resolveSort(USER_SORT_FIELDS, filters, USER_DEFAULT_ORDER) as never,
      skip,
      take,
    }),
  ]);

  return {
    data: users.map((u) => ({
      id: u.id,
      nameArabic: u.nameArabic,
      nickname: u.nickname,
      publicDisplayName: u.publicDisplayName,
      phone: u.phone,
      accountStatus: u.accountStatus,
      // The bound Google address where one exists, the pre-provisioned one
      // otherwise (R15). `null` for a minor student, who has neither and is
      // reached through their parent — an absent address here is a fact about
      // the person, not a gap in the row.
      email: u.identities[0]?.email ?? u.preProvisionedEmail,
      roles: u.branchRoles.map((r) => ({
        role: r.role.name,
        branchId: r.branchId,
        branchName: r.branch?.name ?? null,
      })),
      version: u.version,
    })),
    meta: { page, page_size: pageSize, total },
  };
}

/* ── User management (§5.6 "edit, deactivate, role/branch-scope assignment") ─ */

/**
 * The editable person fields.
 *
 * **`account_status` is deliberately absent**, and that is the same rule
 * `PATCH /sessions/{id}` follows for its own status: a suspension carries
 * obligations a field assignment cannot — TD-4.15 requires every live
 * `RefreshToken` to be revoked **in the same transaction**, or a 30-day
 * credential outlives the suspension. Accepting `account_status` here would give
 * that transition a second entrance with none of that attached.
 *
 * **`pre_provisioned_email` is absent too.** It is the address authorised to
 * *claim* an account (§7 R15), so editing it after the fact would hand a
 * half-registered person's account to someone else — and once bound it is
 * retained as provenance, never rewritten.
 *
 * **`public_display_name` is absent** — §20 rule 21 resolves the published
 * identity server-side, and a back-office form is exactly where a second answer
 * to *which name did this person publish* would be introduced.
 */
export interface UserProfileInput {
  nameArabic?: string;
  nameFrench?: string | null;
  nickname?: string | null;
  phone?: string | null;
  /**
   * **R80.3 — COMPLETION, never correction.**
   *
   * Accepted only while the stored value is absent. Supplying one for a person
   * who already has a recorded sex is refused: changing it is a different
   * decision with consequences for placements already made, and R80.4 declines
   * to introduce one silently under the name of completion.
   */
  sex?: 'female' | 'male';
}

/**
 * Loads the target and refuses one the caller may not act on.
 *
 * **Out of scope answers `404`, never `403`** (§20 rule 17): telling a branch
 * Admin that a user exists but belongs to someone else is itself a disclosure,
 * and the §4.2 R25 visibility rule exists precisely so unrelated people stay
 * invisible. The rule is the same one `listUsers` applies, expressed as a lookup
 * rather than as a check afterwards.
 */
async function loadManageable(
  db: Pick<PrismaClient, 'user'>,
  actor: { roleScopes: Parameters<typeof branchesForRole>[0] },
  id: string,
): Promise<{
  id: string;
  nameArabic: string;
  accountStatus: string;
  version: number;
  sex: 'female' | 'male' | null;
}> {
  const managed = branchesForRole(actor.roleScopes, 'admin');
  const user = await db.user.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(managed !== null
        ? { branchRoles: { some: { deletedAt: null, branchId: { in: managed } } } }
        : {}),
    },
    // `sex` travels with the row so the R80.3 completion guard can see whether
    // one is already recorded — a fact only the stored row knows.
    select: { id: true, nameArabic: true, accountStatus: true, version: true, sex: true },
  });
  if (!user) throw new AppError('NOT_FOUND', 'no such user');
  return user;
}

export async function updateUser(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  expectedVersion: number,
  input: UserProfileInput,
): Promise<UserListItem> {
  const actor = await assertFreshActive(prisma, caller.userId, USER_ADMIN_ROLES, caller.activeRole);

  await prisma.$transaction(async (tx) => {
    const target = await loadManageable(tx, actor, id);

    /**
     * **R80.3 — this path COMPLETES a missing sex; it does not correct one.**
     *
     * The check belongs here rather than in the validator because it is a fact
     * about the STORED row. R80.4 declines to introduce a correction path
     * silently under the name of completion: changing a recorded sex has
     * consequences for placements already made, and is its own decision.
     */
    if (input.sex !== undefined && target.sex !== null && target.sex !== input.sex) {
      throw new AppError('VALIDATION_FAILED', 'sex is already recorded for this person', {
        reason: 'SEX_ALREADY_RECORDED',
      });
    }

    // TD-15.1: a conditional UPDATE on `version`. `updateMany` is what makes the
    // condition part of the write rather than a check preceding it.
    const written = await tx.user.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: {
        ...(input.nameArabic !== undefined ? { nameArabic: input.nameArabic } : {}),
        ...(input.nameFrench !== undefined ? { nameFrench: input.nameFrench } : {}),
        ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.sex !== undefined ? { sex: input.sex } : {}),
        version: { increment: 1 },
      },
    });
    if (written.count === 0) {
      throw new AppError('VERSION_CONFLICT', 'this record changed since you loaded it');
    }

    // **Nothing re-normalizes the TD-10 shadow columns here, and nothing
    // should.** `user_search_shadow_sync_trigger` fires `BEFORE UPDATE OF
    // name_arabic, name_french, nickname, phone` and maintains all four. A
    // first draft of this function re-computed them explicitly — a second
    // normalization, drifting from the one the indexes were built with, which
    // would make search find some rows and not others with nothing failing.
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'user.update',
      targetEntity: 'User',
      targetId: id,
      // The FIELDS changed, not their values: a name and a phone number are
      // personal data, and TD-8's record must not become a second copy of them.
      detail: { fields: Object.keys(input).filter((k) => input[k as keyof UserProfileInput] !== undefined) },
    });
  });

  return readOne(prisma, id);
}

/**
 * Suspends an account — TD-1 `Active → Suspended`, TD-4.15.
 *
 * **Every live session is revoked in the same transaction.** TD-12 requires
 * suspension to take effect on the next refresh *immediately*; a suspension that
 * commits without revoking leaves a 30-day credential alive, which is the exact
 * safeguarding failure the freshness rule exists to prevent.
 *
 * **A reason is mandatory**, for the reason a cancellation's is: it is the only
 * record of why access was withdrawn, and afterwards nobody can reconstruct it.
 */
export async function suspendUser(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<UserListItem> {
  const actor = await assertFreshActive(prisma, caller.userId, USER_ADMIN_ROLES, caller.activeRole);
  if (id === actor.userId) {
    // Not paternalism: an administrator who suspends themselves is locked out
    // by their own next request, and the recovery path is a VPS shell.
    throw new AppError('STATE_CONFLICT', 'you cannot suspend your own account', {
      reason: 'SELF_SUSPENSION',
    });
  }

  await prisma.$transaction(async (tx) => {
    const target = await loadManageable(tx, actor, id);
    if (target.accountStatus !== 'active') {
      // TD-1 allows this transition only from Active.
      throw new AppError('STATE_CONFLICT', `cannot suspend an account that is ${target.accountStatus}`, {
        reason: 'INVALID_TRANSITION',
        account_status: target.accountStatus,
      });
    }
    await assertNotLastSuperAdmin(tx, id);

    const written = await tx.user.updateMany({
      where: { id, version: expectedVersion, accountStatus: 'active', deletedAt: null },
      data: { accountStatus: 'suspended', version: { increment: 1 } },
    });
    if (written.count === 0) {
      throw new AppError('VERSION_CONFLICT', 'this record changed since you loaded it');
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'user.suspend',
      targetEntity: 'User',
      targetId: id,
      detail: { reason },
    });
    // TD-4.15, in this transaction and not after it. Writes its own
    // `auth.token_revoked` row naming the affected session ids.
    await revokeAllSessions(tx, {
      userId: id,
      reason: 'suspension',
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
    });
  });

  return readOne(prisma, id);
}

/** TD-1 `Suspended → Active`. Restores nothing else: sessions stay revoked, so
 *  the person signs in again, which is the only way the new state is proven. */
export async function reactivateUser(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  expectedVersion: number,
): Promise<UserListItem> {
  const actor = await assertFreshActive(prisma, caller.userId, USER_ADMIN_ROLES, caller.activeRole);

  await prisma.$transaction(async (tx) => {
    const target = await loadManageable(tx, actor, id);
    if (target.accountStatus !== 'suspended') {
      // `Rejected` is TERMINAL (TD-1, §4.1b step 4a) and is deliberately not
      // reachable from here: re-admitting a rejected applicant is a fresh
      // registration decision, not the undo of a suspension.
      throw new AppError('STATE_CONFLICT', `cannot reactivate an account that is ${target.accountStatus}`, {
        reason: 'INVALID_TRANSITION',
        account_status: target.accountStatus,
      });
    }

    const written = await tx.user.updateMany({
      where: { id, version: expectedVersion, accountStatus: 'suspended', deletedAt: null },
      data: { accountStatus: 'active', version: { increment: 1 } },
    });
    if (written.count === 0) {
      throw new AppError('VERSION_CONFLICT', 'this record changed since you loaded it');
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'user.reactivate',
      targetEntity: 'User',
      targetId: id,
      detail: {},
    });
  });

  return readOne(prisma, id);
}

/* ── Role and branch-scope assignment (§5.6, §14.2, TD-2) ────────────────── */

/** One assignment: a role, and the branch it is scoped to. `null` is
 *  **all branches for that assignment** (§7 R24), never *no branch*. */
export interface RoleAssignmentInput {
  role: string;
  branchId: string | null;
}

/**
 * Every role the platform has, `super_admin` included.
 *
 * **`super_admin` is assignable here, deliberately, and this is a change from
 * `preProvision`'s narrower set.** Revision 22 states that after bootstrap
 * *"every subsequent change of administrators — assignment, promotion,
 * demotion, suspension — happens **exclusively through the application**"*. If
 * this endpoint refused the role, the only route to a second Super Admin would
 * be the lockout-recovery seed, which needs a VPS shell — the opposite of what
 * that sentence requires. Granting it stays a Super Admin's act, and the
 * last-administrator guard below is what keeps the recovery path from being
 * *needed*.
 */
const ALL_ROLES = ['super_admin', 'admin', 'teacher', 'student', 'parent'] as const;

/**
 * Refuses an act that would leave the platform with **no active Super Admin**.
 *
 * Revision 22 documents the lockout-recovery path — clear every Super Admin and
 * `SUPER_ADMIN_EMAIL` becomes live again — but reaching it requires
 * `DATABASE_URL` and a manual seed run on the VPS. That is a sanctioned
 * *recovery*, not an outcome a back-office control may produce with one click.
 */
async function assertNotLastSuperAdmin(
  tx: Pick<PrismaClient, 'user'>,
  losingUserId: string,
): Promise<void> {
  const remaining = await tx.user.count({
    where: {
      id: { not: losingUserId },
      accountStatus: 'active',
      deletedAt: null,
      branchRoles: { some: { deletedAt: null, role: { name: 'super_admin' } } },
    },
  });
  if (remaining === 0) {
    const self = await tx.user.count({
      where: {
        id: losingUserId,
        branchRoles: { some: { deletedAt: null, role: { name: 'super_admin' } } },
      },
    });
    if (self > 0) {
      throw new AppError('STATE_CONFLICT', 'this is the last active Super Admin', {
        reason: 'LAST_SUPER_ADMIN',
      });
    }
  }
}

/**
 * **Replaces** a user's whole set of role assignments.
 *
 * A `PUT` of the complete set rather than add/remove verbs: the set is what an
 * administrator reasons about, one call yields one audit row describing one
 * decision, and there is no window in which a user holds half of an intended
 * change — which add-then-remove would create every time a role is *moved*
 * between branches.
 *
 * **Removal is a soft delete** (TD-5): a revoked assignment is tombstoned rather
 * than erased, so *"who was an administrator at this branch in March"* stays
 * answerable. Re-granting an identical assignment revives the tombstoned row,
 * because `(user_id, role_id, branch_id)` is unique across deleted rows too.
 *
 * **Only a Super Admin may grant or revoke `admin` or `super_admin`.** An Admin
 * doing either is privilege propagation — the same rule `preProvision` applies
 * to creation, applied to the operation that can also perform it.
 */
/**
 * **The one implementation of *set this user's roles*.**
 *
 * Extracted so approval can grant a role **inside its own transaction**
 * (TD-4.2 — activation and the role it was approved for must commit together)
 * without a second copy of the privilege guard, the branch-liveness check and
 * the last-administrator rule. A copied authorization rule is the kind that
 * drifts while both copies keep passing their own tests.
 *
 * Takes a `tx` and an already-resolved actor: the caller owns the transaction
 * boundary and the TD-12 freshness assertion, because approval and user
 * management assert different role sets to get there.
 */
export async function applyRoleAssignments(
  tx: Prisma.TransactionClient,
  actor: { userId: string; roles: string[]; activeRole?: string | undefined },
  id: string,
  assignments: RoleAssignmentInput[],
): Promise<void> {
  const isSuperAdmin = actor.roles.includes('super_admin');

  for (const a of assignments) {
    if (!(ALL_ROLES as readonly string[]).includes(a.role)) {
      throw new AppError('VALIDATION_FAILED', `unknown role ${a.role}`);
    }
  }

  {
    const existing = await tx.userBranchRole.findMany({
      where: { userId: id },
      select: { id: true, roleId: true, branchId: true, deletedAt: true, role: { select: { name: true } } },
    });

    const roleRows = await tx.role.findMany({ where: { name: { in: [...ALL_ROLES] } } });
    const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

    const wanted = new Set(assignments.map((a) => `${a.role}|${a.branchId ?? ''}`));
    const live = existing.filter((e) => e.deletedAt === null);
    const privileged = (role: string): boolean => role === 'admin' || role === 'super_admin';

    // Guard BEFORE writing anything: a partially applied privileged change is
    // worse than a refused one.
    const changing = [
      ...assignments.filter(
        (a) => !live.some((e) => e.role.name === a.role && e.branchId === a.branchId),
      ).map((a) => a.role),
      ...live.filter((e) => !wanted.has(`${e.role.name}|${e.branchId ?? ''}`)).map((e) => e.role.name),
    ];
    if (changing.some(privileged) && !isSuperAdmin) {
      throw new AppError('FORBIDDEN', 'only a Super Admin may grant or revoke administrator roles');
    }

    // Branch scopes must be live: an assignment pointing at a deleted branch is
    // a scope that silently matches nothing.
    const branchIds = [...new Set(assignments.map((a) => a.branchId).filter((b): b is string => b !== null))];
    if (branchIds.length > 0) {
      const found = await tx.branch.count({ where: { id: { in: branchIds }, deletedAt: null } });
      if (found !== branchIds.length) throw new AppError('NOT_FOUND', 'branch not found');
    }

    const losingSuperAdmin =
      live.some((e) => e.role.name === 'super_admin') &&
      !assignments.some((a) => a.role === 'super_admin');
    if (losingSuperAdmin) await assertNotLastSuperAdmin(tx, id);

    // Revoke what is no longer wanted (TD-5 soft delete).
    const revoked = live.filter((e) => !wanted.has(`${e.role.name}|${e.branchId ?? ''}`));
    if (revoked.length > 0) {
      await tx.userBranchRole.updateMany({
        where: { id: { in: revoked.map((e) => e.id) } },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
    }

    // Grant what is missing, reviving a tombstoned row rather than inserting a
    // duplicate the unique index would refuse anyway.
    for (const a of assignments) {
      const roleId = roleIdByName.get(a.role);
      if (!roleId) throw new AppError('VALIDATION_FAILED', `unknown role ${a.role}`);
      const prior = existing.find((e) => e.roleId === roleId && e.branchId === a.branchId);
      if (prior === undefined) {
        await tx.userBranchRole.create({ data: { userId: id, roleId, branchId: a.branchId } });
      } else if (prior.deletedAt !== null) {
        await tx.userBranchRole.update({
          where: { id: prior.id },
          data: { deletedAt: null, deletedById: null },
        });
      }
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'user.roles_set',
      targetEntity: 'User',
      targetId: id,
      detail: {
        assignments: assignments.map((a) => ({ role: a.role, branch_id: a.branchId })),
        revoked: revoked.map((e) => ({ role: e.role.name, branch_id: e.branchId })),
      },
    });
  }
}

/**
 * `PUT /admin/users/{id}/roles` — **replaces** a user's whole assignment set.
 *
 * A `PUT` of the complete set rather than add/remove verbs: the set is what an
 * administrator reasons about, one call yields one audit row describing one
 * decision, and there is no window in which a user holds half of an intended
 * change — which add-then-remove would create every time a role is *moved*
 * between branches.
 */
export async function setUserRoles(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  assignments: RoleAssignmentInput[],
): Promise<UserListItem> {
  const actor = await assertFreshActive(prisma, caller.userId, USER_ADMIN_ROLES, caller.activeRole);

  await prisma.$transaction(async (tx) => {
    // Visibility is asserted here rather than inside the shared core: approval
    // reaches an applicant the §4.2 R25 user-list rule deliberately hides from
    // a branch Admin (a self-registered person has no branch assignment yet),
    // and the approval queue is unscoped by design (Revisions 25, 29).
    await loadManageable(tx, actor, id);
    await applyRoleAssignments(tx, actor, id, assignments);
  });

  // **Sessions are deliberately NOT revoked here, and the SRS is what decides
  // it.** A role change leaves the access token carrying the old scopes for up
  // to an hour on ordinary routes — but Revision 10 states exactly that
  // trade-off and resolves it the other way: every safeguarding-sensitive
  // operation re-asserts the caller's live assignments per request
  // (`assertFreshActive`), so a revoked role stops mattering *immediately*
  // where it matters, and the stateless window is accepted elsewhere.
  //
  // Revoking would also require a new `RefreshRevokedReason`, and §7 fixes that
  // enum at four values — `logout`, `suspension`, `user_deleted`,
  // `reuse_detected`. Reusing `suspension` for a demotion would make the audit
  // trail say something untrue about why access ended, which is worse than the
  // hour.
  return readOne(prisma, id);
}

/**
 * One user in the list's own shape.
 *
 * **Not a public endpoint** — it exists so a write can answer with the row the
 * screen already renders, rather than the screen re-fetching a whole page to
 * see one change.
 */
async function readOne(prisma: PrismaClient, id: string): Promise<UserListItem> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      nameArabic: true,
      nickname: true,
      publicDisplayName: true,
      phone: true,
      accountStatus: true,
      version: true,
      branchRoles: {
        where: { deletedAt: null },
        select: { branchId: true, role: { select: { name: true } }, branch: { select: { name: true } } },
      },
    },
  });
  return {
    id: u.id,
    nameArabic: u.nameArabic,
    nickname: u.nickname,
    publicDisplayName: u.publicDisplayName,
    phone: u.phone,
    accountStatus: u.accountStatus,
    roles: u.branchRoles.map((r) => ({
      role: r.role.name,
      branchId: r.branchId,
      branchName: r.branch?.name ?? null,
    })),
    version: u.version,
  };
}
