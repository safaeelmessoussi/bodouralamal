import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { GenderRestriction, Visibility } from '../../src/generated/prisma/enums.js';
import { loadConfig } from '../../src/lib/config.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import { bootstrapSuperAdmin } from './super-admin.js';

/**
 * Production seed (SRS §15.1) — runs on EVERY fresh deployment (§19.1 step 6)
 * and must therefore be idempotent: safe to re-run, never duplicating rows.
 *
 * Explicitly NOT seeded (§15.1, prohibited): Branches, Rooms, Groups, and the
 * roster. Those are entered manually through the admin UI from real data
 * (§2.3, R-5) — seeding fake branches into production is forbidden.
 *
 * Development fixtures are a separate tier, guarded by NODE_ENV (§15.2).
 */

// Boot-time TD-13 validation applies to the seed too: it must fail fast with a
// named error rather than half-seeding against a missing DATABASE_URL.
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const seedDir = dirname(fileURLToPath(import.meta.url));

/** §15.1 role set. */
const ROLES = ['super_admin', 'admin', 'teacher', 'student', 'parent'] as const;

/** §15.1 categories, ordered per §2.2 `display_order`. */
/**
 * §15.1 categories — **the association's own names** (Document Owner,
 * 2026-09-02; SRS Revision 121): المرأة, اليافعات, الطفل. These are
 * authoritative and are not to be renamed.
 *
 * **Revision 27's rule is unchanged and is a different thing:** a Level's sex
 * restriction lives on `Level.gender_restriction`, paired with `User.sex`, and
 * **never in a category name** — a name is not something a query can read. R27's
 * migration also renamed these to sex-neutral forms, and this docstring used to
 * claim that rename as the seeded reality while the constant below seeded the
 * Owner's names. R121 settles it in favour of the constant.
 *
 * **A fresh deployment is correct**: the R27 rename is guarded by the legacy
 * name, so it finds nothing on an empty table and the seed creates these.
 * **A pre-2026-07-28 upgraded installation is the open case** — there the
 * migration renames the legacy rows and this seed, matching by name, would
 * create the Owner's names as NEW rows. No such installation is known; if one
 * appears it is a data reconciliation and an Owner decision, not a silent
 * change here.
 */
const CATEGORIES = [
  {
    name: 'المرأة',
    description: 'النساء من سن الجامعة الى ما فوق',
    displayOrder: 1,
    defaultVisibility: Visibility.public,
    /**
     * **R123 — the only Category whose beneficiaries may record their own
     * presence.** An adult signs herself in; a teen or a child never does, and
     * the server refuses it regardless of how an occurrence is configured.
     */
    selfAttendanceAllowed: true,
  },
  {
    name: 'اليافعات',
    description: 'البنات اليافعات من سن السنة الأولى اعدادي الى سن السنة الأخيرة ثانوي',
    displayOrder: 2,
    defaultVisibility: Visibility.private,
    selfAttendanceAllowed: false,
  },
  {
    name: 'الطفل',
    description: 'الأطفال اناثا و ذكورا من سن السنة الأخيرة من الروض الى سن السادسة ابتدائي',
    displayOrder: 3,
    defaultVisibility: Visibility.private,
    selfAttendanceAllowed: false,
  },
] as const;

/**
 * NEW L — a Level's description is derived from its position and its Category,
 * never listed, so the two cannot disagree.
 */
const levelDescription = (categoryName: string, position: number): string =>
  `المستوى ${position} - برنامج ${categoryName}`;

/**
 * §15.1/§4.4b levels (NEW L). Each Category has its **own named sequence** —
 * the names are the programme's, not a number scheme, and they are not
 * comparable across Categories, which is exactly why UX rule D requires
 * `{Category} — {Level}` everywhere.
 *
 * Numbering is deliberately NOT uniform: الطفل additionally carries an explicit
 * **المستوى 0**, and اليافعات has none. **No logic may assume every Category has
 * a level 0**, nor that the sequences are the same length. `display_order` is
 * the position within the Category (§2.2 scopes it there).
 *
 * Seeded here as the launch baseline only; afterwards these rows belong to the
 * Super Admin like every other reference row.
 */
const LEVEL_ZERO: Record<string, string> = {
  الطفل: 'المستوى 0',
};

