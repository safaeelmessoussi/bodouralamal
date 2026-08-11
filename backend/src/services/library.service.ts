import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import * as scope from '../policies/branch-scope.js';

/**
 * The public Educational Library (SRS TD-3.13, §5.2, §4.9, Revision 43).
 *
 * **Public by design.** An anonymous visitor browses the library without
 * authenticating (§5.2); an individual restricted item still requires login and
 * passes the §4.9 checks before any presigned URL is minted (TD-3.5). *Listing
 * is not the gate — minting is.*
 *
 * ---
 *
 * **Two SRS sentences govern this, and they are not in conflict.** TD-3.13 says
 * an authenticated caller receives *the same set in a different order — ordering
 * only, nothing hidden*. §5.2 (SRS line 53) says *identical filters never means
 * identical results: the three-tier visibility model still filters every result
 * set.* The first sentence is about **personalisation**: signing in reorders,
 * it does not unlock. The second is about **§4.9's tiers**, which apply to
 * everyone and are not personalisation at all. So: the filters and the
 * navigation are identical for everyone, the *tier* a caller can see is a
 * property of who they are, and signing in never *narrows* what is visible.
 *
 * §4.9's three tiers, applied here exactly as written:
 *
 * | Tier | Who sees it in a listing |
 * |---|---|
 * | `public` | Everyone, including anonymous |
 * | `private` | Logged-in students enrolled in the target Level, and parents of such students |
 * | `hidden` | **Excluded from Student/Parent directories** — Admins and Teachers only |
 *
 * ---
 *
 * **Ordering (§5.2): own branch → Global → other branches.** `branch_id IS NULL`
 * is *Global*, not *unknown* (§7), which is why it sorts second rather than
 * last: a platform-wide resource is more relevant to a reader than another
 * branch's local one. A caller with no branch context — anonymous, or a member
 * with no enrolment — has no first bucket, so the ordering degrades to
 * Global-then-the-rest without a special case.
 */

/** The caller as the library sees them. `null` is anonymous. */
export interface LibraryActor {
  userId: string;
  roles: string[];
  roleScopes: readonly { role: string; branches: string[] | null }[];
  accountStatus: string;
  /**
   * Set **only** by the presigned-GET mint (TD-3.5), where §4.3's child context
   * applies and the browsing surface's reasoning does not — see
   * `privateLevelIds`. Already verified against an approved `FamilyLink` by the
   * time it arrives here; this type never resolves it.
   */
  actingStudentId?: string;
}

export interface LibraryFilters extends PageParams {
  categoryId?: string;
  levelId?: string;
  academicYearId?: string;
  subjectId?: string;
}

export interface LibraryItem {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  levelId: string;
  subjectId: string;
  academicYearId: string;
  branchId: string | null;
  mimeType: string;
  sizeBytes: bigint;
  createdAt: Date;
  /**
   * **The labels the ids stand for, resolved here.**
   *
   * §5.2 groups the library **Category → Level → Academic Year → Branch**, and a
   * client cannot render any of those headings from ids alone. There is no
   * public source for the names either: `/admin/subjects` and
   * `/admin/academic-years` are Admin-only by design (R30), and
   * `/calendar/bootstrap` publishes Categories, Levels and Branches but neither
   * Subjects nor Academic Years.
   *
   * So the response carries them, which is the property TD-3.4 already gives the
   * calendar — *self-sufficient, opening an item costs no further request*. The
   * alternatives were worse: widening the calendar's cached payload for an
   * unrelated screen (rejected twice already), or a new public reference surface
   * exposing the whole curriculum to anonymous callers when the library only
   * needs the names of rows it is already returning.
   *
   * **Labels, never identifiers.** The ids above remain what a client filters
   * and links by.
   */
  levelName: string;
  categoryId: string;
  categoryName: string;
  subjectName: string;
  academicYearLabel: string;
  /** `null` is **Global / بدون فرع** (§4.9, BR-20), not unknown. */
  branchName: string | null;
}

/** Staff — Admin, Super Admin or Teacher — are the only ones §4.9 shows `hidden` to. */
function isStaff(actor: LibraryActor): boolean {
  return (
    scope.isSuperAdmin(actor.roleScopes) ||
    scope.hasRole(actor.roleScopes, 'admin') ||
    scope.hasRole(actor.roleScopes, 'teacher')
  );
}

/**
 * The Levels this caller may see `private` content for (§4.9 tier 2).
 *
 * Their own enrolments, **plus those of every child they have an approved
 * `FamilyLink` to** — §4.9 grants the tier to *"Parents of such students"*, and
 * a parent browsing the library is not in a child context: `X-Active-Child-ID`
 * governs acting *as* a child on student-context endpoints, while the library is
 * one shared reading surface (§5.2, "one reader and one permission path"). A
 * parent who could only see a child's materials by switching context would be
 * unable to compare two children's resources at all.
 *
 * **`actingStudentId` narrows this to one child, and only the presigned-GET mint
 * sets it** (TD-3.5). The reasoning above is about *browsing*; minting a URL for
 * a private recording is the safeguarding-sensitive act TD-12 singles out, and
 * §4.3 requires the specific link to be verified on that very request. So the
 * two surfaces genuinely differ, and they differ in the direction that is safe:
 * the narrower rule applies where the file is actually opened.
 */
