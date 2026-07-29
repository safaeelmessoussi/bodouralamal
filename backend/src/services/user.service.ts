import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError, uniqueViolationFields } from '../lib/errors.js';
import { pageWindow, type Page } from '../lib/pagination.js';
import { MIN_QUERY_LENGTH, normalizePhone, normalizeSearchText } from '../lib/search-normalize.js';
import { branchesForRole } from '../policies/branch-scope.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';

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
  actorUserId: string,
  input: PreProvisionInput,
): Promise<{ id: string; accountStatus: string; preProvisionedEmail: string | null }> {
  // TD-12: user-management mutations are a high-risk surface, so the caller's
  // status and role are re-read from live rows rather than trusted from a token.
  const actor = await assertFreshActive(prisma, actorUserId, USER_ADMIN_ROLES);

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

    let user;
    try {
      user = await tx.user.create({
        data: {
          nameArabic,
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
}

/** TD-10: default 25, max 100. */
export async function listUsers(
  prisma: PrismaClient,
  actorUserId: string,
  filters: UserListFilters = {},
): Promise<Page<UserListItem>> {
  // TD-12: browsing beneficiary records is a user-management surface, so the
  // caller's status and role are re-read from live rows on every request.
  const actor = await assertFreshActive(prisma, actorUserId, USER_ADMIN_ROLES);

  const { skip, take, page, pageSize } = pageWindow({ page: filters.page, pageSize: filters.pageSize });

  const where: Record<string, unknown> = { deletedAt: null };

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
        branchRoles: {
          where: { deletedAt: null },
          select: { branchId: true, role: { select: { name: true } }, branch: { select: { name: true } } },
        },
      },
      // TD-10: `name_arabic` is natively collated ar-x-icu (TD-6a), so this is
      // correct Arabic order with no per-query COLLATE workaround. `id` is the
      // deterministic tiebreaker that keeps pagination stable.
      orderBy: [{ nameArabic: 'asc' }, { id: 'asc' }],
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
      roles: u.branchRoles.map((r) => ({
        role: r.role.name,
        branchId: r.branchId,
        branchName: r.branch?.name ?? null,
      })),
    })),
    meta: { page, page_size: pageSize, total },
  };
}