const LEVELS: Record<string, string[]> = {
  المرأة: [
    'وميض الأمل',
    'نور الأمل',
    'ضياء الأمل',
    'بريق الأمل',
    'شعاع الأمل',
    'سراج الأمل',
    'نجمات الأمل',
  ],
  اليافعات: ['نسيم الأمل', 'عبير الأمل', 'أريج الأمل', 'شذى الأمل', 'المستوى 5', 'مسك الأمل'],
  الطفل: [
    'كتاكيت الأمل',
    'براعم الأمل',
    'أشبال الأمل',
    'أجيال الأمل',
    'سواعد الأمل',
    'أبطال الأمل',
    'نجوم الأمل',
  ],
};

const LEVEL_GENDER: Record<string, GenderRestriction> = {
  المرأة: GenderRestriction.girls_only,
  اليافعات: GenderRestriction.girls_only,
  الطفل: GenderRestriction.any,
};

/**
 * §15.1/R107–R108 atomic Subjects. القرآن الكريم is the broader curriculum
 * domain, never a row. This is an additive launch baseline rather than a closed
 * enumeration; only حفظ القرآن authorises §4.5 memorisation entry.
 */
const SUBJECTS = [
  { name: 'أحكام القرآن', displayOrder: 1, tracksQuranProgress: false },
  { name: 'حفظ القرآن', displayOrder: 2, tracksQuranProgress: true },
  { name: 'ترتيل وتجويد القرآن', displayOrder: 3, tracksQuranProgress: false },
  { name: 'تفسير القرآن', displayOrder: 4, tracksQuranProgress: false },
  { name: 'فقه', displayOrder: 5, tracksQuranProgress: false },
  { name: 'السيرة النبوية', displayOrder: 6, tracksQuranProgress: false },
  { name: 'العقيدة', displayOrder: 7, tracksQuranProgress: false },
  { name: 'الأذكار', displayOrder: 8, tracksQuranProgress: false },
] as const;

const MEMORISATION_SUBJECT = SUBJECTS[1];

/**
 * **R110 — the authoritative initial scheduling-type catalogue** (Owner,
 * 2026-08-26).
 *
 * Five rows, three entities. R56 settled the routing and R110 stores it, so
 * `structuralKind` is data on the row rather than something read off the Arabic
 * name — §4.4b forbids that, and a catalogue whose behaviour depended on its
 * label could never be renamed.
 *
 * **`attendanceMode` is the Owner's column, widened by R123** from a boolean to
 * the three states the association actually has: `required` for حصة دراسية and
 * اختبار (the register), `optional` for محاضرة and نشاط (the blank list), and
 * `disabled` for عطلة and حفل — the two the Owner excluded from attendance
 * entirely. It is not derivable: اختبار takes attendance and محاضرة may, and
 * nothing about either word says so.
 *
 * **عطلة is an ordinary schedulable Event** (OD-03), shown on the calendar like
 * any other, with `attendanceMode: 'disabled'`. It is not a suppression
 * mechanism: BR-17 keeps non-teaching activity out of the timetable and §4.4(6)
 * makes a cancellation an edit to a Session row, so **a holiday cancels no
 * class**.
 */
/**
 * **The ratified catalogue** — SRS Revision 110(2) as amended by 110(9).
 *
 * Names, `attendance_required` and `display_order` are R110(2)'s verbatim, and
 * `structural_kind` carries the Owner's amendment of 2026-08-28:
 *
 * * **محاضرة is `class`** — a lecture is taught, so it carries a Subject, a
 *   Level and a teaching mode;
 * * **عطلة is `holiday`**, the fourth kind — it has no staff, no room, no
 *   Subject and no attendance, only which branches and Categories are off;
 * * **نشاط** is the generic `activity` حفل had been carrying alone. Its
 *   `attendance_required = false` is the migration's own explicit value; its
 *   position is the append the amendment specifies, after the original five.
 *
 * Nothing here is inferred: every value is either R110(2)'s or the amendment's.
 */
