import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * §15.1 categories — **generic educational stages (Revision 27)**. Sex is never
 * encoded in a category name: it lives on `Level.gender_restriction`, paired
 * with `User.sex`. The legacy names المرأة / اليافعات are renamed in place by
 * the Revision-27 migration, so an upgraded deployment matches these names here
 * and no duplicate categories are created.
 */
const CATEGORIES = [
  { name: 'المرأة', displayOrder: 1, defaultVisibility: Visibility.public },
  { name: 'اليافعات', displayOrder: 2, defaultVisibility: Visibility.private },
  { name: 'الطفل', displayOrder: 3, defaultVisibility: Visibility.private },
] as const;

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
 * **`attendanceRequired` is the Owner's column, verbatim**: نعم for حصة دراسية
 * and اختبار, لا for the other three. It is not derivable — اختبار takes
 * attendance and محاضرة does not, and nothing about either word says so.
 *
 * **عطلة is an ordinary schedulable Event** (OD-03), shown on the calendar like
 * any other, with `attendanceRequired: false`. It is not a suppression
 * mechanism: BR-17 keeps non-teaching activity out of the timetable and §4.4(6)
 * makes a cancellation an edit to a Session row, so **a holiday cancels no
 * class**.
 */
const SCHEDULING_TYPES = [
  { name: 'حصة دراسية', structuralKind: 'class', attendanceRequired: true, displayOrder: 1 },
  { name: 'اختبار', structuralKind: 'exam', attendanceRequired: true, displayOrder: 2 },
  { name: 'محاضرة', structuralKind: 'activity', attendanceRequired: false, displayOrder: 3 },
  { name: 'حفل', structuralKind: 'activity', attendanceRequired: false, displayOrder: 4 },
  { name: 'عطلة', structuralKind: 'activity', attendanceRequired: false, displayOrder: 5 },
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
        data: { name: category.name, displayOrder: category.displayOrder },
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

async function seedSubjects(): Promise<void> {
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
    // Fail before writing if existing Owner-managed reference data is
    // ambiguous. The seed may complete a correctly named حفظ القرآن row by
    // attaching its structural marker, but it never guesses among duplicates
    // or silently moves a marker from another Subject.
    const liveMemorisationSubjects = await tx.subject.findMany({
      where: { name: MEMORISATION_SUBJECT.name, deletedAt: null },
      select: { id: true, tracksQuranProgress: true },
    });
    if (liveMemorisationSubjects.length > 1) {
      throw new Error(
        `Production seed requires exactly one live ${MEMORISATION_SUBJECT.name} Subject; found ${liveMemorisationSubjects.length}`,
      );
    }

    const liveTrackers = await tx.subject.findMany({
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
 * * a **re-flagged** row keeps its flag — `attendanceRequired` is hers to
 *   decide once the row exists, which is the whole point of it being a column;
 * * a **soft-deleted** row stays deleted, and its name is free for a fresh one.
 *
 * **One preflight, and it is a real ambiguity rather than a tidiness check.**
 * The live-name unique index makes duplicates unrepresentable going forward, so
 * the only way to meet two is a database that predates it — and guessing which
 * of them the seed means is exactly what R107's preflight refuses to do.
 */
async function seedSchedulingTypes(): Promise<void> {
  // Same rule: the five rows are a starting point, not a whitelist (R110).
  if (await initializedByPresence('scheduling_types', await prisma.schedulingType.count())) {
    console.log('  scheduling types: already initialized — the database is authoritative');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const type of SCHEDULING_TYPES) {
      const live = await tx.schedulingType.findMany({
        where: { name: type.name, deletedAt: null },
        select: { id: true },
      });
      if (live.length > 1) {
        throw new Error(
          `Production seed requires at most one live scheduling type named ${type.name}; found ${live.length}`,
        );
      }
      if (live.length === 0) {
        await tx.schedulingType.create({
          data: {
            name: type.name,
            structuralKind: type.structuralKind,
            attendanceRequired: type.attendanceRequired,
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
    for (const required of ['class', 'activity', 'exam'] as const) {
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
