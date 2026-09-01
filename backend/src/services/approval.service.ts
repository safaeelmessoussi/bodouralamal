import type { PrismaClient } from '../generated/prisma/client.js';
import { RefreshRevokedReason } from '../generated/prisma/enums.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { pageWindow, type Page } from '../lib/pagination.js';
import { composeArabicName } from '../lib/person-name.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import * as users from '../repositories/user.repository.js';
import { enrolAtPlacement, type PlacementInput } from './enrollment.service.js';
import { revokeAllSessions } from './refresh-token.service.js';
import { applyRoleAssignments, ensureRoleAssignment } from './user.service.js';
import { notifySubjectUserChange } from './notification.service.js';

/**
 * Approval queue (SRS §5.6, §14.2, TD-3.2, TD-4.2, TD-12).
 *
 * Two item types share one queue: **registrations** (a pending applicant, plus
 * their pending child and link when they arrived as a §4.1 bundle) and
 * standalone **family-link** requests (§4.3 "Link a Child").
 *
 * Approving a bundle is atomic by rule (TD-4.2): parent activation + child
 * activation + link approval + audit row. §4.3 is explicit — "approval activates
 * all three atomically" — because a half-approved bundle is a parent who can see
 * a child whose own record is still pending.
 */

/** TD-2: approving is Admin or Super Admin, and nobody else. */
const APPROVER_ROLES = ['admin', 'super_admin'] as const;

export type ApprovalType =
  | 'registration'
  | 'family-link'
  | 'child-application'
  | 'identity-review';

export interface ApprovalRegistrationPerson {
  firstNameArabic: string | null;
  lastNameArabic: string | null;
  firstNameFrench: string | null;
  lastNameFrench: string | null;
  nickname: string | null;
  sex: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  dataProcessingConsent: {
    granted: boolean;
    textVersion: string;
    givenAt: Date;
  } | null;
}

export interface ApprovalItem {
  id: string;
  type: ApprovalType;
  /** §14.2 column: Applicant(s). */
  applicants: { id: string; nameArabic: string; role: 'applicant' | 'child' | 'parent' }[];
  submittedAt: Date;
  /** §14.2 column: Bundle contents — what approving this will actually change. */
  bundle: { childCount: number; linkCount: number };
  /**
   * §14.2 column: Branch requested (Revision 39) — **what the applicant asked
   * for**, not where they will be placed. `null` on a family-link item, which
   * carries no branch at all: that request concerns an existing child whose
   * placement already lives in their Group, and resolving it through that
   * enrolment would make one filter mean two different things.
   */
  branch: { id: string; name: string } | null;
  /**
   * What a self-service applicant asked to become (Revision 49, proposed) —
   * `'teacher'` or `null`.
   *
   * **A hint, never an authority.** It is what makes a staff request
   * *distinguishable* in the queue; the role itself is granted only by the
   * assignment the approver makes. `null` on a family registration and on every
   * family-link item, which requests no role at all.
   */
  requestedRole: string | null;
  /** General planning preference captured from هيئة التأطير registration. */
  framing: {
    mode: 'in_person' | 'online' | 'both';
    allBranches: boolean;
    branches: { id: string; name: string }[];
  } | null;
  /**
   * The educational stage the applicant asked for (Revision 49) — what §4.1
   * step 1 needs to preselect *"the first Level of the applicant's Category"*.
   *
   * **A request, never a placement.** It narrows and preselects what the
   * approver is offered; the approver may choose any Level. `null` on a
   * family-link item and on a staff request, which is admitted to no Level, and
   * on any account registered before this revision — where it means *not
   * stated*, exactly as a null branch does.
   */
  category: { id: string; name: string } | null;
  /** Complete submitted adult/guardian facts for the authorised review dialog. */
  registrationDetails: { applicant: ApprovalRegistrationPerson } | null;
  /**
   * R62 — the children in this request, **one decidable block each**.
   *
   * Present only on a `child-application` item; `[]` elsewhere. Each block
   * carries its OWN application id, because R62.2 decides a child alone: the
   * item groups siblings so an administrator sees a family, and the ids are
   * what let them approve one and refuse another in the same visit.
   *
   * Deliberately **not** folded into `applicants`. That array answers *who is
   * this request about*, and its `id` is a `User` — a child application has no
   * user yet, by design (R62.1), so putting an application id there would make
   * one field mean two things.
   */
  children: {
    applicationId: string;
    nameArabic: string;
    status: 'pending' | 'approved' | 'rejected';
    schoolingStage: string | null;
    firstNameArabic: string;
    lastNameArabic: string;
    firstNameFrench: string | null;
    lastNameFrench: string | null;
    nickname: string | null;
    sex: string | null;
    requestedCategory: { id: string; name: string } | null;
    requestedBranch: { id: string; name: string } | null;
    dataProcessingConsent: boolean;
    mediaReleaseConsent: boolean;
    consentTextVersion: string;
    consentGivenAt: Date;
  }[];
}

function registrationPerson(row: {
  firstNameArabic: string | null;
  lastNameArabic: string | null;
  firstNameFrench: string | null;
  lastNameFrench: string | null;
  nickname: string | null;
  sex: string | null;
  phone: string | null;
  notes: string | null;
  identities: { email: string }[];
  consentsAsSubject: {
    granted: boolean;
    consentTextVersion: string;
    grantedAt: Date;
  }[];
}): ApprovalRegistrationPerson {
  const consent = row.consentsAsSubject[0];
  return {
    firstNameArabic: row.firstNameArabic,
    lastNameArabic: row.lastNameArabic,
    firstNameFrench: row.firstNameFrench,
    lastNameFrench: row.lastNameFrench,
    nickname: row.nickname,
    sex: row.sex,
    phone: row.phone,
    email: row.identities[0]?.email ?? null,
    notes: row.notes,
    dataProcessingConsent: consent
      ? {
          granted: consent.granted,
          textVersion: consent.consentTextVersion,
          givenAt: consent.grantedAt,
        }
      : null,
  };
}