const SCHEDULING_TYPES = [
  { name: 'حصة دراسية', structuralKind: 'class', attendanceMode: 'required', displayOrder: 1 },
  { name: 'اختبار', structuralKind: 'exam', attendanceMode: 'required', displayOrder: 2 },
  { name: 'محاضرة', structuralKind: 'class', attendanceMode: 'optional', displayOrder: 3 },
  { name: 'حفل', structuralKind: 'activity', attendanceMode: 'disabled', displayOrder: 4 },
  { name: 'عطلة', structuralKind: 'holiday', attendanceMode: 'disabled', displayOrder: 5 },
  { name: 'نشاط', structuralKind: 'activity', attendanceMode: 'optional', displayOrder: 6 },
] as const;

const ACADEMIC_YEAR = '2026-2027';

interface SurahRow {
  surahId: number;
  nameArabic: string;
  nameTransliterated: string;
  totalAyahs: number;
}

/**
 * **Seeded ≠ owned. The seed INITIALIZES; afterwards the database is
 * authoritative** (Owner, 2026-08-27).
 *
 * ## The defect this ends
 *
 * Every catalogue seeder was *"find a live row by that name, else create it"*.
 * That reads as idempotent and is not: a Super Admin who **deletes** a Subject
 * leaves a soft-deleted row, which `deletedAt: null` does not match — so the
 * next deploy **recreated it**. The same held for a Category, a Level and a
 * scheduling type. A catalogue the platform silently restores is not one an
 * administrator manages; it is hardcoded truth wearing a CRUD screen.
 *
 * ## Why a marker rather than a smarter name match
 *
 * Including soft-deleted rows in the lookup would fix deletion alone. It would
 * not fix a **rename** — the Owner's own instruction is that a rerun must not
 * *"overwrite Owner-created catalogue data"*, and a renamed row is invisible to
 * any name-based search, so the old name would come back beside it.
 *
 * One marker per catalogue answers the only question the seed may ask: *has
 * this platform ever been initialized?* Once it has, the seed does not look at
 * that catalogue again — deletions, renames, reorderings and additions are all
 * the administrator's, permanently. A genuinely fresh database still gets its
 * baseline, which is what a seed is for.
 *
 * **`SystemSetting` is the right home**: §15.1 already keeps deployment-scoped
 * configuration there, the row is visible to anyone debugging a deploy, and it
 * needs no schema change.
 */
const SEED_MARKER_PREFIX = 'seed.initialized.';

async function alreadyInitialized(catalogue: string): Promise<boolean> {
  const key = `${SEED_MARKER_PREFIX}${catalogue}`;
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row !== null;
}

async function markInitialized(catalogue: string): Promise<void> {
  const key = `${SEED_MARKER_PREFIX}${catalogue}`;
  await prisma.systemSetting.upsert({
    where: { key },
    update: {},
    create: { key, value: new Date().toISOString() },
  });
}

/**
 * **The one exception that is NOT a catalogue**: a platform whose baseline
 * predates the marker.
 *
 * An installation seeded before 2026-08-27 has the rows but no marker, and
 * re-seeding it would be a no-op anyway — every name already matches. Treating
 * "the catalogue already has rows" as initialized keeps those deployments
 * exactly where they are instead of re-running a baseline against them.
 */
async function initializedByPresence(catalogue: string, count: number): Promise<boolean> {
  if (await alreadyInitialized(catalogue)) return true;
  if (count > 0) {
    await markInitialized(catalogue);
    return true;
  }
  return false;
}

async function seedRoles(): Promise<void> {
  for (const name of ROLES) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log(`  roles: ${ROLES.length}`);
}

/**
 * Structural entities have no unique constraint on `name` in §7, so
 * idempotency is "find by name, else create" rather than an upsert. The seed
 * runs single-threaded at deploy time, so there is no race to guard.
 */