async function privateLevelIds(prisma: PrismaClient, actor: LibraryActor): Promise<string[]> {
  if (actor.actingStudentId !== undefined) {
    const own = await prisma.enrollment.findMany({
      where: {
        studentId: actor.actingStudentId,
        deletedAt: null,
        administrativeGroup: { deletedAt: null },
      },
      select: { levelId: true },
      distinct: ['levelId'],
    });
    return own.map((e) => e.levelId);
  }

  const links = await prisma.familyLink.findMany({
    where: { parentId: actor.userId, status: 'approved', deletedAt: null },
    select: { studentId: true },
  });
  const studentIds = [actor.userId, ...links.map((l) => l.studentId)];

  const enrolments = await prisma.enrollment.findMany({
    where: {
      studentId: { in: studentIds },
      deletedAt: null,
      administrativeGroup: { deletedAt: null },
    },
    select: { levelId: true },
    distinct: ['levelId'],
  });
  return enrolments.map((e) => e.levelId);
}

/**
 * The branches whose content sorts first for this caller.
 *
 * Resolved through `Enrollment → AdministrativeGroup.branch_id` for a member and
 * through the role scopes for staff — §7 records that `branch_id` on the
 * Administrative Group is *the* answer to "which branch is this person at", and
 * names the §5.2 library ordering as one of the three things that resolve
 * through it.
 */
async function ownBranchIds(prisma: PrismaClient, actor: LibraryActor): Promise<string[]> {
  const staffBranches = scope.reachableBranches(actor.roleScopes, ['admin', 'teacher']);
  // `null` means all-branches (§7, R24). Every branch being "own" would make the
  // ordering meaningless rather than wrong, so such a caller simply gets no
  // first bucket.
  if (staffBranches !== null && staffBranches.length > 0) return staffBranches;

  const enrolments = await prisma.enrollment.findMany({
    where: { studentId: actor.userId, deletedAt: null, administrativeGroup: { deletedAt: null } },
    // R66 — the enrolment carries the branch; it used to be reached through
    // the group, which is why an ungrouped student had none.
    select: { branchId: true },
  });
  return [...new Set(enrolments.map((e) => e.branchId))];
}

/**
 * The §4.9 tier predicate for this caller.
 *
 * **`consent_forced_private` is excluded explicitly rather than trusted to have
 * moved `visibility`** (BR-2). The re-evaluation engine (§4.1a) does set
 * visibility when the gate engages, so on a consistent database this term
 * changes nothing — which is the point: BR-2 calls a recording appearing on a
 * public surface a hard constraint, and a hard constraint that holds only while
 * a background job is up to date is a race, not a constraint.
 */
function tierPredicate(
  actor: LibraryActor | null,
  privateLevels: string[],
): Prisma.Sql {
  // Anonymous, or an account that is not yet approved: the public tier only.
  // A Pending account exists but grants nothing (TD-1).
  if (actor === null || actor.accountStatus !== 'active') {
    return Prisma.sql`(c."visibility" = 'public' AND c."consent_forced_private" = false)`;
  }

  // §4.9 tier 3: hidden is excluded from Student/Parent directories and visible
  // to Admins and Teachers. Staff therefore see all three tiers.
  if (isStaff(actor)) return Prisma.sql`TRUE`;

  if (privateLevels.length === 0) {
    return Prisma.sql`(c."visibility" = 'public' AND c."consent_forced_private" = false)`;
  }
  return Prisma.sql`(
    (c."visibility" = 'public' AND c."consent_forced_private" = false)
    OR (c."visibility" = 'private' AND c."level_id" IN (${Prisma.join(
      privateLevels.map((id) => Prisma.sql`${id}::uuid`),
    )}))
  )`;
}

/**
 * Lists the library (TD-3.13), paginated per TD-10.
 *
 * **Raw SQL, deliberately.** The §5.2 ordering is a three-way bucket —
 * own branch, then Global, then everything else — which is a `CASE` in `ORDER
 * BY`, and Prisma's `orderBy` takes fields rather than expressions. The
 * alternatives were worse: sorting in application code after the fact cannot be
 * combined with `LIMIT`/`OFFSET` without reading the whole table, and running
 * three paginated queries would make a page boundary fall inside a bucket.
 *
 * **The `WHERE` is built once and shared by the page and the count.** Two copies
 * of a visibility predicate is exactly the drift this project has been bitten by
 * before, and here it would show up as a `total` that disagrees with the rows —
 * the kind of bug that looks like an off-by-one in the client.
 */
