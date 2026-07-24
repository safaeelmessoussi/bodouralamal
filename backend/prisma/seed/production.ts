import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Visibility } from '../../src/generated/prisma/enums.js';
import { loadConfig } from '../../src/lib/config.js';
import { createPrismaClient } from '../../src/lib/prisma.js';

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
const CATEGORIES = [
  { name: 'المرأة', displayOrder: 1, defaultVisibility: Visibility.public },
  { name: 'اليافعات', displayOrder: 2, defaultVisibility: Visibility.private },
  { name: 'الطفل', displayOrder: 3, defaultVisibility: Visibility.private },
] as const;

/**
 * §15.1/§4.4b levels. Numbering is deliberately NOT uniform across categories —
 * Women 0–7 (0 = literacy), Teens 1–6 (no level 0), Children 0–6. No logic may
 * assume every category has a level 0. `display_order` = the level number
 * within its category.
 */
const LEVELS: Record<string, number[]> = {
  المرأة: [0, 1, 2, 3, 4, 5, 6, 7],
  اليافعات: [1, 2, 3, 4, 5, 6],
  الطفل: [0, 1, 2, 3, 4, 5, 6],
};

/** §15.1 subjects — the Quran is deliberately NOT a Subject (§4.4b). */
const SUBJECTS = [
  { name: 'تفسير', displayOrder: 1 },
  { name: 'فقه', displayOrder: 2 },
  { name: 'محو الأمية', displayOrder: 3 },
] as const;

const ACADEMIC_YEAR = '2026-2027';

interface SurahRow {
  surahId: number;
  nameArabic: string;
  nameTransliterated: string;
  totalAyahs: number;
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

    for (const levelNumber of LEVELS[category.name] ?? []) {
      const levelName = `المستوى ${levelNumber}`;
      const existingLevel = await prisma.level.findFirst({
        where: { name: levelName, categoryId: row.id, deletedAt: null },
      });
      if (!existingLevel) {
        await prisma.level.create({
          data: {
            name: levelName,
            categoryId: row.id,
            displayOrder: levelNumber,
            // §4.4b: checked generically by progression logic, never hardcoded
            // against a level name. Association may narrow it at data entry.
            genderRestriction: 'any',
          },
        });
      }
    }
  }

  const levelCount = await prisma.level.count({ where: { deletedAt: null } });
  console.log(`  categories: ${CATEGORIES.length}, levels: ${levelCount}`);
  return categoryIds;
}

async function seedSubjects(): Promise<void> {
  for (const subject of SUBJECTS) {
    const existing = await prisma.subject.findFirst({
      where: { name: subject.name, deletedAt: null },
    });
    if (!existing) {
      await prisma.subject.create({ data: subject });
    }
  }
  console.log(`  subjects: ${SUBJECTS.length}`);
}

async function seedAcademicYear(): Promise<void> {
  await prisma.academicYear.upsert({
    where: { label: ACADEMIC_YEAR },
    update: {},
    // Exactly one is_current row application-wide is enforced by a partial
    // unique index (TD-6), so re-running can never create a second.
    create: { label: ACADEMIC_YEAR, isCurrent: true },
  });
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
    { key: 'hijri.day_offset', value: 0 },
    // Association grading scale: 10/20 default pass mark, held in basis points
    // so comparisons stay integer-only (§4.6, Revision 14).
    { key: 'grading.display_scale', value: 20 },
    { key: 'grading.passing_grade_bp', value: 5000 },
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

  await seedRoles();
  const categoryIds = await seedCategoriesAndLevels();
  await seedSubjects();
  await seedAcademicYear();
  await seedQuranSurahs();
  await seedSystemSettings(categoryIds);

  // ---------------------------------------------------------------------
  // Super Admin (§15.1) — NOT SEEDED YET, pending a Document Owner decision.
  //
  // §15.1 requires one `active` User pre-provisioned against SUPER_ADMIN_EMAIL,
  // whose Google identity binds on first login (§4.1b step 4b). That step says
  // the `UserIdentity` row is CREATED at binding time, so no identity row
  // exists beforehand — yet §4.1b step 3 must "fall back to matching a
  // pre-provisioned account by verified email". §7 defines `User` with no email
  // column, and email lives only on `UserIdentity`, so there is nowhere to
  // store the pre-provisioned address.
  //
  // Inventing a column would repeat the mistake already corrected once in M1.5
  // (fields added to Category/Level that §7 does not define). Reported to the
  // Document Owner; see docs/CHANGES.log.
  // ---------------------------------------------------------------------
  console.log('\n  super admin: SKIPPED — blocked on an SRS gap (see docs/CHANGES.log)');
  console.log('    §7 gives User no email column, but §4.1b step 3 must match a');
  console.log('    pre-provisioned account by email before any UserIdentity exists.');

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
