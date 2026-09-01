import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { resolveSort, type SortableFields, type SortParams } from '../lib/sorting.js';
import { AppError, uniqueViolationFields } from '../lib/errors.js';
import { composeArabicName, composeFrenchName } from '../lib/person-name.js';
import { pageWindow, type Page } from '../lib/pagination.js';
import { MIN_QUERY_LENGTH, normalizePhone, normalizeSearchText } from '../lib/search-normalize.js';
import { branchesForRole } from '../policies/branch-scope.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';
import { revokeAllSessions } from './refresh-token.service.js';
import { notifySubjectUserChange } from './notification.service.js';
import {
  lockAndAssertNotPlatformOwner,
  lockAndAssertOwnerRoleInvariant,
} from './platform-owner.service.js';

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

/**
 * **Global account administration is Super Admin's alone** (Owner, 2026-08-28).
 *
 * It was `['admin', 'super_admin']`. The Owner's clarification separates two
 * things this list had merged:
 *
 * * **the global account directory** — every person on the platform, their
 *   address, their status, their roles, and the power to edit, suspend or delete
 *   the account itself. That is *account administration*, and it is Super
 *   Admin's;
 * * **picking a person while doing operational work** — staffing a class,
 *   enrolling a beneficiary, filling a roster. An Admin needs that and it is
 *   not account administration at all.
 *
 * The second is `listDirectory` below, which is **a different projection, not a
 * relaxed copy of this one**: it carries no address, no phone, no account
 * status and no `version`, because a name picker needs none of them. Five
 * operational screens were receiving every user's email and phone in order to
 * render a list of names.
 *
 * Enforced here, in the service, and therefore for every caller including tests
 * and jobs — never by hiding a page (§16.2, and the Owner is explicit).
 */
const ACCOUNT_ADMIN_ROLES = ['super_admin'] as const;

/**
 * Who may pick a person while doing their own operational work. Deliberately
 * wider than `ACCOUNT_ADMIN_ROLES`, and deliberately reaching a narrower
 * projection.
 */
const DIRECTORY_ROLES = ['admin', 'super_admin'] as const;

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
  const actor = await assertFreshActive(prisma, caller.userId, ACCOUNT_ADMIN_ROLES, caller.activeRole);

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

    await users.lockNormalizedEmail(tx, email);

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
     * A stable normalized-email row is locked before this re-read because the
     * invariant spans two tables and either row may be absent. Same-table
     * uniqueness remains a backstop, while the shared row closes the cross-table
     * check-then-insert race.
     */
    const claimedBy = await users.emailClaimingUserIds(tx, email);
    if (claimedBy.length > 0) {
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
        // TD-14: the target User is the attributable coordinate. Recording the
        // mailbox again would move personal identity into an indefinitely
        // retained AuditLog row and defeat R111's eventual erasure.
        identity_channel: 'pre_provisioned',
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
  status?: 'active' | 'suspended';
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
  isPlatformOwner: boolean;
  nameArabic: string;
  /**
   * **The stored parts, so the edit form hydrates from what was collected.**
   *
   * The dialog had one «الاسم» box holding the composed name, so opening it and
   * saving rewrote `name_arabic` from a client-typed string — and the parts,
   * the French name, the sex and the notes could not be edited at all. They
   * travel here rather than through a second `GET /admin/users/{id}`, for the
   * reason `version` already does: one projection of one concept.
   */
  firstNameArabic: string | null;
  lastNameArabic: string | null;
  firstNameFrench: string | null;
  lastNameFrench: string | null;
  /** R80.6 amended 2026-08-28 — see `UserDto.sex`. */
  sex: string | null;
  notes: string | null;
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
  /**
   * **The two name parts, independently** (Owner, 2026-08-30).
   *
   * Ordered by the GENERATED columns, not by `firstNameArabic` /
   * `lastNameArabic`: the stored parts are NULL on every row predating
   * Revisions 40–41, which refused to backfill them, so ordering by them would
   * group all legacy rows under NULL — sorting by *whether anybody has edited
   * this person* rather than by her family name. The generated columns carry
   * the same derivation the DTO applies on read, so the order matches what the
   * table displays.
   *
   * **Absent last, in both directions.** A single-token name has no family
   * name; absent is not *smallest*, so it does not ambush the top of a
   * descending sort — the same rule `sort-rows.ts` states for the client.
   */
  first_name: (dir) => [{ firstNameSort: { sort: dir, nulls: 'last' } }],
  last_name: (dir) => [{ lastNameSort: { sort: dir, nulls: 'last' } }],
  created_at: (dir) => [{ createdAt: dir }],
};

