import { useEffect, useState, type ReactNode } from 'react';

import { listAssessmentTargets, type TargetKind } from '../../adapters/assessments.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { SearchInput, SelectField } from '../ui/field.js';

/**
 * **The target picker** (R125) — one control set for all five arms, shared
 * by بناء الاختبارات (choosing a draft's own target) and الجدولة (assigning
 * an occurrence's target at scheduling, R136). Moved out of
 * `pages/admin/assessments.tsx` so a `components/scheduling/` consumer is
 * not importing from a page — the two screens ask the identical question
 * («who is this for») through the identical server-scoped list, and a second
 * picker here would be the drift this platform's own docstrings warn about
 * elsewhere.
 *
 * **Composed from the shared primitives**, not a new picker: `SearchInput` to
 * narrow and `SelectField` to choose, which is the pair `attendance-panel`
 * already uses to add a beneficiary. A bespoke combobox would be a second
 * generic picker for the platform to keep in step.
 *
 * **The list is server-scoped and is not the boundary.** A مؤطِّرة is offered the
 * students she teaches and the occurrences she staffs; an Admin what stays
 * inside her branches. Naming an id the list never contained is refused again on
 * the write — this exists so an author is not shown a target that would be
 * refused, which is the opposite of deciding the permission here (rule O).
 */
export function TargetPicker({
  kind,
  levelId,
  value,
  onChange,
  error,
}: {
  kind: TargetKind;
  levelId: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
}): ReactNode {
  const { accessToken } = useSession();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    void listAssessmentTargets(
      kind,
      { ...(levelId ? { levelId } : {}), ...(query ? { q: query } : {}) },
      accessToken,
    )
      .then((rows) => {
        if (!live) return;
        setOptions(rows);
        setState('ready');
        // A chosen id that the narrowed list no longer offers is cleared rather
        // than left behind — a stale selection is what reaches the server as a
        // target the author can no longer see.
        if (value !== '' && !rows.some((r) => r.id === value)) onChange('');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
    // `onChange` and `value` are deliberately absent from the dependency list:
    // this reloads when the QUESTION changes, not when the answer does. Adding
    // them would refetch on every keystroke of a selection.
  }, [kind, levelId, query, accessToken]);

  return (
    <>
      <SearchInput label={t('assessments.targetSearch')} value={query} onChange={setQuery} />
      <SelectField
        label={t('assessments.targetPick')}
        value={value}
        onChange={onChange}
        required
        error={error}
        hint={
          state === 'ready' && options.length === 0
            ? t('assessments.targetNone')
            : t('assessments.targetHint')
        }
        options={[
          { value: '', label: t('common.notSet') },
          ...options.map((o) => ({ value: o.id, label: o.label })),
        ]}
      />
    </>
  );
}

export const TARGET_LABELS: Record<TargetKind, string> = {
  level: 'assessments.targetLevel',
  administrative_group: 'assessments.targetGroup',
  session: 'assessments.targetSession',
  teaching_group: 'assessments.targetTeachingGroup',
  student: 'assessments.targetStudent',
};
