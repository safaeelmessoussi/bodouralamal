import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import { useScopeOptions, wholeCategoryOf, type ScopeField, type ScopeValue } from '../../hooks/use-scope-options.js';
import { Feedback } from '../ui/feedback.js';
import { SelectField } from '../ui/field.js';
import { subjectWorksBySurah } from '../scheduling/surahs.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { t } from '../../i18n/index.js';
import { formatDateWithWeekday } from '../../lib/format-date.js';
import type { UploadMeta } from '../../adapters/uploads.js';

/**
 * **The scope a piece of content is filed under — the fields, and the rules.**
 *
 * Extracted 2026-08-27 for §10, when the **recorder** had to satisfy rule AX
 * too. Both surfaces create the same object under the same four-part scope and
 * the same visibility rule, so this is one implementation and not two:
 *
 * - `ContentUploadForm` — pick a file, or replace one
 * - `ContentRecorderForm` — record audio in the browser (R75)
 *
 * The rule it carries, which is why copying it would have been the wrong move:
 *
 * > §14.1's visibility is proposed **once per Level** and is then the person's.
 * > `null` is *not knowable yet* and renders as a placeholder — **never as
 * > عام**, because a control showing the open tier while holding nothing is how
 * > content gets published by accident. The proposal follows the **form's**
 * > Level, so changing Level re-proposes that Category's default instead of
 * > leaving the previous Level's behind.
 */
export const SCOPE_FIELDS: readonly ScopeField[] = [
  // R172 §1 (the Owner, 2026-09-23) — the Category first, so «كل مستويات
  // الفئة» is one choice away: المرأة → كل مستويات الفئة → الفقه.
  'categoryId',
  'levelId',
  'subjectId',
  // R198 §3 — the Surah lists every Surah of the syllabi and narrows the
  // Levels and Subjects; they narrow it.
  'surahId',
  'academicYearId',
];

/** What the hook loads: the rendered fields, and the Branches the multi-select reads. */
const HOOK_FIELDS: readonly ScopeField[] = [...SCOPE_FIELDS, 'branchId'];

/** `branch_id = null` — Global (§4.9). Kept for the library's FILTER, where
 *  «بدون فرع» narrows to Global items; a form no longer offers it (R198 §2). */
export const GLOBAL = '__global__';

export interface ContentScope {
  /** Rendered by the caller, above whatever produces the bytes. */
  fields: ReactNode;
  /** What the write will be filed under. */
  meta: UploadMeta;
  /**
   * R178 §4 — the title the platform proposes from the scope chosen, in the
   * wording every other title uses: «المادة — سورة X — الخميس 17 شتنبر 2026».
   * Shown in the title field, editable, and followed until the person types.
   */
  suggestedTitle: string;
  /** A curriculum state that must be fixed first, in the person's terms — or `null`. */
  problem: string | null;
  /** Every required field (marked *) holds a value. */
  complete: boolean;
}