async function seedCategoriesAndLevels(): Promise<Map<string, string>> {
  const categoryIds = new Map<string, string>();

  /**
   * Same rule as the Subjects: initialize once, then leave it alone. The map is
   * still returned — `seedSystemSettings` keys the §4.9 per-Category default on
   * it — so an initialized platform resolves the CURRENT Categories by name
   * rather than the baseline's, and a Category the Owner renamed simply does
   * not appear, which is correct: its default setting is already keyed by id.
   */
  const initialized = await initializedByPresence('categories_levels', await prisma.category.count());
  if (initialized) {
    for (const row of await prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    })) {
      categoryIds.set(row.name, row.id);
    }
    console.log('  categories/levels: already initialized — the database is authoritative');
    return categoryIds;
  }

  for (const category of CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: category.name, deletedAt: null },
    });
    const row =
      existing ??
      (await prisma.category.create({
        data: {
          name: category.name,
          description: category.description,
          displayOrder: category.displayOrder,
          selfAttendanceAllowed: category.selfAttendanceAllowed,
        },
      }));
    categoryIds.set(category.name, row.id);

    // The optional level 0 first, at display_order 0, so the named sequence
    // below stays 1-based and contiguous within the Category (R76.6).
    const zeroName = LEVEL_ZERO[category.name];
    const named = LEVELS[category.name] ?? [];
    const levelPlan: { name: string; displayOrder: number }[] = [
      ...(zeroName ? [{ name: zeroName, displayOrder: 0 }] : []),
      ...named.map((name, index) => ({ name, displayOrder: index + 1 })),
    ];

    for (const level of levelPlan) {
      const levelName = level.name;
      const existingLevel = await prisma.level.findFirst({
        where: { name: levelName, categoryId: row.id, deletedAt: null },
      });
      if (!existingLevel) {
        await prisma.level.create({
          data: {
            name: levelName,
            description: levelDescription(category.name, level.displayOrder),
            categoryId: row.id,
            displayOrder: level.displayOrder,
            // §4.4b/§15.1 Revision 27: the restriction lives HERE, not in the
            // category name, so a query can read it. A Super Admin may add
            // Levels with other restrictions to open further combinations.
            genderRestriction: LEVEL_GENDER[category.name] ?? GenderRestriction.any,
          },
        });
      }
    }
  }

  const levelCount = await prisma.level.count({ where: { deletedAt: null } });
  await markInitialized('categories_levels');
  console.log(`  categories: ${CATEGORIES.length}, levels: ${levelCount}`);
  return categoryIds;
}

/**
 * **NEW N — the association's partners.**
 *
 * ## The names are the Owner's and are NOT in this file
 *
 * `PARTNERS` below is **deliberately empty**, and that is the finished state
 * until the Document Owner supplies the four names. The brief is explicit that
 * nothing about a partner may be invented, and a name is the whole of what this
 * entity holds — a placeholder would put fabricated text on the public landing
 * page, which is the one outcome worse than an absent section.
 *
 * **Nothing is broken by the emptiness.** §5.1's section renders **nothing at
 * all** when no partner is visible, which is the specified behaviour rather than
 * a degraded one, and a Super Admin can add all four through the back office
 * without a deployment. Filling the array in later is a one-line change that
 * affects **fresh installs only**.
 *
 * ## Initialized once, then the database is authoritative
 *
 * The same rule the Subjects follow: after initialization a rerun must not
 * restore a partner the Super Admin deleted, rename one she renamed, or
 * reinstate an ordering she changed.
 */
const PARTNERS: { name: string; displayOrder: number }[] = [];

async function seedPartners(): Promise<void> {
  if (await initializedByPresence('partners', await prisma.partner.count())) {
    console.log('  partners: already initialized — the database is authoritative');
    return;
  }
  if (PARTNERS.length === 0) {
    // NOT an error, and not silent either: a reader running the seed should be
    // told why the table is empty rather than left to wonder.
    console.log('  partners: none seeded — the Owner\'s names are not recorded yet');
    return;
  }
  for (const partner of PARTNERS) {
    await prisma.partner.create({
      data: { name: partner.name, displayOrder: partner.displayOrder },
    });
  }
  console.log(`  partners: ${PARTNERS.length}`);
}

/**
 * **R107(3)'s loud failure — one statement of it, called from two places.**
 *
 * *"A conflicting live marker or duplicate live حفظ القرآن rows makes the seed
 * fail loudly; the seed never silently renames, deletes, or reclassifies
 * Owner-managed historical Subjects."*
 *
 * Read-only. It **decides nothing**: it does not delete a duplicate, merge two
 * rows, rename either, or pick which one the seed meant — guessing among
 * Owner-managed rows is precisely what R107 refuses. It reports the ambiguity
 * by name and stops.
 *
 * Accepts the client or a transaction client so the identical check serves both
 * call sites; a second copy of this rule is a second copy that can drift.
 */
