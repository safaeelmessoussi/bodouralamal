import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import { useScopeOptions, type ScopeField, type ScopeValue } from '../../hooks/use-scope-options.js';
import { SelectField } from '../ui/field.js';
import { t } from '../../i18n/index.js';
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
  'levelId',
  'subjectId',
  'academicYearId',
  'branchId',
];

/** `branch_id = null` — a real scope (§4.9), and the one value a branch list can
 *  never contain. `''` already means *not chosen*, so the two cannot share it. */
export const GLOBAL = '__global__';

export interface ContentScope {
  /** Rendered by the caller, above whatever produces the bytes. */
  fields: ReactNode;
  /** What the write will be filed under. */
  meta: UploadMeta;
  /** Why it cannot proceed yet, in the person's terms — or `null`. */
  problem: string | null;
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
    fields: SCOPE_FIELDS,
    // Seeded from the page's filters, then owned by this form.
    initial,
    // A write belongs to the live year; a filter bar deliberately defaults to
    // none, because defaulting a filter silently hides rows.
    defaultCurrentYear: !locked,
    mode: 'form',
  });

  const { levelId, subjectId, academicYearId, branchId } = scope.value;
  const [visibility, setVisibility] = useState<string | null>(lockedVisibility ?? null);
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);
  const categoryDefault = scope.defaultVisibility;

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

  const meta = useMemo<UploadMeta>(
    () => ({
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchId === '' || branchId === GLOBAL ? null : branchId,
      ...(visibility === null || locked
        ? {}
        : { visibility: visibility as 'public' | 'private' | 'hidden' }),
    }),
    [levelId, subjectId, academicYearId, branchId, visibility, locked],
  );

  const problem = scope.levelTeachesNothing
    ? t('scope.assignSubjectsHint')
    : levelId === '' || subjectId === '' || academicYearId === ''
      ? t('content.upload.chooseScope')
      : null;

  const fields = (
    <>
      <ScopeSelectors
        scope={scope}
        fields={SCOPE_FIELDS}
        mode="form"
        {...(locked ? { locked: SCOPE_FIELDS } : {})}
        // Offered only to those who may assign it (§4.9). The field stays
        // visible for everyone; only the value is withheld.
        extraOptions={
          mayAssignGlobal && !locked
            ? { branchId: [{ value: GLOBAL, label: t('content.globalScope') }] }
            : {}
        }
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

  return { fields, meta, problem };
}
