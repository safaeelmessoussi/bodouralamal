import type { Occurrence } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { occurrenceSurahs, shortSurahList } from '../../lib/surah-list.js';

/**
 * **What a month cell says about an occurrence, and what it leaves unsaid
 * because the filters already say it** (R179 §6, Owner 2026-09-29).
 *
 * With no filter, a chip carries every useful detail the occurrence brings —
 * the Subject, its Surah, the group or circle, the Level, who leads, the
 * branch — in one flow that wraps only when a line is full, so nothing needs
 * the dialog. Once a filter is applied, the detail it fixes is dropped from
 * every chip: under «الفرع: مقر أمرشيش» the branch is obvious on all of them.
 *
 * Pure: the same rule for the public calendar, the back office's calendar view
 * and the personal calendar, each of which passes its own filter values. The
 * server resolved every name here (§7's display-identity invariant; the
 * audience word and the lead are `audience_name`/`lead_name`); this module only
 * decides which of them to show.
 */
export type ChipPart =
  | 'kind'
  | 'subject'
  | 'surah'
  | 'audience'
  | 'category'
  | 'level'
  | 'lead'
  | 'branch';

/**
 * R179 §9 — what a surface knows of the taxonomy, so a class addressed to
 * EVERY Level of a Category reads as the Category («المرأة») rather than as
 * the list of its Levels. Built once per surface from the same list its
 * filters offer (`chipTaxonomy`); absent, Levels are listed as they come.
 */
export interface ChipTaxonomy {
  levelsOfCategory: ReadonlyMap<string, ReadonlySet<string>>;
  categoryNames: ReadonlyMap<string, string>;
}

export function chipTaxonomy(
  levels: readonly { id: string; category_id: string }[],
  categories: readonly { id: string; name: string }[],
): ChipTaxonomy {
  const levelsOfCategory = new Map<string, Set<string>>();
  for (const level of levels) {
    const set = levelsOfCategory.get(level.category_id) ?? new Set<string>();
    set.add(level.id);
    levelsOfCategory.set(level.category_id, set);
  }
  return { levelsOfCategory, categoryNames: new Map(categories.map((c) => [c.id, c.name])) };
}

/** Filter values as every surface's hook holds them: `''`/`undefined` = «الكل». */
export interface ChipFilterValues {
  branchId?: string;
  categoryId?: string;
  levelId?: string;
  subjectId?: string;
  groupId?: string;
  circleId?: string;
  surahId?: string;
  type?: string;
}

/** The parts the active filters make redundant on every chip. */
export function hiddenChipParts(values: ChipFilterValues): ReadonlySet<ChipPart> {
  const hidden = new Set<ChipPart>();
  if (values.branchId) hidden.add('branch');
  // A fixed Level fixes its Category too; a fixed Category leaves the Level open.
  if (values.levelId) hidden.add('level').add('category');
  if (values.categoryId) hidden.add('category');
  if (values.subjectId) hidden.add('subject');
  if (values.surahId) hidden.add('surah');
  if (values.groupId || values.circleId) hidden.add('audience');
  if (values.type) hidden.add('kind');
  return hidden;
}

export interface ChipDetail {
  part: ChipPart;
  text: string;
}

export interface ChipText {
  /** The first, heavier part — what the occurrence IS. */
  head: string;
  /** The rest, in reading order, each shown after « — »; `part` lets a
   *  narrow screen keep the essentials (R179 §10). */
  details: ChipDetail[];
}

/**
 * The audience by Category and Level: every Category whose Levels the
 * occurrence covers WHOLE is named once, in place of those Levels; the other
 * Levels are listed by name; a Category named with no Level at all (an
 * activity scoped to «المرأة») is named as such.
 */