async function assertSubjectsUnambiguous(db: Pick<PrismaClient, 'subject'>): Promise<void> {
  const liveMemorisationSubjects = await db.subject.findMany({
    where: { name: MEMORISATION_SUBJECT.name, deletedAt: null },
    select: { id: true, tracksQuranProgress: true },
  });
  if (liveMemorisationSubjects.length > 1) {
    throw new Error(
      `Production seed requires exactly one live ${MEMORISATION_SUBJECT.name} Subject; found ${liveMemorisationSubjects.length}`,
    );
  }

  const liveTrackers = await db.subject.findMany({
    where: { tracksQuranProgress: true, deletedAt: null },
    select: { id: true, name: true },
  });
  const existingMemorisationSubject = liveMemorisationSubjects[0];
  const conflictingTracker = liveTrackers.find(
    (subject) => subject.id !== existingMemorisationSubject?.id,
  );
  if (conflictingTracker) {
    throw new Error(
      `Production seed cannot move tracks_quran_progress from live Subject ${conflictingTracker.name}; Owner reconciliation is required`,
    );
  }
}

async function seedSubjects(): Promise<void> {
  /**
   * **The ambiguity check runs BEFORE the initialization guard, and that
   * ordering is the requirement** (R107.3).
   *
   * It used to sit inside the transaction below, which the guard returns before
   * ever reaching. So on any already-initialized installation — every real one,
   * after its first deploy — a second live حفظ القرآن row or a marker owned by
   * another Subject produced `subjects: already initialized` and **exit 0**.
   * Measured, not assumed: the two drill assertions that encode R107(3) had
   * been failing for exactly this reason.
   *
   * *"Fail loudly"* is not conditional on how many times the platform has been
   * deployed, and **the marker is not a licence to stop looking**. The check is
   * read-only and decides nothing, so running it first costs one query and
   * cannot itself mutate anything.
   */
  await assertSubjectsUnambiguous(prisma);

  /**
   * **After initialization the Subjects belong to the Super Admin.**
   *
   * R107/R108's baseline is what a *fresh* platform starts with. Once it has
   * been laid down, a rerun must not restore a Subject she deleted, rename one
   * she renamed, or reinstate an ordering she changed — every one of which the
   * old "find by live name, else create" did.
   */
  if (await initializedByPresence('subjects', await prisma.subject.count())) {
    console.log('  subjects: already initialized — the database is authoritative');
    return;
  }

  await prisma.$transaction(async (tx) => {
    /**
     * **Re-asserted inside the transaction**, from the same function. The
     * preflight above is what makes the refusal unconditional; this is what
     * makes the WRITE path's guarantee its own, rather than something inherited
     * from a read taken earlier outside any transaction.
     */
    await assertSubjectsUnambiguous(tx);

    for (const subject of SUBJECTS) {
      const existing = await tx.subject.findFirst({
        where: { name: subject.name, deletedAt: null },
      });
      if (!existing) {
        await tx.subject.create({ data: subject });
      } else if (subject.tracksQuranProgress && !existing.tracksQuranProgress) {
        await tx.subject.update({
          where: { id: existing.id },
          data: { tracksQuranProgress: true },
        });
      }
    }

    const seededTracker = await tx.subject.findMany({
      where: { tracksQuranProgress: true, deletedAt: null },
      select: { name: true },
    });
    if (
      seededTracker.length !== 1 ||
      seededTracker[0]?.name !== MEMORISATION_SUBJECT.name
    ) {
      throw new Error(
        `Production seed must leave exactly one live tracks_quran_progress Subject named ${MEMORISATION_SUBJECT.name}`,
      );
    }
  });
  await markInitialized('subjects');
  console.log(`  subjects: ${SUBJECTS.length}`);
}

