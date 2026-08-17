import type { ReactNode } from 'react';

import { LIMITS, type ChildInput } from '../../adapters/registrations.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { SelectField, TextField } from '../ui/field.js';

/**
 * **The child section of a registration — one implementation, two entry
 * points** (§4.1, R62, R65).
 *
 * Two flows create `ChildApplication` rows: the public `/register` form, where a
 * family arrives at once, and `/profile/register-child`, where someone already
 * on the platform adds more. R62 unified the *service* behind them and left the
 * *forms* separate, and they immediately diverged — the personal one lost the
 * repeatable section, so a parent with three children submitted three times
 * while the public form took them in one request.
 *
 * That is the same class of divergence R64 was written to repair (the earlier
 * dialog collected no branch and no stage). One shape is the only durable fix,
 * so the fields, the add/remove behaviour, the cap and the validation live
 * **here** and both pages compose them.
 *
 * What deliberately stays with each page: the *request-level* answers. The
 * public form asks one branch and one stage for the whole family; the personal
 * page asks them per request. Those belong to the surrounding form, not to a
 * child.
 */

export interface ChildForm {
  firstNameArabic: string;
  lastNameArabic: string;
  firstNameFrench: string;
  lastNameFrench: string;
  nickname: string;
  sex: '' | 'female' | 'male';
  schoolingStage: '' | NonNullable<ChildInput['schooling_stage']>;
  /** Three-state: an unanswered release is not a refused one (BR-1). */
  mediaRelease: '' | 'yes' | 'no';
  /** R67 — this child's own. They were one answer for the whole family. */
  branchId: string;
  categoryId: string;
}

export const EMPTY_CHILD: ChildForm = {
  firstNameArabic: '',
  lastNameArabic: '',
  firstNameFrench: '',
  lastNameFrench: '',
  nickname: '',
  sex: '',
  schoolingStage: '',
  mediaRelease: '',
  branchId: '',
  categoryId: '',
};

/** The stages R62.7 defines, in the order a school year runs. */
export const SCHOOLING_STAGES: NonNullable<ChildInput['schooling_stage']>[] = [
  'pre_primary',
  'primary',
  'middle',
  'high',
  'post_secondary',
  'not_in_school',
];

/**
 * The name inputs every person has, wherever they appear (§2.1 — one component
 * per *concept*).
 *
 * Shared with the applicant's own fieldset: R62 made the two shapes genuinely
 * different — a child has no phone and no notes, and has a schooling stage and
 * a media release that an adult does not — so the split is along that seam and
 * **only** along it. The six name inputs still exist once.
 */
export function NameFields({
  value,
  onChange,
  errors,
  prefix,
}: {
  value: {
    firstNameArabic: string;
    lastNameArabic: string;
    firstNameFrench: string;
    lastNameFrench: string;
    nickname: string;
    sex: '' | 'female' | 'male';
  };
  onChange: (patch: Record<string, string>) => void;
  errors: Record<string, string>;
  prefix: string;
}): ReactNode {
  const set = (patch: Record<string, string>) => onChange(patch);

  return (
    <>
      {/* Revision 40 — الاسم الشخصي and الاسم العائلي, matching how Moroccan
          administrative records read. */}
      <TextField
        label={t('register.firstNameArabic')}
        value={value.firstNameArabic}
        onChange={(next) => set({ firstNameArabic: next })}
        required
        error={errors[`${prefix}.firstNameArabic`] ?? null}
      />
      <TextField
        label={t('register.lastNameArabic')}
        value={value.lastNameArabic}
        onChange={(next) => set({ lastNameArabic: next })}
        required
        error={errors[`${prefix}.lastNameArabic`] ?? null}
      />
      <SelectField
        label={t('register.sex')}
        value={value.sex}
        onChange={(next) => set({ sex: next })}
        placeholder={t('common.choose')}
        options={[
          { value: 'female', label: t('register.sexFemale') },
          { value: 'male', label: t('register.sexMale') },
        ]}
        required
        error={errors[`${prefix}.sex`] ?? null}
      />
      {/* Revision 41 — split like the Arabic pair. Optional as a PAIR. */}
      <TextField
        label={t('register.firstNameFrench')}
        value={value.firstNameFrench}
        onChange={(next) => set({ firstNameFrench: next })}
        error={errors[`${prefix}.firstNameFrench`] ?? null}
      />
      <TextField
        label={t('register.lastNameFrench')}
        value={value.lastNameFrench}
        onChange={(next) => set({ lastNameFrench: next })}
        error={errors[`${prefix}.lastNameFrench`] ?? null}
      />
      <TextField
        label={t('register.nickname')}
        value={value.nickname}
        onChange={(next) => set({ nickname: next })}
        hint={t('register.nicknameHint')}
      />
    </>
  );
}