export function useContentScope({
  token,
  mayAssignGlobal,
  initial,
  locked = false,
  lockedVisibility,
}: {
  token: string | null;
  mayAssignGlobal: boolean;
  /** Seed values, normally the page's current filters. Read **once**, at mount. */
  initial: Partial<ScopeValue>;
  /**
   * Replacement (R53) keeps the record and swaps only the object, so its scope
   * and visibility are the row's. Still **rendered — disabled rather than
   * hidden** — because the rule is about a person seeing what will be saved,
   * and *"this is fixed"* is exactly what a hidden field fails to say.
   */
  locked?: boolean;
  lockedVisibility?: string;
}): ContentScope {
  const scope = useScopeOptions({
    token,
    fields: HOOK_FIELDS,
    // Seeded from the page's filters, then owned by this form. The Branch is
    // the multi-select's below, never the hook's.
    initial: { ...initial, branchId: '' },
    // R172 §1 — «كل مستويات الفئة» in the Level list, unless the scope is
    // locked (a replacement keeps the record's own Level).
    offerWholeCategory: !locked,
    // A write belongs to the live year; a filter bar deliberately defaults to
    // none, because defaulting a filter silently hides rows.
    defaultCurrentYear: !locked,
    mode: 'form',
  });

  const { levelId, subjectId, academicYearId, surahId } = scope.value;
  const [visibility, setVisibility] = useState<string | null>(lockedVisibility ?? null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);
  const categoryDefault = scope.defaultVisibility;

  /**
   * **R198 §2 — the branches the item is for; none chosen is Global.** The
   * «بدون فرع» choice is withdrawn (it never held: the hook cleared a value
   * its list did not contain). A مؤطِّرة with one branch has it chosen.
   */
  const [branchIds, setBranchIds] = useState<string[]>(() =>
    initial.branchId && initial.branchId !== GLOBAL ? [initial.branchId] : [],
  );
  const branchOptions = scope.options.branchId;
  useEffect(() => {
    if (locked || mayAssignGlobal || branchOptions.length !== 1) return;
    const only = (branchOptions[0] as { value: string }).value;
    setBranchIds((current) => (current.length === 0 ? [only] : current));
  }, [locked, mayAssignGlobal, branchOptions]);
  // A branch no longer offered is not kept (rule 2's discipline).
  const offeredBranches = useMemo(() => new Set(branchOptions.map((o) => o.value)), [branchOptions]);
  const chosenBranches = scope.ready ? branchIds.filter((id) => offeredBranches.has(id)) : branchIds;

  useEffect(() => {
    if (locked) return;
    if (levelId === '') {
      setInitialisedFor(null);
      setVisibility(null);
      return;
    }
    // Not knowable yet — wait rather than propose. Clobbering a selection
    // because a list was still arriving would be worse than showing nothing.
    if (categoryDefault === null) return;
    if (initialisedFor === levelId) return;
    setInitialisedFor(levelId);
    setVisibility(categoryDefault);
  }, [locked, levelId, categoryDefault, initialisedFor]);

  // R172 §1 — «كل مستويات الفئة» in the Level slot files the item for the
  // whole Category, with no Level chosen: `category_id` travels instead.
  const wholeOf = wholeCategoryOf(levelId);
  // R177 §7 — the one Surah, admissible only for a Subject taught by Surah.
  const surahNumber = surahId === '' ? null : Number(surahId);
  const surahApplies = surahNumber !== null && subjectId !== '' && subjectWorksBySurah(scope, subjectId);
  const meta = useMemo<UploadMeta>(
    () => ({
      ...(wholeOf === null ? { level_id: levelId } : { category_id: wholeOf }),
      subject_id: subjectId,
      academic_year_id: academicYearId,
      // R198 §2 — the first is the home branch; `[]` is Global.
      branch_ids: chosenBranches,
      ...(visibility === null || locked
        ? {}
        : { visibility: visibility as 'public' | 'private' | 'hidden' }),
      ...(surahApplies && surahNumber !== null ? { surah_id: surahNumber } : {}),
    }),
    [levelId, wholeOf, subjectId, academicYearId, chosenBranches, visibility, locked, surahApplies, surahNumber],
  );

  const suggestedTitle = useMemo(() => {
    const subject = scope.options.subjectId.find((o) => o.value === subjectId)?.label ?? '';
    const surah = surahApplies && surahNumber !== null ? `سورة ${scope.surahNames[surahNumber] ?? ''}`.trim() : '';
    return [subject, surah, formatDateWithWeekday(new Date().toISOString().slice(0, 10))]
      .filter((part) => part !== '' && part !== 'سورة')
      .join(' — ');
  }, [scope.options.subjectId, scope.surahNames, subjectId, surahNumber, surahApplies]);

  const problem = scope.wholeCategoryTeachesNothing
    ? t('scope.assignWholeCategorySubjectsHint')
    : scope.levelTeachesNothing
      ? t('scope.assignSubjectsHint')
      : null;
  // R198 §3 — what is still missing is said by the fields themselves (*),
  // never by a sentence above the button.
  const complete =
    levelId !== '' && subjectId !== '' && academicYearId !== '' && (mayAssignGlobal || chosenBranches.length > 0);

  // The Surah is offered while it can apply: no Subject yet, or one taught by
  // Surah. A Subject that is not has no Surah to choose.
  const showsSurah = subjectId === '' || subjectWorksBySurah(scope, subjectId);
  const rendered = SCOPE_FIELDS.filter((field) => field !== 'surahId' || (showsSurah && !locked));

  const fields = (
    <>
      <ScopeSelectors
        scope={scope}
        fields={rendered}
        mode="form"
        required={['levelId', 'subjectId', 'academicYearId']}
        {...(locked ? { locked: rendered } : {})}
        blankLabels={{ surahId: t('content.upload.noSurah') }}
      />

      {/* R172 §11 — said HERE, under the selectors, the moment «كل مستويات
          الفئة» is chosen for a Category taught nothing whole: the person is
          choosing the scope now, not saving later. */}
      {scope.wholeCategoryTeachesNothing ? <Feedback>{t('scope.assignWholeCategorySubjectsHint')}</Feedback> : null}

      {/* R198 §2 — several branches, or none (Global). A مؤطِّرة names at
          least one: Global is not hers to assign (§4.9). */}
      <MultiSelectField
        label={t('scope.branch')}
        options={branchOptions}
        selected={chosenBranches}
        onChange={setBranchIds}
        emptyLabel={t('content.upload.noBranch')}
        disabled={locked}
        required={!mayAssignGlobal}
      />

      <SelectField
        label={t('content.col.visibility')}
        value={visibility ?? ''}
        disabled={locked}
        // Honest while unknown: `''` gets a real option so the browser cannot
        // fall back to rendering عام for a state that is actually `null`.
        {...(visibility === null ? { placeholder: t('common.choose') } : {})}
        onChange={setVisibility}
        options={[
          { value: 'public', label: t('content.visibility.public') },
          { value: 'private', label: t('content.visibility.private') },
          { value: 'hidden', label: t('content.visibility.hidden') },
        ]}
        {...(locked ? { hint: t('content.upload.keepsScope') } : {})}
      />
    </>
  );

  return { fields, meta, problem, suggestedTitle, complete };
}
