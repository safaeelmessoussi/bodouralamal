import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * The public programme overview — the homepage's "what does the institute
 * teach" section (Owner-reported, 2026-09-14).
 *
 * Separate from the admin taxonomy/reference-data services on the same
 * reasoning `public-branch.service.ts` already states: that service serves
 * the admin screens and reads whatever an Admin is entitled to see; this one
 * serves **anonymous visitors** and returns a fixed, minimal shape — a
 * Category's name and description, each Level's name and description, and
 * each Level's Subject names and حفظ القرآن surah names. Nothing about
 * enrolment counts, gender restriction, visibility defaults or optimistic
 * versions belongs on a public page, so none of it is selected here.
 */
export interface PublicSubjectRef {
  id: string;
  name: string;
}

export interface PublicSurahRef {
  id: number;
  name: string;
}

export interface PublicProgramLevel {
  id: string;
  name: string;
  description: string | null;
  subjects: PublicSubjectRef[];
  surahs: PublicSurahRef[];
}

export interface PublicProgramCategory {
  id: string;
  name: string;
  description: string | null;
  levels: PublicProgramLevel[];
}

export async function listPublicPrograms(prisma: PrismaClient): Promise<PublicProgramCategory[]> {
  // Soft-deleted rows never appear, on the same rule `public-branch.
  // service.ts` already follows: a retired Category/Level/Subject/Surah
  // pairing must not keep advertising a programme nobody may join.
  const categories = await prisma.category.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, description: true },
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
  });
  if (categories.length === 0) return [];

  const levels = await prisma.level.findMany({
    where: { deletedAt: null, categoryId: { in: categories.map((c) => c.id) } },
    select: { id: true, name: true, description: true, categoryId: true },
    // Ordering is scoped within the parent Category (§2.2), same as the
    // admin taxonomy read.
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
  });
  if (levels.length === 0) return categories.map((c) => ({ ...c, levels: [] }));
  const levelIds = levels.map((l) => l.id);

  const [levelSubjects, levelSurahs] = await Promise.all([
    prisma.levelSubject.findMany({
      where: { deletedAt: null, levelId: { in: levelIds }, subject: { deletedAt: null } },
      select: {
        levelId: true,
        subject: { select: { id: true, name: true, displayOrder: true } },
      },
    }),
    prisma.levelSurah.findMany({
      where: { deletedAt: null, levelId: { in: levelIds } },
      select: { levelId: true, surah: { select: { surahId: true, nameArabic: true } } },
    }),
  ]);

  // §2.2's own Subject order, not insertion order — the same list an admin
  // reads on «مواد المستوى».
  const subjectRowsByLevel = new Map<string, typeof levelSubjects>();
  for (const row of levelSubjects) {
    subjectRowsByLevel.set(row.levelId, [...(subjectRowsByLevel.get(row.levelId) ?? []), row]);
  }
  const subjectsByLevel = new Map<string, PublicSubjectRef[]>(
    [...subjectRowsByLevel].map(([levelId, rows]) => [
      levelId,
      rows
        .slice()
        .sort(
          (a, b) =>
            (a.subject.displayOrder ?? Number.MAX_SAFE_INTEGER) -
              (b.subject.displayOrder ?? Number.MAX_SAFE_INTEGER) ||
            a.subject.name.localeCompare(b.subject.name),
        )
        .map((row) => ({ id: row.subject.id, name: row.subject.name })),
    ]),
  );

  const surahsByLevel = new Map<string, PublicSurahRef[]>();
  for (const row of levelSurahs) {
    const list = surahsByLevel.get(row.levelId) ?? [];
    list.push({ id: row.surah.surahId, name: row.surah.nameArabic });
    surahsByLevel.set(row.levelId, list);
  }
  // The Mushaf's own order — the sequence a reader of «مقرر الحفظ» expects,
  // not the order rows happened to be selected for a Level.
  for (const [levelId, list] of surahsByLevel) {
    surahsByLevel.set(
      levelId,
      list.slice().sort((a, b) => a.id - b.id),
    );
  }

  const levelsByCategory = new Map<string, PublicProgramLevel[]>();
  for (const level of levels) {
    const list = levelsByCategory.get(level.categoryId) ?? [];
    list.push({
      id: level.id,
      name: level.name,
      description: level.description,
      subjects: subjectsByLevel.get(level.id) ?? [],
      surahs: surahsByLevel.get(level.id) ?? [],
    });
    levelsByCategory.set(level.categoryId, list);
  }

  return categories.map((category) => ({
    ...category,
    levels: levelsByCategory.get(category.id) ?? [],
  }));
}