export async function listLibrary(
  prisma: PrismaClient,
  actor: LibraryActor | null,
  filters: LibraryFilters,
): Promise<Page<LibraryItem>> {
  const privateLevels =
    actor !== null && actor.accountStatus === 'active' && !isStaff(actor)
      ? await privateLevelIds(prisma, actor)
      : [];
  const ownBranches =
    actor !== null && actor.accountStatus === 'active' ? await ownBranchIds(prisma, actor) : [];

  const conditions: Prisma.Sql[] = [
    Prisma.sql`c."deleted_at" IS NULL`,
    tierPredicate(actor, privateLevels),
  ];
  if (filters.levelId) conditions.push(Prisma.sql`c."level_id" = ${filters.levelId}::uuid`);
  if (filters.subjectId) conditions.push(Prisma.sql`c."subject_id" = ${filters.subjectId}::uuid`);
  if (filters.academicYearId) {
    conditions.push(Prisma.sql`c."academic_year_id" = ${filters.academicYearId}::uuid`);
  }
  if (filters.categoryId) {
    // Category reaches content through the Level it owns — content carries no
    // category of its own, and deriving it here keeps §4.4's Category → Level
    // hierarchy the single place that relationship is expressed.
    conditions.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "level" l
        WHERE l."id" = c."level_id" AND l."category_id" = ${filters.categoryId}::uuid
      )`,
    );
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

  // §5.2: own branch (0) → Global (1) → other branches (2). With no own branch
  // the first arm simply never matches, so an anonymous caller gets Global first
  // and then the rest, with no separate code path.
  const bucket =
    ownBranches.length > 0
      ? Prisma.sql`CASE
          WHEN c."branch_id" IN (${Prisma.join(ownBranches.map((id) => Prisma.sql`${id}::uuid`))}) THEN 0
          WHEN c."branch_id" IS NULL THEN 1
          ELSE 2 END`
      : Prisma.sql`CASE WHEN c."branch_id" IS NULL THEN 1 ELSE 2 END`;

  const window = pageWindow(filters);
  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<LibraryItem[]>`
      SELECT c."id",
             c."title",
             c."description",
             c."visibility"::text        AS "visibility",
             c."level_id"                AS "levelId",
             c."subject_id"              AS "subjectId",
             c."academic_year_id"        AS "academicYearId",
             c."branch_id"               AS "branchId",
             c."mime_type"               AS "mimeType",
             c."size_bytes"              AS "sizeBytes",
             c."created_at"              AS "createdAt",
             -- §5.2's headings. INNER joins on level/subject/year because each
             -- FK is NOT NULL and Restrict, so a row without them cannot exist;
             -- the branch is LEFT because NULL there means Global (§4.9), which
             -- is a value rather than a missing one.
             l."name"                    AS "levelName",
             l."category_id"             AS "categoryId",
             cat."name"                  AS "categoryName",
             s."name"                    AS "subjectName",
             y."label"                   AS "academicYearLabel",
             b."name"                    AS "branchName"
      FROM "educational_content" c
      JOIN "level" l          ON l."id"  = c."level_id"
      JOIN "category" cat     ON cat."id" = l."category_id"
      JOIN "subject" s        ON s."id"  = c."subject_id"
      JOIN "academic_year" y  ON y."id"  = c."academic_year_id"
      LEFT JOIN "branch" b    ON b."id"  = c."branch_id"
      ${where}
      -- Newest first within each bucket; the title is the tie-break and is
      -- natively ar-x-icu collated (TD-6a), so no per-query COLLATE (§20 r13).
      ORDER BY ${bucket} ASC, c."created_at" DESC, c."title" ASC
      LIMIT ${window.take} OFFSET ${window.skip}`,
    prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*)::bigint AS "total" FROM "educational_content" c ${where}`,
  ]);

  return page(rows, window, Number(counted[0]?.total ?? 0));
}

/**
 * Which of these content ids the caller may see, under **the same §4.9 tier
 * rule the library list applies**.
 *
 * Exported so the §5.2 Session page does not grow a second expression of that
 * rule. It reuses `tierPredicate` verbatim: one rule, one rendering, and a
 * change to the tiers cannot reach one surface without the other. Writing a
 * Prisma-`where` twin of the predicate for the Session page was the obvious
 * alternative and is exactly the duplication that drifts here.
 */
export async function visibleContentIds(
  prisma: PrismaClient,
  actor: LibraryActor | null,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const privateLevels =
    actor !== null && actor.accountStatus === 'active' && !isStaff(actor)
      ? await privateLevelIds(prisma, actor)
      : [];

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    FROM "educational_content" c
    WHERE c."deleted_at" IS NULL
      AND c."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      AND ${tierPredicate(actor, privateLevels)}`;
  return new Set(rows.map((r) => r.id));
}