/** BR-19's order — the collated name, which is correct Arabic order natively. */
const USER_DEFAULT_ORDER = [{ nameArabic: 'asc' }];

export async function listUsers(
  prisma: PrismaClient,
  caller: Actor,
  filters: UserListFilters & SortParams = {},
): Promise<Page<UserListItem>> {
  // TD-12: browsing the account directory is account administration, so the
  // caller's status and role are re-read from live rows on every request — and
  // since 2026-08-28 that role is Super Admin alone.
  await assertFreshActive(prisma, caller.userId, ACCOUNT_ADMIN_ROLES, caller.activeRole);
  return listUsersUnchecked(prisma, caller, 'account_management', filters);
}

/**
 * The query both surfaces run, **with no role assertion of its own.**
 *
 * Split out on 2026-08-28 so `listUsers` and `listDirectory` cannot drift on
 * *which rows a branch-scoped caller may see* while differing on *what is
 * returned about them* — which is the only difference intended.
 *
 * **Not exported, and that is the safety property**: every route reaches it
 * through one of the two functions above, each of which has already asserted
 * its own role. A caller able to reach this directly would bypass both.
 */
async function listUsersUnchecked(
  prisma: PrismaClient,
  caller: Actor,
  population: 'account_management' | 'operational',
  filters: UserListFilters & SortParams = {},
): Promise<Page<UserListItem>> {
  const actor = await assertFreshActive(prisma, caller.userId, DIRECTORY_ROLES, caller.activeRole);

  const { skip, take, page, pageSize } = pageWindow({ page: filters.page, pageSize: filters.pageSize });

  const where: Record<string, unknown> = {
    deletedAt: null,
    // Pending and Rejected belong exclusively to the approval workflow. The
    // account-management page may also recover a Suspended approved account;
    // an operational picker must offer only people who can actually act now.
    accountStatus:
      population === 'operational'
        ? 'active'
        : { in: ['active', 'suspended'] },
  };

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
        firstNameArabic: true,
        lastNameArabic: true,
        firstNameFrench: true,
        lastNameFrench: true,
        sex: true,
        notes: true,
        nickname: true,
        publicDisplayName: true,
        phone: true,
        accountStatus: true,
        version: true,
        platformOwnership: { select: { singletonKey: true } },
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
      isPlatformOwner: u.platformOwnership !== null,
      nameArabic: u.nameArabic,
      firstNameArabic: u.firstNameArabic,
      lastNameArabic: u.lastNameArabic,
      firstNameFrench: u.firstNameFrench,
      lastNameFrench: u.lastNameFrench,
      sex: u.sex,
      notes: u.notes,
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

/* ── The operational directory (Owner clarification, 2026-08-28) ─────────── */

/**
 * A person as an operational screen needs them: **a name to show and enough to
 * tell two people apart.**
 *
 * Everything `UserListItem` carries and this does not is deliberate: no email,
 * no phone, no `account_status`, no `version`. A staff picker cannot edit an
 * account, so it is given nothing an account edit would need — and the five
 * screens that used to call `GET /admin/users` for a list of names stop
 * receiving every user's contact details as a side effect.
 *
 * `roles` stays, because it is what the screens filter on (*«teachers at my
 * branch»*) and what `BranchScopeCell` renders on المؤطِّرات. It names roles and
 * branches, which are assignments — not personal data about the person.
 */
export interface DirectoryEntry {
  id: string;
  nameArabic: string;
  /**
   * **The same name, in its two parts** (2026-08-28). §14.2's tables show
   * الاسم الشخصي and الاسم العائلي as separate columns, so the parts travel
   * with the name they compose. They disclose nothing the composed name does
   * not — it *is* them, joined — which is why this stays a picker projection
   * rather than becoming an account one.
   */
  firstNameArabic: string | null;
  lastNameArabic: string | null;
  nickname: string | null;
  roles: { role: string; branchId: string | null; branchName: string | null }[];
}

export type DirectoryFilters = Pick<
  UserListFilters,
  'q' | 'role' | 'branchId' | 'beneficiariesOnly' | 'page' | 'pageSize'
>;

/**
 * `GET /admin/directory` — **who may I staff, enrol or roster?**
 *
 * Admin or Super Admin, and **branch-scoped exactly as `listUsers` is**: the
 * scope rule is not relaxed to make a picker convenient. What differs is the
 * projection, which is the whole point of the split — an Admin doing
 * operational work gets the people, not their accounts.
 *
 * Filtering, searching and paging behave identically to the account list,
 * because they are the same questions asked of the same table; they are
 * delegated rather than reimplemented, so the two cannot drift on what a
 * branch-scoped Admin may see.
 */
export async function listDirectory(
  prisma: PrismaClient,
  caller: Actor,
  filters: DirectoryFilters & SortParams = {},
): Promise<Page<DirectoryEntry>> {
  // TD-12: re-read live, like every other user-facing read of this table.
  await assertFreshActive(prisma, caller.userId, DIRECTORY_ROLES, caller.activeRole);

  // Delegated on purpose. `listUsers` re-asserts `ACCOUNT_ADMIN_ROLES`, which an
  // Admin does not hold, so this calls the shared query with the caller's own
  // identity and narrows afterwards — see `listUsersUnchecked`.
  const page = await listUsersUnchecked(prisma, caller, 'operational', filters);

  return {
    data: page.data.map((u) => ({
      id: u.id,
      nameArabic: u.nameArabic,
      firstNameArabic: u.firstNameArabic,
      lastNameArabic: u.lastNameArabic,
      firstNameFrench: u.firstNameFrench,
      lastNameFrench: u.lastNameFrench,
      sex: u.sex,
      notes: u.notes,
      nickname: u.nickname,
      roles: u.roles,
    })),
    meta: page.meta,
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
  /**
   * **The parts, and the display names are composed from them** (§1.1, R40).
   * Registration has always worked this way; the back-office edit accepted the
   * composed name instead, which made the client the authority on how a
   * person's name reads.
   */
  firstNameArabic?: string;
  lastNameArabic?: string;
  firstNameFrench?: string | null;
  lastNameFrench?: string | null;
  nickname?: string | null;
  phone?: string | null;
  notes?: string | null;
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
  firstNameArabic: string | null;
  lastNameArabic: string | null;
  firstNameFrench: string | null;
  lastNameFrench: string | null;
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
    // The stored name PARTS travel too: composing a display name from one
    // edited half requires the other half as it currently stands (§1.1).
    select: {
      id: true,
      nameArabic: true,
      accountStatus: true,
      version: true,
      sex: true,
      firstNameArabic: true,
      lastNameArabic: true,
      firstNameFrench: true,
      lastNameFrench: true,
    },
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
  const actor = await assertFreshActive(prisma, caller.userId, ACCOUNT_ADMIN_ROLES, caller.activeRole);

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
        // **Composed here, from whichever half changed** (§1.1, R40). The stored
        // parts are the authority, so an edit of one part recomposes against the
        // other as it currently stands rather than against what the client
        // happened to send.
        ...(input.firstNameArabic !== undefined
          ? { firstNameArabic: input.firstNameArabic }
          : {}),
        ...(input.lastNameArabic !== undefined ? { lastNameArabic: input.lastNameArabic } : {}),
        ...(input.firstNameArabic !== undefined || input.lastNameArabic !== undefined
          ? {
              nameArabic: composeArabicName(
                input.firstNameArabic ?? target.firstNameArabic ?? '',
                input.lastNameArabic ?? target.lastNameArabic ?? '',
              ).trim(),
            }
          : {}),
        ...(input.firstNameFrench !== undefined
          ? { firstNameFrench: input.firstNameFrench }
          : {}),
        ...(input.lastNameFrench !== undefined ? { lastNameFrench: input.lastNameFrench } : {}),
        ...(input.firstNameFrench !== undefined || input.lastNameFrench !== undefined
          ? {
              nameFrench: composeFrenchName(
                input.firstNameFrench ?? target.firstNameFrench ?? undefined,
                input.lastNameFrench ?? target.lastNameFrench ?? undefined,
              ),
            }
          : {}),
        ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
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
  const actor = await assertFreshActive(prisma, caller.userId, ACCOUNT_ADMIN_ROLES, caller.activeRole);
  if (id === actor.userId) {
    // Not paternalism: an administrator who suspends themselves is locked out
    // by their own next request, and the recovery path is a VPS shell.
    throw new AppError('STATE_CONFLICT', 'you cannot suspend your own account', {
      reason: 'SELF_SUSPENSION',
    });
  }

  await prisma.$transaction(async (tx) => {
    await lockAndAssertNotPlatformOwner(tx, id);
    // The User row is the stable serialization anchor shared by successful
    // login/session creation and user-wide revocation. It must precede every
    // RefreshSession lock acquired by revokeAllSessions below.
    if (!(await users.lockUser(tx, id))) {
      throw new AppError('NOT_FOUND', 'no such user');
    }
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
  const actor = await assertFreshActive(prisma, caller.userId, ACCOUNT_ADMIN_ROLES, caller.activeRole);

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
  tx: Prisma.TransactionClient,
  losingUserId: string,
): Promise<void> {
  // The caller holds this User, so their own assignment cannot change between
  // this cheap test and the guarded mutation.
  const self = await tx.user.count({
    where: {
      id: losingUserId,
      branchRoles: { some: { deletedAt: null, role: { name: 'super_admin' } } },
    },
  });
  if (self === 0) return;

  if (!(await users.lockRole(tx, 'super_admin'))) {
    throw new Error('super_admin role is not configured');
  }
  const remaining = await tx.user.count({
    where: {
      id: { not: losingUserId },
      accountStatus: 'active',
      deletedAt: null,
      branchRoles: { some: { deletedAt: null, role: { name: 'super_admin' } } },
    },
  });
  if (remaining === 0) {
    throw new AppError('STATE_CONFLICT', 'this is the last active Super Admin', {
      reason: 'LAST_SUPER_ADMIN',
    });
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

  /**
   * **A role is held once per account** (Owner decision, 2026-08-28).
   *
   * Refused here as a `400` rather than left to the database: the partial unique
   * index `user_branch_role_one_live_role_per_user` is the authority, but a
   * constraint violation surfaces as a `500` with no field named, and a client
   * that sent the same role twice deserves to be told which one.
   *
   * The old code could produce the duplicate itself — it read the existing rows
   * **once** and then iterated the submitted list, so a role submitted twice
   * found no prior row either time and inserted two. The platform's own Super
   * Admin held `super_admin` twice.
   */
  const seen = new Set<string>();
  for (const a of assignments) {
    if (seen.has(a.role)) {
      throw new AppError('VALIDATION_FAILED', `role ${a.role} assigned more than once`, {
        reason: 'DUPLICATE_ROLE',
        role: a.role,
      });
    }
    seen.add(a.role);
  }

  {
    const existing = await tx.userBranchRole.findMany({
      where: { userId: id },
      select: { id: true, roleId: true, branchId: true, deletedAt: true, role: { select: { name: true } } },
    });

    const roleRows = await tx.role.findMany({ where: { name: { in: [...ALL_ROLES] } } });
    const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

    // Keyed by ROLE alone: a role carries one scope, so changing that scope is
    // an edit of the existing assignment rather than a second one beside it.
    const wanted = new Set(assignments.map((a) => a.role));
    const live = existing.filter((e) => e.deletedAt === null);
    const privileged = (role: string): boolean => role === 'admin' || role === 'super_admin';

    // Guard BEFORE writing anything: a partially applied privileged change is
    // worse than a refused one.
    const changing = [
      ...assignments.filter(
        (a) => !live.some((e) => e.role.name === a.role && e.branchId === a.branchId),
      ).map((a) => a.role),
      ...live.filter((e) => !wanted.has(e.role.name)).map((e) => e.role.name),
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
    const revoked = live.filter((e) => !wanted.has(e.role.name));
    if (revoked.length > 0) {
      await tx.userBranchRole.updateMany({
        where: { id: { in: revoked.map((e) => e.id) } },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
    }

    // Grant what is missing, reviving a tombstoned row rather than inserting a
    // duplicate the unique index would refuse anyway.
    /** Scope changes recorded for the audit row, beside the outright revocations. */
    const moved: { role: string; from: string | null; to: string | null }[] = [];

    for (const a of assignments) {
      const roleId = roleIdByName.get(a.role);
      if (!roleId) throw new AppError('VALIDATION_FAILED', `unknown role ${a.role}`);

      const liveRow = existing.find((e) => e.roleId === roleId && e.deletedAt === null);

      if (liveRow && liveRow.branchId === a.branchId) continue; // already exactly this

      /**
       * **Moving a scope REVOKES and re-grants; it never rewrites the row.**
       *
       * One row per role is a rule about *live* rows, so a tombstone beside it
       * is allowed — and required. Mutating `branch_id` in place would satisfy
       * the constraint and silently destroy the answer to *«who taught at this
       * branch in March»*, which is exactly what TD-5's soft delete exists to
       * keep. The first draft of this change did mutate, and the existing
       * regression caught it.
       */
      if (liveRow) {
        await tx.userBranchRole.update({
          where: { id: liveRow.id },
          data: { deletedAt: new Date(), deletedById: actor.userId },
        });
        moved.push({ role: a.role, from: liveRow.branchId, to: a.branchId });
      }

      // A tombstoned row for this exact role AND scope is revived rather than
      // duplicated; anything else becomes a new assignment.
      const revivable = existing.find(
        (e) => e.roleId === roleId && e.deletedAt !== null && e.branchId === a.branchId,
      );
      if (revivable && !liveRow) {
        await tx.userBranchRole.update({
          where: { id: revivable.id },
          data: { deletedAt: null, deletedById: null },
        });
      } else {
        await tx.userBranchRole.create({ data: { userId: id, roleId, branchId: a.branchId } });
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
        // A scope change is neither a grant nor a revocation on its own; the
        // trail says so rather than leaving it to be inferred from two rows.
        moved,
      },
    });
    if (changing.length > 0) {
      await notifySubjectUserChange(tx, {
        type: 'role_assignments_changed',
        subjectUserId: id,
        recipientUserIds: [id],
        actorUserId: actor.userId,
      });
    }
  }
}

/**
 * Adds or corrects one role assignment while preserving every other live role.
 *
 * Approval needs this additive operation for structural roles (`student` for
 * an admitted beneficiary, `parent` for an approved family link), while the
 * user-management endpoint deliberately replaces the complete set. Routing
 * both through `applyRoleAssignments` keeps privilege, scope-liveness,
 * tombstone/revival and audit behaviour in one implementation.
 */
export async function ensureRoleAssignment(
  tx: Prisma.TransactionClient,
  actor: { userId: string; roles: string[]; activeRole?: string | undefined },
  id: string,
  assignment: RoleAssignmentInput,
): Promise<boolean> {
  // The following read-and-replace must share the same User serialization
  // anchor as the ordinary role-management endpoint. Without this lock, a
  // concurrent complete-set edit could read the pre-approval roles and commit
  // after this helper, silently discarding the structural Student/Parent grant
  // (or this helper could discard the concurrent edit).
  if (!(await users.lockUser(tx, id))) {
    throw new AppError('NOT_FOUND', 'no such user');
  }
  const live = await tx.userBranchRole.findMany({
    where: { userId: id, deletedAt: null },
    select: { branchId: true, role: { select: { name: true } } },
  });
  const current = live.find((entry) => entry.role.name === assignment.role);
  if (current?.branchId === assignment.branchId) return false;

  await applyRoleAssignments(tx, actor, id, [
    ...live
      .filter((entry) => entry.role.name !== assignment.role)
      .map((entry) => ({ role: entry.role.name, branchId: entry.branchId })),
    assignment,
  ]);
  return true;
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
  const actor = await assertFreshActive(prisma, caller.userId, ACCOUNT_ADMIN_ROLES, caller.activeRole);

  await prisma.$transaction(async (tx) => {
    await lockAndAssertOwnerRoleInvariant(tx, id, assignments);
    // Role-switch and login issuance derive credentials from these assignments.
    // Share their User governing row so a credential is wholly before or wholly
    // after this replacement, never signed from a half-stale assignment set.
    if (!(await users.lockUser(tx, id))) {
      throw new AppError('NOT_FOUND', 'no such user');
    }
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
  // Revoking would also require a new `RefreshRevokedReason`. §7's values
  // describe logout, safeguarding actions, replay, and R101's one-time rollout;
  // none describes a demotion. Reusing `suspension` would make the audit trail
  // say something untrue about why access ended, which is worse than the hour.
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
      firstNameArabic: true,
      lastNameArabic: true,
      firstNameFrench: true,
      lastNameFrench: true,
      sex: true,
      notes: true,
      nickname: true,
      publicDisplayName: true,
      phone: true,
      accountStatus: true,
      version: true,
      platformOwnership: { select: { singletonKey: true } },
      branchRoles: {
        where: { deletedAt: null },
        select: { branchId: true, role: { select: { name: true } }, branch: { select: { name: true } } },
      },
    },
  });
  return {
    id: u.id,
    isPlatformOwner: u.platformOwnership !== null,
    nameArabic: u.nameArabic,
    firstNameArabic: u.firstNameArabic,
    lastNameArabic: u.lastNameArabic,
    firstNameFrench: u.firstNameFrench,
    lastNameFrench: u.lastNameFrench,
    sex: u.sex,
    notes: u.notes,
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