/**
 * The scheduling-type catalogue — **additive and idempotent, and it never
 * overwrites an Owner-managed change** (R110, NEW H).
 *
 * *Seeded does not mean immutable*: the seed establishes the initial state and
 * is not a whitelist. So the rule is **find by live name, else create**, and on
 * a second run it changes nothing at all:
 *
 * * a **renamed** row is not found by name and is therefore not restored — it
 *   was renamed on purpose, and re-creating the old name would leave the
 *   administrator with two;
 * * a **reordered** catalogue keeps its order — `displayOrder` is written only
 *   on the create, so the Owner's arrangement survives;
 * * a **re-flagged** row keeps its flag — `attendanceMode` is hers to decide
 *   once the row exists, which is the whole point of it being a column;
 * * a **soft-deleted** row stays deleted, and its name is free for a fresh one.
 *
 * **One preflight, and it is a real ambiguity rather than a tidiness check.**
 * The live-name unique index makes duplicates unrepresentable going forward, so
 * the only way to meet two is a database that predates it — and guessing which
 * of them the seed means is exactly what R107's preflight refuses to do.
 */
async function seedSchedulingTypes(): Promise<void> {
  /**
   * **`count > 0` is not proof that this catalogue is initialized** — the
   * defect this replaces, measured on a fresh database.
   *
   * Migration `20260828190100_holiday_catalogue` inserts **نشاط**
   * unconditionally, and its two corrective `UPDATE`s match nothing on an empty
   * table. So a brand-new installation reaches this function with exactly one
   * row — and the old presence check read that one row as *the catalogue is
   * there*, marked it initialized, and skipped the other five. The result was a
   * launch-ready platform offering **one** scheduling type, on which no class
   * could be scheduled at all, with no error anywhere because no write path was
   * ever reached.
   *
   * **The marker, not the row count, is what says «initialized».** Once this
   * function has completed a reconciliation it records that fact, and every
   * later run returns immediately: *the database is authoritative after
   * initialization* (R110.1) is preserved exactly.
   *
   * **A pre-marker installation is adopted only when the catalogue is
   * COMPLETE.** An install seeded before the markers existed has every
   * canonical name already and must not be re-run over; one that is missing a
   * name is not initialized, whatever its row count. Completeness is judged
   * over live **and** soft-deleted rows, because a deleted type is a decision
   * somebody took, not a gap to fill.
   */
  if (await alreadyInitialized('scheduling_types')) {
    console.log('  scheduling types: already initialized — the database is authoritative');
    return;
  }

  const known = await prisma.schedulingType.findMany({
    where: { name: { in: SCHEDULING_TYPES.map((t) => t.name) } },
    select: { name: true },
  });
  if (known.length === SCHEDULING_TYPES.length) {
    // Every canonical name is accounted for — this is a pre-marker install, and
    // adopting it is what the old presence check was actually for.
    await markInitialized('scheduling_types');
    console.log('  scheduling types: complete before this run — adopted, nothing written');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const type of SCHEDULING_TYPES) {
      /**
       * **Soft-deleted rows are counted here, and that is deliberate.** A type
       * an administrator retired must not reappear on the next deploy — R110's
       * *seeded does not mean immutable* read in the direction that actually
       * costs something. The name is not "free"; it is spoken for by a decision.
       */
      const rows = await tx.schedulingType.findMany({
        where: { name: type.name },
        select: { id: true, deletedAt: true },
      });
      const live = rows.filter((r) => r.deletedAt === null);
      if (live.length > 1) {
        throw new Error(
          `Production seed requires at most one live scheduling type named ${type.name}; found ${live.length}`,
        );
      }
      /**
       * **Present in any form → left exactly as it is.** Not renamed, not
       * re-flagged, not reordered: `attendance_required` and `display_order`
       * are the Owner's once the row exists, which is the whole point of their
       * being columns rather than constants.
       */
      if (rows.length === 0) {
        await tx.schedulingType.create({
          data: {
            name: type.name,
            structuralKind: type.structuralKind,
            attendanceMode: type.attendanceMode,
            displayOrder: type.displayOrder,
          },
        });
      }
    }

    /**
     * **The postcondition, asserted rather than assumed.** A launch-ready
     * installation must be able to schedule all three kinds of thing, and a
     * catalogue that lost its only `class` row would leave الجدولة unable to
     * create a class at all — with no error anywhere, because every write path
     * would simply never be reached.
     */
    const kinds = new Set(
      (
        await tx.schedulingType.findMany({
          where: { deletedAt: null },
          select: { structuralKind: true },
        })
      ).map((r) => r.structuralKind),
    );
    // `holiday` joins the three (R110.9): it is a structural kind with its own
    // write path, so a catalogue without it cannot record a عطلة — the same
    // failure as the other three, for the same reason.
    for (const required of ['class', 'activity', 'exam', 'holiday'] as const) {
      if (!kinds.has(required)) {
        throw new Error(
          `Production seed must leave at least one live scheduling type of kind ${required}`,
        );
      }
    }
  });
  await markInitialized('scheduling_types');
  console.log(`  scheduling types: ${SCHEDULING_TYPES.length} (initial baseline laid once)`);
}

