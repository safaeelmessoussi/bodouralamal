import type { Occurrence } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';

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
export type ChipPart = 'kind' | 'subject' | 'surah' | 'audience' | 'level' | 'lead' | 'branch';

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
  if (values.levelId) hidden.add('level');
  if (values.subjectId) hidden.add('subject');
  if (values.surahId) hidden.add('surah');
  if (values.groupId || values.circleId) hidden.add('audience');
  if (values.type) hidden.add('kind');
  return hidden;
}

export interface ChipText {
  /** The first, heavier part — what the occurrence IS. */
  head: string;
  /** The rest, in reading order, each shown after « — ». */
  details: string[];
}

/**
 * The chip's words for one occurrence, minus the hidden parts. A class leads
 * with its Subject; a sitting with its type word («اختبار») then its Subject;
 * an activity with its own title. An activity has no Subject, Surah, circle or
 * teacher, so only its Level(s) and branch(es) follow its title.
 */
export function chipText(occurrence: Occurrence, hidden: ReadonlySet<ChipPart>): ChipText {
  const show = (part: ChipPart): boolean => !hidden.has(part);
  const levels = occurrence.level_names?.length
    ? occurrence.level_names
    : occurrence.level_name
      ? [occurrence.level_name]
      : [];
  const branches = occurrence.branch_names?.length
    ? occurrence.branch_names
    : occurrence.branch_name
      ? [occurrence.branch_name]
      : [];
  const surahs = (occurrence.surah_names ?? []).map((name) =>
    t('calendar.chipSurah').replace('{surah}', name),
  );

  if (occurrence.kind === 'event') {
    return {
      head: occurrence.title,
      details: [
        ...(show('level') ? levels : []),
        ...(show('branch') ? branches : []),
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
    ...levels.map((text) => ({ part: 'level' as const, text })),
    { part: 'lead', text: occurrence.lead_name ?? null },
    ...branches.map((text) => ({ part: 'branch' as const, text })),
  ];
  const shown = ordered
    .filter((row): row is { part: ChipPart; text: string } => row.text !== null && row.text !== '' && show(row.part))
    .map((row) => row.text);
  // Nothing left to lead with (every part filtered away, or a server without
  // these fields): the composed title still names the occurrence.
  if (shown.length === 0) return { head: occurrence.title, details: [] };
  return { head: shown[0]!, details: shown.slice(1) };
}