/**
 * What طلبات الانضمام may be sorted by (R76.1).
 *
 * **This queue is a UNION of three independently-paginated sources** —
 * registrations, family links and child applications — and it always was: each
 * branch below runs its own `count` and its own `skip`/`take`, so a page is
 * *up to N of each type*, never N of the whole. The sort is therefore applied
 * to **all three** `orderBy` clauses so every source is ordered by the same
 * field in the same direction; it does not, and does not claim to, interleave
 * the types into one global order.
 *
 * **With the type filter active it IS exact**, which is the case an approver
 * sorting a queue is usually in. That is stated in the page's own comment too,
 * so nobody later reads the header as a promise the union cannot keep.
 *
 * `submitted` is a timestamp and orders chronologically; `applicants` is a
 * natively `ar-x-icu` collated name column (TD-6a). **`bundle` is absent**: it
 * is a derived count of what a request contains, and ordering by it means
 * nothing to an approver.
 */
export const APPROVAL_SORT_FIELDS = ['submitted', 'applicants'] as const;
export type ApprovalSortField = (typeof APPROVAL_SORT_FIELDS)[number];

/** Resolves the request's sort into the `orderBy` every source shares. */
function approvalOrder(
  sortBy: string | undefined,
  sortDir: string | undefined,
  /**
   * How THIS source reaches the applicant's name. The three differ — a
   * registration carries it directly, a family link and a child application
   * reach it through a relation — so each passes its own path rather than a
   * bare column name that only one of them could use.
   */
  byName: (dir: 'asc' | 'desc') => Record<string, unknown>,
): Record<string, unknown>[] {
  if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
    throw new AppError('VALIDATION_FAILED', 'sort_dir must be asc or desc', {
      issues: [{ path: 'sort_dir', message: "expected 'asc' or 'desc'" }],
    });
  }
  const dir = sortDir === 'desc' ? 'desc' : 'asc';
  if (sortBy === undefined) {
    if (sortDir !== undefined) {
      throw new AppError('VALIDATION_FAILED', 'sort_dir requires sort_by', {
        issues: [{ path: 'sort_by', message: 'required when sort_dir is given' }],
      });
    }
    // The queue's own reading order: oldest waiting first.
    return [{ createdAt: 'asc' }, { id: 'asc' }];
  }
  if (!(APPROVAL_SORT_FIELDS as readonly string[]).includes(sortBy)) {
    throw new AppError('VALIDATION_FAILED', `cannot sort by ${sortBy}`, {
      issues: [
        { path: 'sort_by', message: `expected one of: ${APPROVAL_SORT_FIELDS.join(', ')}` },
      ],
    });
  }
  // `id` last, always: offset pagination needs a unique tie-break or a row can
  // appear on two pages or on neither (`lib/sorting.ts`).
  return sortBy === 'submitted'
    ? [{ createdAt: dir }, { id: 'asc' }]
    : [byName(dir), { id: 'asc' }];
}

