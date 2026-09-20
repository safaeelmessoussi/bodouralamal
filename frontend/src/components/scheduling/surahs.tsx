import type { ReactNode } from 'react';

import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import { t } from '../../i18n/index.js';
import { SelectField } from '../ui/field.js';
import { MultiSelectField } from '../ui/multi-select.js';

/**
 * **«أي سورة؟» — asked wherever a Subject that works by Surah is scheduled**
 * (SRS Revision 165 §2).
 *
 * Each Level's Surahs are set in «مقرر الحفظ»; حفظ القرآن memorises them and
 * تفسير القرآن studies the same ones. Whether a Subject works by Surah is a
 * column the server sends (`subjectsBySurah`) — no screen reads a Subject's
 * name — and the Surahs on offer are the «مقرر الحفظ» of the Levels the item
 * addresses, which is exactly what the server will hold the choice to
 * (`resolveSurahs`). This module is a convenience over that rule, never the
 * authority on it.
 *
 * One module, used by «إضافة عنصر», the series editor and the occurrence
 * editor, so the three cannot offer different Surahs for the same class.
 */
type SurahFacts = Pick<ScopeOptions, 'subjectsBySurah' | 'levelSurahIds' | 'surahNames'>;

/** The Surahs the named Levels' «مقرر الحفظ» holds, once each, in Mushaf order. */
export function surahChoices(
  facts: Pick<SurahFacts, 'levelSurahIds' | 'surahNames'>,
  levelIds: readonly string[],
): { id: number; name: string }[] {
  const ids = new Set<number>();
  for (const levelId of levelIds) {
    for (const id of facts.levelSurahIds[levelId] ?? []) ids.add(id);
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: facts.surahNames[id] ?? String(id) }));
}

export function subjectWorksBySurah(facts: Pick<SurahFacts, 'subjectsBySurah'>, subjectId: string): boolean {
  return subjectId !== '' && facts.subjectsBySurah.has(subjectId);
}

/** Names for a choice, in Mushaf order — what a title and a summary show. */
export function surahNamesOf(
  facts: Pick<SurahFacts, 'surahNames'>,
  ids: readonly number[],
): string[] {
  return [...ids].sort((a, b) => a - b).map((id) => facts.surahNames[id] ?? String(id));
}

/**
 * A class's Surahs — one or more. `inheritLabel` is what the empty state reads:
 * «اختاري» where a choice is required, or the class's own Surahs where one
 * occurrence may simply keep them.
 */
export function SurahsField({
  facts,
  levelIds,
  selected,
  onChange,
  inheritLabel,
}: {
  facts: SurahFacts;
  levelIds: readonly string[];
  selected: readonly number[];
  onChange: (next: number[]) => void;
  inheritLabel?: string;
}): ReactNode {
  const choices = surahChoices(facts, levelIds);
  return (
    <MultiSelectField
      label={t('scheduling.surahs.label')}
      selected={selected.map(String)}
      onChange={(next) => onChange(next.map(Number).sort((a, b) => a - b))}
      options={choices.map((s) => ({ value: String(s.id), label: s.name }))}
      emptyLabel={inheritLabel ?? t('common.choose')}
      hint={choices.length === 0 ? t('scheduling.surahs.noSyllabus') : t('scheduling.surahs.hint')}
    />
  );
}

/** An exam's one Surah. Any number of exams may examine the same Surah. */
export function SurahField({
  facts,
  levelIds,
  value,
  onChange,
}: {
  facts: SurahFacts;
  levelIds: readonly string[];
  value: number | null;
  onChange: (next: number | null) => void;
}): ReactNode {
  const choices = surahChoices(facts, levelIds);
  return (
    <SelectField
      label={t('scheduling.surahs.examLabel')}
      value={value === null ? '' : String(value)}
      onChange={(next: string) => onChange(next === '' ? null : Number(next))}
      hint={choices.length === 0 ? t('scheduling.surahs.noSyllabus') : t('scheduling.surahs.examHint')}
      options={[
        { value: '', label: t('common.choose') },
        ...choices.map((s) => ({ value: String(s.id), label: s.name })),
      ]}
    />
  );
}

/**
 * **The title «إضافة عنصر» opens with** (Owner, 2026-09-20 — R165 §2): *the type
 * of the session, the Subject, the Surah where there is one, the main teacher,
 * and the date and time*. A suggestion she may overwrite — the form stops
 * following it the moment she types.
 *
 * **A repeating class carries its TIME and not a date.** Its title is
 * snapshotted onto every occurrence (R138), so a date here would print the
 * first session's date on all the others. A one-off carries both.
 */
export function suggestedTitle(parts: {
  typeName: string | null;
  subjectName: string | null;
  surahNames: readonly string[];
  teacherName: string | null;
  date: string;
  time: string | null;
  repeats: boolean;
}): string {
  const when = [parts.repeats ? '' : parts.date, parts.time ?? ''].filter((x) => x !== '').join(' ');
  return [
    parts.typeName ?? '',
    parts.subjectName ?? '',
    parts.surahNames.join('، '),
    parts.teacherName ?? '',
    when,
  ]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' — ');
}