function audienceByLevel(
  occurrence: Occurrence,
  taxonomy: ChipTaxonomy | undefined,
): { categories: string[]; levels: string[] } {
  const levelIds = occurrence.level_ids ?? [];
  const levelNames = occurrence.level_names?.length
    ? occurrence.level_names
    : occurrence.level_name
      ? [occurrence.level_name]
      : [];
  const categoryIds = occurrence.category_ids ?? [];
  const categoryNames = occurrence.category_names ?? [];
  if (levelIds.length === 0) {
    return { categories: levelNames.length === 0 ? categoryNames : [], levels: levelNames };
  }
  const covered = new Set<string>();
  const categories: string[] = [];
  if (taxonomy) {
    const candidates = new Set([
      ...categoryIds,
      ...levelIds.flatMap((id) =>
        [...taxonomy.levelsOfCategory.entries()].filter(([, set]) => set.has(id)).map(([c]) => c),
      ),
    ]);
    for (const categoryId of candidates) {
      const all = taxonomy.levelsOfCategory.get(categoryId);
      if (!all || all.size === 0 || ![...all].every((id) => levelIds.includes(id))) continue;
      categories.push(
        taxonomy.categoryNames.get(categoryId) ??
          categoryNames[categoryIds.indexOf(categoryId)] ??
          '',
      );
      for (const id of all) covered.add(id);
    }
  }
  const levels = levelIds
    .map((id, index) => (covered.has(id) ? null : (levelNames[index] ?? null)))
    .filter((name): name is string => name !== null && name !== '');
  return { categories: categories.filter((name) => name !== ''), levels };
}

/**
 * The chip's words for one occurrence, minus the hidden parts. A class leads
 * with its Subject; a sitting with its type word («اختبار») then its Subject;
 * an activity with its own title. An activity has no Subject, Surah, circle or
 * teacher, so only its Level(s) and branch(es) follow its title.
 */
export function chipText(
  occurrence: Occurrence,
  hidden: ReadonlySet<ChipPart>,
  taxonomy?: ChipTaxonomy,
): ChipText {
  const show = (part: ChipPart): boolean => !hidden.has(part);
  const audience = audienceByLevel(occurrence, taxonomy);
  const byLevel: ChipDetail[] = [
    ...audience.categories.map((text) => ({ part: 'category' as const, text })),
    ...audience.levels.map((text) => ({ part: 'level' as const, text })),
  ];
  const branches = occurrence.branch_names?.length
    ? occurrence.branch_names
    : occurrence.branch_name
      ? [occurrence.branch_name]
      : [];
  // R208 — one part for the Surahs: the occurrence's own, else its Level's
  // when the Subject works by Surah; in full up to four, else «الأولى … الأخيرة».
  const surahList = occurrenceSurahs(occurrence);
  const surahs =
    surahList.length === 0
      ? []
      : [
          surahList.length === 1
            ? t('calendar.chipSurah').replace('{surah}', surahList[0]!)
            : t('calendar.chipSurahs').replace('{surahs}', shortSurahList(surahList)),
        ];

  if (occurrence.kind === 'event') {
    return {
      head: occurrence.title,
      details: [
        ...byLevel.filter((row) => show(row.part)),
        ...(show('branch') ? branches.map((text) => ({ part: 'branch' as const, text })) : []),
      ],
    };
  }

  const kindWord =
    occurrence.kind === 'exam'
      ? (occurrence.scheduling_type_name ?? t('calendar.kindExam'))
      : null;
  const subject = occurrence.subject_name;
  const ordered: { part: ChipPart; text: string | null }[] = [
    { part: 'kind', text: kindWord },
    { part: 'subject', text: subject },
    ...surahs.map((text) => ({ part: 'surah' as const, text })),
    { part: 'audience', text: occurrence.audience_name ?? null },
    ...byLevel,
    { part: 'lead', text: occurrence.lead_name ?? null },
    ...branches.map((text) => ({ part: 'branch' as const, text })),
  ];
  const shown = ordered.filter(
    (row): row is ChipDetail => row.text !== null && row.text !== '' && show(row.part),
  );
  // Nothing left to lead with (every part filtered away, or a server without
  // these fields): the composed title still names the occurrence.
  if (shown.length === 0) return { head: occurrence.title, details: [] };
  return { head: shown[0]!.text, details: shown.slice(1) };
}