export async function listApprovals(
  prisma: PrismaClient,
  /**
   * R60 — the full caller, not a bare id. The **active role** has to reach
   * `assertFreshActive` (which rebuilds from live rows and would otherwise hand
   * back this account's full authority) and the audit row (§60.8). Threading the
   * `Actor` rather than a second `activeRole` parameter keeps the two from
   * drifting apart, which is why the id alone is no longer enough.
   */
  caller: Actor,
  options: {
    type?: ApprovalType;
    branchId?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string | undefined;
    sortDir?: string | undefined;
    /** Exact notification target: only this applicant/parent's review work. */
    reviewUserId?: string;
  } = {},
): Promise<Page<ApprovalItem>> {
  // TD-12: approvals are a high-risk surface, so even listing re-asserts the
  // caller's live status rather than trusting the token.
  await assertFreshActive(prisma, caller.userId, APPROVER_ROLES, caller.activeRole);

  const { skip, take, page, pageSize } = pageWindow({ page: options.page, pageSize: options.pageSize });
  const type = options.type;
  // Revision 39 — a FILTER, never a scope. It narrows what this reader chose to
  // look at; it does not limit what they are permitted to see. The queue stays
  // deliberately unscoped (Revisions 25, 29) precisely so a branch Admin can
  // find an applicant whose chosen branch is WRONG, or absent, and fix it.
  // A family-link item has no branch, so any branch filter excludes the whole
  // type rather than matching some of it.
  const branchId = options.branchId;
  const reviewUserId = options.reviewUserId;

  const items: ApprovalItem[] = [];
  let total = 0;

  if (!type || type === 'registration') {
    // A registration item is a pending applicant who is NOT merely someone
    // else's pending child — the child is shown as part of its parent's bundle,
    // not as a separate queue entry, so an admin approves one thing once.
    const where = {
      accountStatus: 'pending' as const,
      deletedAt: null,
      childLinks: { none: {} },
      ...(reviewUserId ? { id: reviewUserId } : {}),
      // Applied to the COUNT as well as the page, so `meta.total` describes the
      // filtered set. A total that ignored the filter would tell the client to
      // render pages that are empty.
      ...(branchId
        ? {
            OR: [
              { intendedBranchId: branchId },
              {
                framingPreference: {
                  is: {
                    OR: [
                      { allBranches: true },
                      { branches: { some: { branchId } } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    total += await prisma.user.count({ where });
    const applicants = await prisma.user.findMany({
      where,
      include: {
        parentLinks: { where: { deletedAt: null }, include: { student: true } },
        // R62 — the children this applicant asked for. A registration now
        // produces APPLICATIONS rather than pending links, and showing them on
        // the parent's own item is what keeps one family as one queue entry:
        // the parent is decided here, each child through its own endpoint.
        childApplicationsAsParent: {
          where: { status: 'pending', deletedAt: null },
          orderBy: [{ createdAt: 'asc' }],
          include: {
            requestedCategory: { select: { id: true, name: true } },
            requestedBranch: { select: { id: true, name: true } },
          },
        },
        identities: { where: { isActive: true }, select: { email: true }, take: 1 },
        consentsAsSubject: {
          where: { consentType: 'data_processing' },
          orderBy: { grantedAt: 'desc' },
          take: 1,
          select: { granted: true, consentTextVersion: true, grantedAt: true },
        },
        // Only what the DTO publishes (§16.2): the branch's id and name, never
        // the whole row.
        intendedBranch: { select: { id: true, name: true } },
        // Only what the DTO publishes (§16.2), never the whole row.
        intendedCategory: { select: { id: true, name: true } },
        framingPreference: {
          include: {
            branches: {
              include: { branch: { select: { id: true, name: true } } },
              orderBy: { branch: { name: 'asc' } },
            },
          },
        },
      },
      orderBy: approvalOrder(options.sortBy, options.sortDir, (dir) => ({ nameArabic: dir })),
      skip,
      take,
    });
    for (const applicant of applicants) {
      const pendingLinks = applicant.parentLinks.filter((l) => l.status === 'pending');
      const firstApplication = applicant.childApplicationsAsParent[0];
      const requestedBranch = firstApplication
        ? applicant.childApplicationsAsParent.every(
            (child) => child.requestedBranchId === firstApplication.requestedBranchId,
          )
          ? firstApplication.requestedBranch
          : null
        : applicant.intendedBranch;
      const requestedCategory = firstApplication
        ? applicant.childApplicationsAsParent.every(
            (child) => child.requestedCategoryId === firstApplication.requestedCategoryId,
          )
          ? firstApplication.requestedCategory
          : null
        : applicant.intendedCategory;
      items.push({
        id: applicant.id,
        type: 'registration',
        applicants: [
          { id: applicant.id, nameArabic: applicant.nameArabic, role: 'applicant' },
          ...pendingLinks.map((l) => ({
            id: l.student.id,
            nameArabic: l.student.nameArabic,
            role: 'child' as const,
          })),
        ],
        submittedAt: applicant.createdAt,
        // R62 — a new registration bundles APPLICATIONS; a pre-R62 one bundled
        // pending links. Counting both keeps the column truthful across the
        // transition instead of reading zero for every new family.
        bundle: {
          childCount: pendingLinks.length + applicant.childApplicationsAsParent.length,
          linkCount: pendingLinks.length + applicant.childApplicationsAsParent.length,
        },
        branch: requestedBranch
          ? { id: requestedBranch.id, name: requestedBranch.name }
          : null,
        requestedRole: applicant.requestedRole,
        registrationDetails: { applicant: registrationPerson(applicant) },
        framing: applicant.framingPreference
          ? {
              mode: applicant.framingPreference.mode,
              allBranches: applicant.framingPreference.allBranches,
              branches: applicant.framingPreference.branches.map((entry) => ({
                id: entry.branch.id,
                name: entry.branch.name,
              })),
            }
          : null,
        // R62 — the children applied for with this registration. Empty on a
        // pre-R62 request, which bundled them as pending LINKS instead; those
        // rows remain and are still counted by `bundle` above.
        children: applicant.childApplicationsAsParent.map((c) => ({
          applicationId: c.id,
          nameArabic: composeArabicName(c.firstNameArabic, c.lastNameArabic),
          status: c.status,
          schoolingStage: c.schoolingStage,
          firstNameArabic: c.firstNameArabic,
          lastNameArabic: c.lastNameArabic,
          firstNameFrench: c.firstNameFrench,
          lastNameFrench: c.lastNameFrench,
          nickname: c.nickname,
          sex: c.sex,
          requestedCategory: c.requestedCategory,
          requestedBranch: c.requestedBranch,
          dataProcessingConsent: c.consentDataProcessing,
          mediaReleaseConsent: c.consentMediaRelease,
          consentTextVersion: c.consentTextVersion,
          consentGivenAt: c.consentGivenAt,
        })),
        category: requestedCategory
          ? { id: requestedCategory.id, name: requestedCategory.name }
          : null,
      });
    }
  }

  // A branch filter excludes this type WHOLESALE rather than matching none of
  // it: a link request carries no branch (Revision 39), so asking for "branch X"
  // is asking for something a family-link item can never be. Skipping the query
  // keeps `meta.total` honest — counting rows that can never match would report
  // results the caller cannot see.
  if ((!type || type === 'family-link') && !branchId && !reviewUserId) {
    // Standalone link requests: the parent already has an account (§4.3), so
    // only the link itself is pending.
    const where = { status: 'pending' as const, deletedAt: null, parent: { accountStatus: 'active' as const } };
    total += await prisma.familyLink.count({ where });
    const links = await prisma.familyLink.findMany({
      where,
      include: { parent: true, student: true },
      orderBy: approvalOrder(options.sortBy, options.sortDir, (dir) => ({
        student: { nameArabic: dir },
      })) as never,
      skip,
      take,
    });
    for (const link of links) {
      items.push({
        id: link.id,
        type: 'family-link',
        applicants: [
          { id: link.parent.id, nameArabic: link.parent.nameArabic, role: 'parent' },
          { id: link.student.id, nameArabic: link.student.nameArabic, role: 'child' },
        ],
        submittedAt: link.createdAt,
        bundle: { childCount: 0, linkCount: 1 },
        // A link request concerns an existing child whose placement already
        // lives in their Group. Resolving a branch through that enrolment would
        // make one filter mean two different things depending on the row.
        branch: null,
        // A link request concerns an existing child and asks for no role,
        // and no stage: the child's placement already exists.
        requestedRole: null,
        registrationDetails: null,
        framing: null,
        children: [],
        category: null,
      });
    }
  }

  // ── R62 — child applications, grouped by request ────────────────────────
  //
  // **Without this the queue cannot see them at all**, and `POST
  // /child-applications` writes rows no administrator can find: a parent
  // submits and nothing ever happens. One item per REQUEST so an administrator
  // sees a family rather than a list of unrelated children, and one decidable
  // block per child inside it, because R62.2 decides a child alone.
  //
  // **R64 — the branch filter now reaches this type.** It used to exclude the
  // whole of it, on the true-at-the-time ground that a child application
  // carried no branch (R39 kept `intended_branch_id` on the applicant alone).
  // The request records its own branch since R64, so filtering narrows these
  // items exactly as it narrows registrations, instead of silently dropping
  // every family. A request submitted before R64 has none, and a branch filter
  // excludes it — which is what *not stated* has always meant here.
  if (!type || type === 'child-application') {
    const pending = await prisma.childApplication.findMany({
      where: {
        status: 'pending',
        deletedAt: null,
        ...(branchId ? { requestedBranchId: branchId } : {}),
        // **Not the ones already shown on their parent's registration item.**
        // A non-student parent registering produces both a pending applicant
        // and applications; listing them twice would invite an approver to
        // decide the same family from two places. This branch is therefore
        // exactly the requests from adults who are ALREADY approved — an adult
        // student registering their children, or a parent adding another.
        parent: { accountStatus: { not: 'pending' } },
        ...(reviewUserId ? { parentId: reviewUserId } : {}),
      },
      include: {
        parent: {
          select: {
            id: true,
            nameArabic: true,
            firstNameArabic: true,
            lastNameArabic: true,
            firstNameFrench: true,
            lastNameFrench: true,
            nickname: true,
            sex: true,
            phone: true,
            notes: true,
            identities: { where: { isActive: true }, select: { email: true }, take: 1 },
            consentsAsSubject: {
              where: { consentType: 'data_processing' },
              orderBy: { grantedAt: 'desc' },
              take: 1,
              select: { granted: true, consentTextVersion: true, grantedAt: true },
            },
          },
        },
        requestedCategory: { select: { id: true, name: true } },
        // R64 — the branch this child was asked to attend. Until it existed the
        // item reported `branch: null` and the §14.2 branch filter could not
        // reach a child-registration request at all.
        requestedBranch: { select: { id: true, name: true } },
      },
      orderBy: approvalOrder(options.sortBy, options.sortDir, (dir) => ({
        parent: { nameArabic: dir },
      })) as never,
    });

    // Grouped in memory rather than by a second query: a request holds a
    // handful of siblings, and `GROUP BY` here would buy nothing but a join.
    const byRequest = new Map<string, typeof pending>();
    for (const row of pending) {
      const group = byRequest.get(row.requestId) ?? [];
      group.push(row);
      byRequest.set(row.requestId, group);
    }

    total += byRequest.size;
    // The page window is applied to the REQUESTS, so a family is never split
    // across two pages — half a family is not a thing an approver can act on.
    for (const group of [...byRequest.values()].slice(skip, skip + take)) {
      const first = group[0]!;
      // A parent may request a different branch/category per child. The compact
      // table summary is populated only when the whole sibling group agrees;
      // otherwise the exact values remain on each child in the detail view.
      const commonBranch = group.every(
        (child) => child.requestedBranchId === first.requestedBranchId,
      )
        ? first.requestedBranch
        : null;
      const commonCategory = group.every(
        (child) => child.requestedCategoryId === first.requestedCategoryId,
      )
        ? first.requestedCategory
        : null;
      items.push({
        id: first.requestId,
        type: 'child-application',
        applicants: [
          { id: first.parent.id, nameArabic: first.parent.nameArabic, role: 'parent' },
        ],
        submittedAt: first.createdAt,
        // Approving the whole request would create this many children and this
        // many links — though R62.2 lets an approver take them one at a time.
        bundle: { childCount: group.length, linkCount: group.length },
        branch: commonBranch
          ? { id: commonBranch.id, name: commonBranch.name }
          : null,
        requestedRole: null,
        registrationDetails: { applicant: registrationPerson(first.parent) },
        framing: null,
        category: commonCategory
          ? { id: commonCategory.id, name: commonCategory.name }
          : null,
        children: group.map((c) => ({
          applicationId: c.id,
          nameArabic: composeArabicName(c.firstNameArabic, c.lastNameArabic),
          status: c.status,
          schoolingStage: c.schoolingStage,
          firstNameArabic: c.firstNameArabic,
          lastNameArabic: c.lastNameArabic,
          firstNameFrench: c.firstNameFrench,
          lastNameFrench: c.lastNameFrench,
          nickname: c.nickname,
          sex: c.sex,
          requestedCategory: c.requestedCategory,
          requestedBranch: c.requestedBranch,
          dataProcessingConsent: c.consentDataProcessing,
          mediaReleaseConsent: c.consentMediaRelease,
          consentTextVersion: c.consentTextVersion,
          consentGivenAt: c.consentGivenAt,
        })),
      });
    }
  }

  /**
   * **R68 / §4.3 (R62.9) — a minor gained their own login.**
   *
   * One item per STUDENT, grouping every link stamped when they bound their
   * first identity: the decision is about the arrangement, not about one row,
   * and an administrator asked to decide each parent separately would be asked
   * the same question twice.
   *
   * **Derived, exactly like the three above.** Nothing is enqueued; the item
   * exists while a stamped, approved, live link does. That is what makes the
   * queue incapable of offering something nobody can act on.
   *
   * **No branch filter reaches it** — the same reasoning Revision 43.3 gave for
   * Teaching Groups: the entity has no branch of its own, and resolving one
   * through the student's enrolment would make one filter mean two things.
   */
  if ((!type || type === 'identity-review') && !branchId && !reviewUserId) {
    const flagged = await prisma.familyLink.findMany({
      where: {
        identityReviewRaisedAt: { not: null },
        status: 'approved',
        deletedAt: null,
        student: { deletedAt: null },
      },
      include: {
        student: { select: { id: true, nameArabic: true } },
        parent: { select: { id: true, nameArabic: true } },
      },
      orderBy: [{ identityReviewRaisedAt: 'asc' }, { id: 'asc' }],
    });

    const byStudent = new Map<string, typeof flagged>();
    for (const link of flagged) {
      const group = byStudent.get(link.studentId) ?? [];
      group.push(link);
      byStudent.set(link.studentId, group);
    }

    total += byStudent.size;
    for (const group of [...byStudent.values()].slice(skip, skip + take)) {
      const first = group[0]!;
      items.push({
        // The STUDENT's id: the item is that person's arrangement, and it is
        // what `decide()` resolves against.
        id: first.studentId,
        type: 'identity-review',
        applicants: [
          { id: first.student.id, nameArabic: first.student.nameArabic, role: 'applicant' },
          ...group.map((link) => ({
            id: link.parent.id,
            nameArabic: link.parent.nameArabic,
            role: 'parent' as const,
          })),
        ],
        submittedAt: first.identityReviewRaisedAt!,
        // Deciding this creates nothing. Rejection REMOVES links, and the count
        // is what an approver needs to see before choosing.
        bundle: { childCount: 0, linkCount: group.length },
        branch: null,
        requestedRole: null,
        registrationDetails: null,
        framing: null,
        category: null,
        children: [],
      });
    }
  }

  return { data: items, meta: { page, page_size: pageSize, total } };
}

interface Decision {
  approve: boolean;
  /** TD-9: max 500 chars. Mandatory on rejection (§5.6, §14.2). */
  reason?: string;
  /**
   * Role and branch-scope assignments to grant **in the same transaction as the
   * activation** (Revision 49, proposed).
   *
   * **Why it belongs here and not on a second call.** §4.1 already makes
   * approval *"a single administrative act that admits the applicant"*, and an
   * account that is `Active` with no role is a person who can sign in and reach
   * nothing — a state the platform should never pass through when the approver
   * already knows what the account is for. Two calls would create exactly that
   * window, and leave the second one forgettable.
   *
   * **The applicant's `requested_role` is a hint and is never applied
   * automatically.** The approver states the assignment, or there is none.
   *
   * Omitted or empty means *approve without granting anything*, which is the
   * ordinary path for a student or a parent — they receive their access through
   * enrolment, not through a role assignment.
   */
  assignments?: { role: string; branchId: string | null }[];
  /**
   * The Levels and Administrative Groups the applicant is admitted to —
   * **§4.1, Revision 43**, which makes this the defining content of an approval
   * rather than an optional extra:
   *
   * > *"Approval and every resulting `Enrollment` row are written in **one
   * > transaction** (TD-4) — an approved account with no enrollment is a person
   * > the platform admitted and then lost."*
   *
   * One entry per (person, Level). `userId` names **who** is being enrolled,
   * because a bundle admits more than one person and they are not
   * interchangeable: on the parent+child path it is the **child** who enrols,
   * while the parent receives access through the family link. A teacher request
   * enrols nobody.
   *
   * **Exactly one group per Level** (§4.1 step 2) falls out of the shape —
   * `administrativeGroupId` is singular, and BR-21's partial unique index is the
   * backstop.
   *
   * **Teaching Groups are never assigned here** (§4.1): at approval nobody yet
   * knows how each Subject will be split, and most Subjects are never split.
   */
  /**
   * R66.5 — each placement is a **group**, or a **Level and a branch**. A Level
   * nobody has subdivided has no group to name, and demanding one is what left
   * an approver unable to admit anybody to eighteen of twenty live Levels.
   */
  enrollments?: { userId: string; placement: PlacementInput }[];
}

/**
 * TD-4.2 — the whole bundle in one transaction.
 *
 * The `{id}` of TD-3.2's route carries no type, so it is resolved against
 * pending registrations first and then pending links. The two id spaces are
 * distinct UUID tables, so a value cannot mean both.
 */
export async function decide(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  decision: Decision,
): Promise<{ type: ApprovalType; activated: number }> {
  const actor = await assertFreshActive(prisma, caller.userId, APPROVER_ROLES, caller.activeRole);

  if (!decision.approve && !decision.reason?.trim()) {
    // §5.6/§14.2: rejection carries a reason. Rejecting a family's application
    // without recording why is not an auditable decision.
    throw new AppError('VALIDATION_FAILED', 'a reason is required to reject (§5.6)');
  }

  return prisma.$transaction(async (tx) => {
    // ── Registration bundle?
    //
    // TD-15.3 first-wins REQUIRES a row lock, and the status check alone does
    // not provide one. Under READ COMMITTED two concurrent approvals both read
    // the row as `pending` — neither sees the other's uncommitted write — so
    // both proceeded to update and BOTH succeeded, activating once but writing
    // two `user.approve` audit rows for one decision.
    //
    // The existing test caught this roughly one run in five and had been
    // passing on timing luck since the queue was written; a fixture change in
    // Revision 39 shifted the timing enough to surface it. Locking the row
    // first makes the second caller block here and then re-read the COMMITTED
    // status, so it finds nothing pending and takes the STATE_CONFLICT path
    // that was always intended.
    //
    // R102 shares the authentication hierarchy: User first, then every stable
    // RefreshSession anchor in deterministic UUID order. `FOR NO KEY UPDATE`
    // still gives TD-15.3 first-wins, while remaining compatible with the
    // implicit User KEY SHARE taken by a racing refresh's child-FK writes.
    await users.lockUser(tx, id);

    const applicant = await tx.user.findFirst({
      where: { id, accountStatus: 'pending', deletedAt: null, childLinks: { none: {} } },
      include: {
        parentLinks: { where: { deletedAt: null, status: 'pending' } },
        // R62 — needed to tell a parent registering children (who enrols
        // nobody here) from a lone applicant (who is the student).
        childApplicationsAsParent: { where: { status: 'pending', deletedAt: null } },
      },
    });

    if (applicant) {
      const nextStatus = decision.approve ? 'active' : 'rejected';
      let activated = 1;
      const rejectedUserIds = new Set<string>(decision.approve ? [] : [applicant.id]);

      // TD-1: Pending → Active | Rejected. The guard on `accountStatus` in the
      // WHERE above is what makes a double-approval first-wins (TD-15.3): the
      // second caller finds nothing pending and gets STATE_CONFLICT below.
      await tx.user.update({ where: { id: applicant.id }, data: { accountStatus: nextStatus } });

      for (const link of applicant.parentLinks) {
        // Child activation + link decision, atomic with the parent (TD-4.2).
        // Legacy pre-R62 bundles may still transition an already-created child
        // User. Take that account's governing lock before changing it so its
        // own session creation/revocation follows the same hierarchy.
        if (!decision.approve) await users.lockUser(tx, link.studentId);
        const childTransition = await tx.user.updateMany({
          where: { id: link.studentId, accountStatus: 'pending', deletedAt: null },
          data: { accountStatus: nextStatus },
        });
        if (!decision.approve && childTransition.count === 1) {
          rejectedUserIds.add(link.studentId);
        }
        await tx.familyLink.update({
          where: { id: link.id },
          data: {
            status: decision.approve ? 'approved' : 'rejected',
            decidedAt: new Date(),
            decidedById: actor.userId,
            ...(decision.reason ? { decisionReason: decision.reason } : {}),
          },
        });
        activated += 1;
      }

      if (!decision.approve) {
        // R102: status, durable revocation and both mandatory audit facts share
        // this approval transaction. `revokeAllSessions` reuses the already-
        // held User lock, then locks that user's anchors in UUID order.
        for (const rejectedUserId of [...rejectedUserIds].sort()) {
          await revokeAllSessions(tx, {
            userId: rejectedUserId,
            reason: RefreshRevokedReason.rejection,
            actorUserId: actor.userId,
            activeRole: actor.activeRole,
          });
        }
      }

      // Revision 49 — the role the account was approved FOR, granted in this
      // same transaction (TD-4.2). `applyRoleAssignments` is the one
      // implementation of this: it carries the privilege guard (only a Super
      // Admin may grant an administrator role), the branch-liveness check and
      // the last-administrator rule, so approving cannot become a second, weaker
      // way to hand out authority.
      //
      // Rejection assigns nothing, whatever was sent: a rejected applicant
      // receiving a role would be the single worst outcome this endpoint could
      // produce.
      const assignments = decision.approve ? (decision.assignments ?? []) : [];
      if (assignments.length > 0) {
        await applyRoleAssignments(tx, actor, applicant.id, assignments);
      }

      // §4.1 (Revision 43) — the placement, in THIS transaction. Nothing here
      // is re-implemented: the enrolment services carry the branch-scope check, the
      // §4.4b sex restriction, BR-21's one-group-per-Level rule and the consent
      // re-evaluation enqueue, so approval and the roster screen place students
      // by exactly the same rules.
      //
      // Rejection enrols nobody, whatever was sent — for the reason it grants
      // no role: admitting someone to a Level while refusing them the account
      // is not a state that should be reachable.
      const enrollments = decision.approve ? (decision.enrollments ?? []) : [];
      // **Who may be enrolled is bounded by the bundle**, not by the caller: the
      // applicant themselves, or one of the pending children this approval is
      // activating. Without that check an approver could place any student in
      // the platform by naming their id here, turning approval into an
      // unscoped enrolment endpoint.
      const admissible = new Set([applicant.id, ...applicant.parentLinks.map((l) => l.studentId)]);
      for (const e of enrollments) {
        if (!admissible.has(e.userId)) {
          throw new AppError('VALIDATION_FAILED', 'that person is not part of this approval', {
            reason: 'NOT_IN_BUNDLE',
            user_id: e.userId,
          });
        }
      }
      // **Every person this approval admits as a STUDENT must be placed.** §4.1
      // does not leave this optional — *"an approved account with no enrollment
      // is a person the platform admitted and then lost"* — so the refusal
      // happens here rather than being left to whoever notices later.
      //
      // Who counts as a student is DERIVED, not asked for: a bundle carrying
      // pending children is a parent registering a family, and it is the
      // children who enrol while the parent's access comes through the family
      // link; a lone applicant is themselves the student. A staff request
      // (`requested_role`) enrols nobody at all — a teacher is not admitted to a
      // Level.
      if (decision.approve) {
        const children = applicant.parentLinks.map((l) => l.studentId);
        // **R62 — a parent registering children enrols nobody here.** The
        // children arrive as applications and are placed on their own
        // decisions, so this applicant is a parent rather than a student and
        // demanding a placement for them would refuse every family registration
        // made since the revision. A PRE-R62 bundle still carries pending
        // links, and those children still enrol here.
        const appliedFor = applicant.childApplicationsAsParent.length;
        const mustEnrol =
          children.length > 0
            ? children
            : appliedFor > 0 || applicant.requestedRole !== null
              ? []
              : [applicant.id];
        const placed = new Set(enrollments.map((e) => e.userId));
        const missing = mustEnrol.filter((id) => !placed.has(id));
        if (missing.length > 0) {
          throw new AppError('VALIDATION_FAILED', 'every admitted student needs a placement (§4.1)', {
            reason: 'ENROLLMENT_REQUIRED',
            missing_user_ids: missing,
          });
        }
      }

      /**
       * **R79.3 — the durable beneficiary fact, set HERE.**
       *
       * The people this bundle admits as students are exactly the ones
       * `enrollments` places, and reusing that set rather than re-deriving it is
       * the whole point: a second derivation would drift from the first, and the
       * drift would be invisible until somebody could not be enrolled again.
       *
       * It is written in the SAME transaction that clears `requestedRole` and
       * `intendedCategoryId` further down — those are REQUEST fields consumed by
       * this decision, and cannot carry the fact afterwards. That is the failure
       * R79 exists to prevent.
       *
       * A staff approval places nobody and therefore sets nothing; a parent who
       * registered children is not made a beneficiary by their admission.
       */
      const admitted = [...new Set(enrollments.map((e) => e.userId))];
      const placedEnrollments: Awaited<ReturnType<typeof enrolAtPlacement>>[] = [];
      for (const e of enrollments) {
        // One resolver for both shapes and both approval paths — the branching
        // lives in `enrolAtPlacement`, not in each caller (R66.5).
        placedEnrollments.push(
          await enrolAtPlacement(tx, actor, e.placement, e.userId, 'approval'),
        );
      }

      /**
       * A beneficiary admitted by this decision is structurally a Student.
       * Placement supplies the role's branch scope; the client neither chooses
       * nor may omit it. This closes the reachable Active + beneficiary +
       * Enrollment + no-role state that rendered «بلا دور» after approval.
       */
      const studentRoleScopes: { userId: string; branchId: string; changed: boolean }[] = [];
      for (const userId of admitted) {
        const branches = [
          ...new Set(
            placedEnrollments
              .filter((entry) => entry.studentId === userId)
              .map((entry) => entry.branchId),
          ),
        ];
        if (branches.length !== 1) {
          throw new AppError(
            'VALIDATION_FAILED',
            'one approval must place a student within one role scope',
            { reason: 'STUDENT_ROLE_SCOPE_AMBIGUOUS', user_id: userId },
          );
        }
        const branchId = branches[0]!;
        studentRoleScopes.push({
          userId,
          branchId,
          changed: await ensureRoleAssignment(tx, actor, userId, {
            role: 'student',
            branchId,
          }),
        });
      }

      if (decision.approve && admitted.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: admitted } },
          data: { isBeneficiary: true },
        });
      }

      await audit.write(tx, {
        actorUserId: actor.userId,
        activeRole: actor.activeRole,
        actionType: decision.approve ? 'user.approve' : 'user.reject',
        targetEntity: 'User',
        targetId: applicant.id,
        detail: {
          type: 'registration',
          children_activated: applicant.parentLinks.length,
          // What was ASKED vs what was GRANTED, both recorded: the gap between
          // them is the approver's decision, and it is the thing an auditor
          // would come here to see.
          requested_role: applicant.requestedRole,
          // R79 — who this decision accepted as a مستفيدة, recorded beside what
          // was requested and what was granted.
          admitted_as_beneficiary: admitted.length,
          granted: assignments.map((a) => ({ role: a.role, branch_id: a.branchId })),
          student_role_scopes: studentRoleScopes.map((entry) => ({
            user_id: entry.userId,
            branch_id: entry.branchId,
            changed: entry.changed,
          })),
          // §4.1's placement, recorded on the approval itself as well as on each
          // `enrollment.create` row: this is the act that admitted them, and it
          // must be answerable from the approval alone.
          enrolled: enrollments.map((e) => ({
            user_id: e.userId,
            // R66.5 — the trail records WHICH shape the approver used, because
            // "placed in a group" and "placed directly in a Level" are
            // different decisions and a null would not distinguish them from a
            // group the projection happened to omit.
            ...('administrativeGroupId' in e.placement
              ? { administrative_group_id: e.placement.administrativeGroupId }
              : { level_id: e.placement.levelId, branch_id: e.placement.branchId }),
          })),
          ...(decision.reason ? { reason: decision.reason } : {}),
        },
      });

      // Modern R62 registration decisions contain only the applicant. Preserve
      // complete attribution for any legacy bundle child that also transitioned
      // by recording that rejection against the child's own User row.
      for (const rejectedUserId of [...rejectedUserIds].filter((userId) => userId !== applicant.id)) {
        await audit.write(tx, {
          actorUserId: actor.userId,
          activeRole: actor.activeRole,
          actionType: 'user.reject',
          targetEntity: 'User',
          targetId: rejectedUserId,
          detail: {
            type: 'registration_bundle_child',
            parent_applicant_id: applicant.id,
            ...(decision.reason ? { reason: decision.reason } : {}),
          },
        });
      }

      if (decision.approve) {
        await notifySubjectUserChange(tx, {
          type: 'registration_approved',
          subjectUserId: applicant.id,
          recipientUserIds: [applicant.id],
          actorUserId: actor.userId,
        });
      }

      return { type: 'registration' as const, activated };
    }

    // ── Standalone family link?
    // Same lock, same reason (TD-15.3): two admins deciding one link must not
    // both succeed. The id spaces are distinct tables, so this locks nothing
    // when the id was a user.
    await tx.$queryRaw`SELECT id FROM "family_link" WHERE id = ${id}::uuid FOR UPDATE`;

    /**
     * **R68 / §4.3 (R62.9) — the identity-binding review.**
     *
     * The id is a STUDENT's, and the item exists while they hold stamped,
     * approved, live links. Resolved here, after the `User` and `FamilyLink`
     * lookups have both missed, because a student id names neither a pending
     * applicant nor a pending link — and the queue item is the *arrangement*
     * rather than any single row.
     *
     * **Approve means the links stand**; **reject means this person now acts
     * for themselves**, so the links are soft-deleted — §4.3's revocation
     * mechanism since Revision 16. Either way the stamp clears, because the
     * administrator has decided and the item must leave the queue.
     */
    const flagged = await tx.familyLink.findMany({
      where: {
        studentId: id,
        identityReviewRaisedAt: { not: null },
        status: 'approved',
        deletedAt: null,
      },
      // The whole row: a Trash snapshot on rejection needs it, and selecting
      // narrowly here is how a snapshot ends up missing a column (§7).
    });

    if (flagged.length > 0) {
      const now = new Date();
      const linkIds = flagged.map((link) => link.id);

      await tx.familyLink.updateMany({
        where: { id: { in: linkIds } },
        data: {
          identityReviewRaisedAt: null,
          // Rejection revokes: §4.3 (Revision 16) makes the soft delete the
          // revocation, and the child-context middleware answers 404 on the
          // very next request.
          ...(decision.approve ? {} : { deletedAt: now, deletedById: actor.userId }),
        },
      });

      await audit.write(tx, {
        actorUserId: actor.userId,
        activeRole: actor.activeRole,
        // TD-8 (R68) — WHAT WAS DECIDED. The revocation below is what it did;
        // one row would have had to mean both.
        actionType: 'familylink.identity_review',
        targetEntity: 'User',
        targetId: id,
        detail: {
          outcome: decision.approve ? 'links_stand' : 'links_revoked',
          link_ids: linkIds,
          parent_ids: flagged.map((link) => link.parentId),
          ...(decision.reason ? { reason: decision.reason } : {}),
        },
      });

      if (!decision.approve) {
        for (const link of flagged) {
          // **TD-5/§7 — every soft delete writes a Trash snapshot.** Caught by
          // the structural guard rather than by review: the revocation above
          // is a tombstone like any other, and a revoked link with no
          // snapshot is one an administrator could never restore.
          await trash.snapshot(tx, {
            targetEntity: 'FamilyLink',
            targetId: link.id,
            snapshot: JSON.parse(JSON.stringify(link)) as object,
            deletedById: actor.userId,
          });
          await audit.write(tx, {
            actorUserId: actor.userId,
            activeRole: actor.activeRole,
            actionType: 'familylink.revoke',
            targetEntity: 'FamilyLink',
            targetId: link.id,
            detail: {
              parent_id: link.parentId,
              student_id: link.studentId,
              reason: decision.reason ?? 'identity_review',
            },
          });
          await notifySubjectUserChange(tx, {
            type: 'family_link_revoked',
            subjectUserId: link.studentId,
            recipientUserIds: [link.parentId],
            actorUserId: actor.userId,
          });
        }
      }

      return { type: 'identity-review' as const, activated: flagged.length };
    }

    const link = await tx.familyLink.findFirst({
      where: { id, status: 'pending', deletedAt: null },
    });
    if (!link) {
      // Either the id does not exist, or it was already decided — both are
      // STATE_CONFLICT for a decided item and NOT_FOUND for an unknown one.
      const exists = await tx.familyLink.count({ where: { id } });
      const wasUser = await tx.user.count({ where: { id } });
      if (exists > 0 || wasUser > 0) {
        // TD-15.3: two admins deciding the same item — first wins, the second is
        // told plainly and the UI treats it as "already handled, refreshing".
        throw new AppError('STATE_CONFLICT', 'already decided');
      }

      /**
       * **R62.2 — a child-application request is NOT decidable here, and this
       * says so instead of answering `404`.**
       *
       * The queue lists those items under a `request_id`, which names no `User`
       * and no `FamilyLink`, so both lookups above miss and the honest-looking
       * answer was *"no such approval item"* — for an item the queue had just
       * rendered. That is what an administrator actually hit.
       *
       * The deeper rule is R62.2's: TD-4.2 is **narrowed to one child**, so
       * there is no such act as "approve this request". Each child is decided
       * alone, through `POST /admin/child-applications/{id}/decide`. A generic
       * approval here could only ever be the bundle decision R62 removed.
       */
      const childRequest = await tx.childApplication.count({
        where: { requestId: id, status: 'pending', deletedAt: null },
      });
      if (childRequest > 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          'a child-registration request is decided one child at a time (R62.2)',
          { reason: 'DECIDE_PER_CHILD' },
        );
      }

      throw new AppError('NOT_FOUND', 'no such approval item');
    }

    await tx.familyLink.update({
      where: { id: link.id },
      data: {
        status: decision.approve ? 'approved' : 'rejected',
        decidedAt: new Date(),
        decidedById: actor.userId,
        ...(decision.reason ? { decisionReason: decision.reason } : {}),
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: decision.approve ? 'familylink.approve' : 'familylink.reject',
      targetEntity: 'FamilyLink',
      targetId: link.id,
      detail: {
        parent_id: link.parentId,
        student_id: link.studentId,
        ...(decision.reason ? { reason: decision.reason } : {}),
      },
    });

    await notifySubjectUserChange(tx, {
      type: decision.approve ? 'family_link_approved' : 'family_link_rejected',
      subjectUserId: link.studentId,
      recipientUserIds: [link.parentId],
      actorUserId: actor.userId,
    });

    return { type: 'family-link' as const, activated: 1 };
  });
}