async function seedAcademicYear(): Promise<void> {
  // An academic year rolls over; the baseline's is only the first one. An
  // upsert here would re-assert `is_current` on a year the association has
  // already moved past.
  if (await initializedByPresence('academic_year', await prisma.academicYear.count())) {
    console.log('  academic year: already initialized — the database is authoritative');
    return;
  }

  await prisma.academicYear.upsert({
    where: { label: ACADEMIC_YEAR },
    update: {},
    // Exactly one is_current row application-wide is enforced by a partial
    // unique index (TD-6), so re-running can never create a second.
    create: { label: ACADEMIC_YEAR, isCurrent: true },
  });
  await markInitialized('academic_year');
  console.log(`  academic year: ${ACADEMIC_YEAR} (is_current)`);
}

async function seedQuranSurahs(): Promise<void> {
  const rows = JSON.parse(
    readFileSync(join(seedDir, 'quran-surahs.json'), 'utf-8'),
  ) as SurahRow[];

  // The dataset is the definitive denominator for every coverage calculation
  // (§4.5, BR-13) — a wrong total_ayahs silently corrupts every percentage and
  // every level-completion decision (BR-11), so it is asserted, not trusted.
  if (rows.length !== 114) {
    throw new Error(`quran-surahs.json must contain exactly 114 surahs, found ${rows.length}`);
  }
  const totalAyahs = rows.reduce((sum, row) => sum + row.totalAyahs, 0);
  if (totalAyahs !== 6236) {
    throw new Error(`quran-surahs.json ayah total must be 6236, found ${totalAyahs}`);
  }

  for (const row of rows) {
    await prisma.quranSurah.upsert({
      where: { surahId: row.surahId },
      update: {
        nameArabic: row.nameArabic,
        nameTransliterated: row.nameTransliterated,
        totalAyahs: row.totalAyahs,
      },
      create: row,
    });
  }
  console.log(`  quran surahs: ${rows.length} (${totalAyahs} ayahs)`);
}

/**
 * §15.1 SystemSetting defaults. Per Revision 14 these are settings rows, never
 * columns on Level/Category — §7 defines those entities without them.
 */
async function seedSystemSettings(categoryIds: Map<string, string>): Promise<void> {
  const settings: { key: string; value: unknown }[] = [
    // Hijri overlay offset, constrained to −2…+2 by a CHECK (TD-6).
    // Association grading scale: 10/20 default pass mark, held in basis points
    // so comparisons stay integer-only (§4.6, Revision 14).
  ];

  // Per-Category default content visibility (§4.9, §15.1).
  for (const category of CATEGORIES) {
    const id = categoryIds.get(category.name);
    if (id) {
      settings.push({
        key: `content.default_visibility.category.${id}`,
        value: category.defaultVisibility,
      });
    }
  }

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      // Runtime-editable (TD-13): re-running the seed must NOT clobber a value
      // an Admin has since changed. Only absent keys are created.
      update: {},
      create: { key: setting.key, value: setting.value as object },
    });
  }
  console.log(`  system settings: ${settings.length}`);
}

async function main(): Promise<void> {
  console.log('Production seed (§15.1) — idempotent\n');

  // R107 ambiguity is a deployment stop, so validate/seed Subjects before any
  // other reference-data write. An Owner must never discover a conflicting
  // memorisation marker after this same invocation has changed unrelated data.
  await seedSubjects();
  await seedPartners();
  await seedRoles();
  const categoryIds = await seedCategoriesAndLevels();
  await seedSchedulingTypes();
  await seedAcademicYear();
  await seedQuranSurahs();
  await seedSystemSettings(categoryIds);

  await bootstrapSuperAdmin(prisma, config.SUPER_ADMIN_EMAIL);

  console.log('\nSeed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
