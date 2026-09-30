import type { PrismaClient } from '../generated/prisma/client.js';
import { derivedCategoryAgeRange } from '../policies/age-range.js';

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
  /** R182 §3 — the Subject works by Surah (R165 §2's marker), so the page can
   *  name «حفظ وتفسير» above a Level's Surahs. */
  worksBySurah: boolean;
  /** R183 §1 — a seasonal course (limited period), listed apart from the
   *  programme («دورات موسمية»), never among its Subjects. */
  seasonal: boolean;
}

export interface PublicSurahRef {
  id: number;
  name: string;
}

export interface PublicProgramLevel {
  id: string;
  name: string;
  description: string | null;
  /** R180 §4 — the Level's age range, informational; `null` is «not stated». */
  minAge: number | null;
  maxAge: number | null;
  /** R180 §6 — `step` (the next rung) or `preparatory` (leads into the
   *  Category's first step; not required of those who enter there). */
  journeyRole: 'step' | 'preparatory';
  /** R181 §6 — «مقرر الحفظ» in Hizb, the Owner's measure; `null` is «not stated». */
  memorisationHizb: number | null;
  /** R181 §7 — who the Level admits (§4.4b / R27), so the page can say «للفتيات
   *  فقط» where a Category is: the programme's audience, not operational data. */
  genderRestriction: 'any' | 'girls_only' | 'boys_only';
  subjects: PublicSubjectRef[];
  surahs: PublicSurahRef[];
}

export interface PublicProgramCategory {
  id: string;
  name: string;
  description: string | null;
  /** R180 §4 — DERIVED from the first and last Level (`policies/age-range.ts`);
   *  a Category whose last Level states no end has none. */
  minAge: number | null;
  maxAge: number | null;
  /** R182 §1 — the Subjects taught to EVERY step of the Category (R172 §1),
   *  named once under the Category, never repeated on each Level. */
  subjects: PublicSubjectRef[];
  /** R170 §6 — who holds the login; here only so the page can say «للنساء»
   *  rather than «للفتيات» for an adult Category (R182 §5). */
  holdsOwnLogin: boolean | null;
  levels: PublicProgramLevel[];
}

export async function listPublicPrograms(prisma: PrismaClient): Promise<PublicProgramCategory[]> {
  // Soft-deleted rows never appear, on the same rule `public-branch.
  // service.ts` already follows: a retired Category/Level/Subject/Surah
  // pairing must not keep advertising a programme nobody may join.
  const categories = await prisma.category.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, description: true, holdsOwnLogin: true },
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
  });
  if (categories.length === 0) return [];
  const subjectRef = (subject: {
    id: string;
    name: string;
    requiresSurahs: boolean;
    isSeasonal: boolean;
  }): PublicSubjectRef => ({
    id: subject.id,
    name: subject.name,
    worksBySurah: subject.requiresSurahs,
    seasonal: subject.isSeasonal,
  });
  const bySubjectOrder = (
    a: { displayOrder: number | null; name: string },
    b: { displayOrder: number | null; name: string },
  ): number =>
    (a.displayOrder ?? Number.MAX_SAFE_INTEGER) - (b.displayOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name);

  const levels = await prisma.level.findMany({
    where: { deletedAt: null, categoryId: { in: categories.map((c) => c.id) } },
    select: {
      id: true,
      name: true,
      description: true,
      categoryId: true,
      minAge: true,
      maxAge: true,
      journeyRole: true,
      memorisationHizb: true,
      genderRestriction: true,
    },
    // Ordering is scoped within the parent Category (§2.2), same as the
    // admin taxonomy read.
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
  });
  // R172 §1 / R182 §1 — the Subjects taught to the WHOLE Category, named
  // once under the Category (the curriculum policy still answers them for
  // every step; the page says so once rather than on each Level).
  const categorySubjects = await prisma.categorySubject.findMany({
    where: { deletedAt: null, categoryId: { in: categories.map((c) => c.id) }, subject: { deletedAt: null } },
    select: {
      categoryId: true,
      subject: { select: { id: true, name: true, displayOrder: true, requiresSurahs: true, isSeasonal: true } },
    },
  });
  const subjectsByCategory = new Map<string, PublicSubjectRef[]>();
  for (const category of categories) {
    subjectsByCategory.set(
      category.id,
      categorySubjects
        .filter((row) => row.categoryId === category.id)
        .map((row) => row.subject)
        .sort(bySubjectOrder)
        .map(subjectRef),
    );
  }
  if (levels.length === 0) {
    return categories.map((c) => ({
      ...c,
      minAge: null,
      maxAge: null,
      subjects: subjectsByCategory.get(c.id) ?? [],
      levels: [],
    }));
  }
  const levelIds = levels.map((l) => l.id);

  const [levelSubjects, levelSurahs] = await Promise.all([
    prisma.levelSubject.findMany({
      where: { deletedAt: null, levelId: { in: levelIds }, subject: { deletedAt: null } },
      select: {
        levelId: true,
        subject: { select: { id: true, name: true, displayOrder: true, requiresSurahs: true, isSeasonal: true } },
      },
    }),
    prisma.levelSurah.findMany({
      where: { deletedAt: null, levelId: { in: levelIds } },
      select: { levelId: true, surah: { select: { surahId: true, nameArabic: true } } },
    }),
  ]);

  // §2.2's own Subject order, not insertion order — the same list an admin
  // reads on «مواد المستوى». A Level's OWN Subjects only (R182 §1): the
  // Category's shared ones are said once, under the Category.
  const subjectRowsByLevel = new Map<string, typeof levelSubjects>();
  for (const row of levelSubjects) {
    subjectRowsByLevel.set(row.levelId, [...(subjectRowsByLevel.get(row.levelId) ?? []), row]);
  }
  const subjectsByLevel = new Map<string, PublicSubjectRef[]>(
    [...subjectRowsByLevel].map(([levelId, rows]) => [
      levelId,
      rows
        .map((row) => row.subject)
        .sort(bySubjectOrder)
        .map(subjectRef),
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
      minAge: level.minAge,
      maxAge: level.maxAge,
      journeyRole: level.journeyRole,
      memorisationHizb: level.memorisationHizb,
      genderRestriction: level.genderRestriction,
      subjects: subjectsByLevel.get(level.id) ?? [],
      surahs: surahsByLevel.get(level.id) ?? [],
    });
    levelsByCategory.set(level.categoryId, list);
  }

  return categories.map((category) => {
    const own = levelsByCategory.get(category.id) ?? [];
    return {
      ...category,
      // R180 §4 — the Category's range is its Levels', never a column of its own.
      ...derivedCategoryAgeRange(own),
      subjects: subjectsByCategory.get(category.id) ?? [],
      levels: own,
    };
  });
}