/**
 * One child: the shared names, plus the two decisions R62 makes per child.
 *
 * **No phone and no notes**, because `childCore` does not accept them — the
 * absence here is what stops the form collecting what the platform declared it
 * would not (R62.1).
 */
export function ChildFields({
  value,
  onChange,
  errors,
  prefix,
  branches,
  categories,
}: {
  value: ChildForm;
  onChange: (next: ChildForm) => void;
  errors: Record<string, string>;
  prefix: string;
  /** R67 — asked per child, so both lists reach every child's fieldset. */
  branches: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}): ReactNode {
  const set = (patch: Partial<ChildForm>) => onChange({ ...value, ...patch });

  return (
    <>
      <NameFields value={value} onChange={set} errors={errors} prefix={prefix} />

      {/* R62.7 — optional, and it INFORMS the placement decision rather than
          making it. The hint says so, because a parent who thinks this decides
          the Category will answer strategically rather than truthfully. */}
      <SelectField
        label={t('register.schoolingStage')}
        value={value.schoolingStage}
        onChange={(next) => set({ schoolingStage: next as ChildForm['schoolingStage'] })}
        placeholder={t('register.schoolingStageChoose')}
        options={SCHOOLING_STAGES.map((stage) => ({
          value: stage,
          label: t(`register.schoolingStage_${stage}`),
        }))}
        hint={t('register.schoolingStageHint')}
      />

      {/* R67 — **this child's** branch and stage. They used to be one answer
          for the whole family, copied onto every application, so a parent could
          not ask for two children at two branches or two stages. Both are
          requests, never placements: the approver decides where each child
          actually goes (R39, R66.5). */}
      <SelectField
        label={t('register.branchLabel')}
        value={value.branchId}
        onChange={(next) => set({ branchId: next })}
        placeholder={t('register.branchEmpty')}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        required
        hint={t('register.branchHint')}
        error={errors[`${prefix}.branchId`] ?? null}
      />
      <SelectField
        label={t('register.categoryLabel')}
        value={value.categoryId}
        onChange={(next) => set({ categoryId: next })}
        placeholder={t('register.categoryEmpty')}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        required
        hint={t('register.categoryHint')}
        error={errors[`${prefix}.categoryId`] ?? null}
      />

      <SelectField
        label={t('register.consentMedia')}
        value={value.mediaRelease}
        onChange={(next) => set({ mediaRelease: next as ChildForm['mediaRelease'] })}
        placeholder={t('register.consentMediaChoose')}
        options={[
          { value: 'yes', label: t('common.yes') },
          { value: 'no', label: t('common.no') },
        ]}
        required
        // Declining is a real, recorded decision — never an omission. BR-1
        // treats an absent record as refusal, so "no" and "unanswered" must be
        // different answers here.
        hint={t('register.consentMediaHint')}
        error={errors[`${prefix}.mediaRelease`] ?? null}
      />
    </>
  );
}

/**
 * **The repeatable section: one or more children, added and removed together**
 * (R62.1).
 *
 * The cap mirrors the server's for immediate feedback (§1.1 — the server still
 * enforces it); past it the control disappears rather than failing on submit.
 * Removal is offered only from the second child onward, because removing the
 * only one would leave a request with no child, which the server refuses.
 */
