import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ScopeSelectors } from '../scope/scope-selectors.js';
import { useScopeOptions, type ScopeField, type ScopeValue } from '../../hooks/use-scope-options.js';
import { SelectField } from '../ui/field.js';
import { FileUploader } from './file-uploader.js';
import { t } from '../../i18n/index.js';

/**
 * **The Content Upload form, self-contained** (Owner UX rule, 2026-08-25 — rule AX).
 *
 * ## The rule this exists to satisfy
 *
 * > **Every field that materially determines the object being created or edited
 * > must be visible inside that create/edit form.** The form may pre-fill those
 * > fields from the current page filters, but they must still be visible so the
 * > person can understand exactly what will be saved.
 *
 * ## What was wrong
 *
 * The dialog carried a file, a title, a description and a visibility — and then
 * said *«اختاري المستوى والمادة والسنة الدراسية قبل الرفع»* while containing
 * none of those three controls. They lived in the page's **filter** bar, so the
 * form's own instruction pointed at something outside itself, and the upload
 * target was invisible at the moment of saving. A person could not answer *what
 * am I about to create* by reading the form.
 *
 * ## How it is fixed, and why it is not a new mechanism
 *
 * The platform already distinguishes **filter** selectors from **form** ones
 * (rule AE): `mode="form"` makes Subject depend on Level, so a pair the server
 * refuses cannot be offered. This form therefore runs its **own**
 * `useScopeOptions` in form mode, seeded once from the page's filters, and
 * every subsequent change belongs to the form. Nothing here reads page state
 * after mount — which is the actual content of *"do not silently depend on page
 * filters once the form is open"*.
 *
 * ## Authorization is unchanged, and stays the server's
 *
 * The **Global / بدون فرع** option is offered only to callers who may assign it
 * (§4.9); a Teacher choosing it would be refused, and an option that always
 * fails is worse than no option. The branch *field itself* stays visible either
 * way — the rule is that a determining field is never hidden, not that every
 * value is offered. The server decides regardless (rule O).
 */
export interface ContentUploadFormProps {
  token: string | null;
  /** Whether this caller may assign the Global scope (§4.9). Passed in rather
   *  than derived here: a component never decides authorization (rule O). */
  mayAssignGlobal: boolean;
  /** Seed values, normally the page's current filters. Read **once**, at mount. */
  initial: Partial<ScopeValue>;
  /**
   * Replacement (R53) keeps the record and swaps only the object, so its scope
   * and visibility are the row's and are **not editable here**. They are still
   * rendered — disabled rather than hidden — because the rule is about a person
   * being able to see what will be saved, and *"this is fixed"* is exactly the
   * thing a hidden field fails to say.
   */
  replacing?: {
    id: string;
    title: string;
    description: string;
    visibility: string;
  };
  submitLabel: string;
  onUploaded: () => void;
  onCancel: () => void;
}

const FIELDS: readonly ScopeField[] = ['levelId', 'subjectId', 'academicYearId', 'branchId'];

/** `branch_id = null` — a real scope (§4.9), and the one value a branch list can
 *  never contain. `''` already means *not chosen*, so the two cannot share it. */
export const GLOBAL = '__global__';

export function ContentUploadForm({
  token,
  mayAssignGlobal,
  initial,
  replacing,
  submitLabel,
  onUploaded,
  onCancel,
}: ContentUploadFormProps): ReactNode {
  const locked = replacing !== undefined;

  const scope = useScopeOptions({
    token,
    fields: FIELDS,
    // Seeded from the page's filters, then owned by this form.
    initial,
    // A write belongs to the live year; a filter bar deliberately defaults to
    // none, because defaulting a filter silently hides rows.
    defaultCurrentYear: !locked,
    mode: 'form',
  });

  const { levelId, subjectId, academicYearId, branchId } = scope.value;

  /**
   * §14.1's visibility, proposed **once per Level** and then the person's.
   *
   * `null` is *not knowable yet* and renders as a placeholder — never as عام,
   * because a control that displays the open tier while holding nothing is how
   * content gets published by accident. The default follows the **form's**
   * Level, so changing Level here re-proposes that Category's default rather
   * than leaving a stale one behind.
   */
  const [visibility, setVisibility] = useState<string | null>(replacing?.visibility ?? null);
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

  const meta = useMemo(
    () => ({
      level_id: levelId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
      branch_id: branchId === '' || branchId === GLOBAL ? null : branchId,
      ...(visibility === null || locked
        ? {}
        : { visibility: visibility as 'public' | 'private' | 'hidden' }),
      ...(replacing ? { replaces_content_id: replacing.id } : {}),
    }),
    [levelId, subjectId, academicYearId, branchId, visibility, locked, replacing],
  );

  /**
   * Why the upload cannot start yet, in the person's terms — and now naming
   * fields that are **in front of them**, which is what makes it actionable.
   */
  const problem = scope.levelTeachesNothing
    ? t('scope.assignSubjectsHint')
    : levelId === '' || subjectId === '' || academicYearId === ''
      ? t('content.upload.chooseScope')
      : null;

  return (
    <>
      <ScopeSelectors
        scope={scope}
        fields={FIELDS}
        mode="form"
        {...(locked ? { locked: FIELDS } : {})}
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

      <FileUploader
        meta={meta}
        token={token}
        {...(replacing
          ? { initialTitle: replacing.title, initialDescription: replacing.description }
          : {})}
        submitLabel={submitLabel}
        disabledReason={locked ? null : problem}
        onCancel={onCancel}
        onUploaded={onUploaded}
      />
    </>
  );
}