export function ChildrenFieldset({
  children,
  onChange,
  errors,
  touched,
  branches,
  categories,
}: {
  children: ChildForm[];
  onChange: (next: ChildForm[]) => void;
  errors: Record<string, string>;
  touched: boolean;
  branches: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}): ReactNode {
  return (
    <>
      {children.map((entry, index) => (
        <fieldset className="register-form__group" key={index}>
          <legend>
            {children.length === 1
              ? t('register.child')
              : `${t('register.child')} ${index + 1}`}
          </legend>
          <ChildFields
            value={entry}
            onChange={(next) => onChange(children.map((c, i) => (i === index ? next : c)))}
            errors={touched ? errors : {}}
            prefix={`children.${index}`}
            branches={branches}
            categories={categories}
          />
          {children.length > 1 ? (
            <div className="register-form__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onChange(children.filter((_, i) => i !== index))}
              >
                {t('register.childRemove')}
              </Button>
            </div>
          ) : null}
        </fieldset>
      ))}

      <div className="register-form__actions">
        {children.length < LIMITS.childrenPerRequest ? (
          <Button
            type="button"
            variant="add"
            onClick={() => onChange([...children, EMPTY_CHILD])}
          >
            {t('register.childAdd')}
          </Button>
        ) : null}
      </div>
    </>
  );
}

/**
 * The rules both flows apply, keyed `children.<i>.<field>` so a rejected
 * submission marks the right sibling — the same paths the server's Zod issues
 * carry (§1.1: this is immediate feedback, not the authority).
 */
export function validateChildren(children: ChildForm[]): Record<string, string> {
  const errors: Record<string, string> = {};

  children.forEach((child, index) => {
    const prefix = `children.${index}`;
    for (const part of ['firstNameArabic', 'lastNameArabic'] as const) {
      const raw = child[part].trim();
      if (raw === '') errors[`${prefix}.${part}`] = t('register.errRequired');
      else if (raw.length > LIMITS.namePart) errors[`${prefix}.${part}`] = t('register.errTooLong');
    }
    if (child.sex === '') errors[`${prefix}.sex`] = t('register.errRequired');

    // R41: both French parts or neither. Half a name is not a name, and the
    // server refuses it — so the form says which half is missing.
    const first = child.firstNameFrench.trim();
    const last = child.lastNameFrench.trim();
    if (first !== '' && last === '') errors[`${prefix}.lastNameFrench`] = t('register.errFrenchPair');
    if (last !== '' && first === '') errors[`${prefix}.firstNameFrench`] = t('register.errFrenchPair');

    // A DECISION is required per child; "no" is a valid one (BR-1). R62.3b put
    // it on the child rather than the family, so it is checked per child too.
    if (child.mediaRelease === '') {
      errors[`${prefix}.mediaRelease`] = t('register.errMediaDecision');
    }
    // R67 — a choice per child, never a default: defaulting would ask for a
    // branch or a stage nobody picked, for a specific child.
    if (child.branchId === '') errors[`${prefix}.branchId`] = t('register.errBranch');
    if (child.categoryId === '') errors[`${prefix}.categoryId`] = t('register.errCategory');
  });

  return errors;
}

/** The wire shape, from the form shape. One translation, both flows. */
export function toChildInput(child: ChildForm): ChildInput {
  return {
    first_name_arabic: child.firstNameArabic.trim(),
    last_name_arabic: child.lastNameArabic.trim(),
    sex: child.sex as 'female' | 'male',
    ...(child.firstNameFrench.trim() && child.lastNameFrench.trim()
      ? {
          first_name_french: child.firstNameFrench.trim(),
          last_name_french: child.lastNameFrench.trim(),
        }
      : {}),
    ...(child.nickname.trim() ? { nickname: child.nickname.trim() } : {}),
    ...(child.schoolingStage ? { schooling_stage: child.schoolingStage } : {}),
    // R62.3b — always sent: validation refuses the form until every child has
    // an answer, so an unanswered release cannot reach here.
    consent_media_release: child.mediaRelease === 'yes',
    // R67 — this child's own request, validated above.
    requested_branch_id: child.branchId,
    requested_category_id: child.categoryId,
  };
}
