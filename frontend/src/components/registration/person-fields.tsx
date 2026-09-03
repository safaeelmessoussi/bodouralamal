import type { ReactNode } from 'react';

import { NameFields } from './children.js';
import { TextField } from '../ui/field.js';
import { t } from '../../i18n/index.js';

/**
 * **The person's own details — one form, wherever a person is described.**
 *
 * Extracted from `register.tsx` on 2026-08-28, when المستخدمون's edit dialog had
 * to ask for the same things. It had a single «الاسم» text box writing the
 * **composed** display name, so a staff member retyping a name became the
 * authority on how it reads — the very thing §1.1 composes server-side to
 * prevent — and could not record a French name, a sex, or notes at all.
 *
 * Sharing the component is what keeps the two asking the same questions; sharing
 * the *limits* is `validators/person.ts`'s job on the other side of the wire.
 */
export interface PersonForm {
  firstNameArabic: string;
  lastNameArabic: string;
  firstNameFrench: string;
  lastNameFrench: string;
  nickname: string;
  phone: string;
  sex: '' | 'female' | 'male';
}

export const emptyPerson: PersonForm = {
  firstNameArabic: '',
  lastNameArabic: '',
  firstNameFrench: '',
  lastNameFrench: '',
  nickname: '',
  phone: '',
  sex: '',
};

export function PersonFields({
  value,
  onChange,
  errors,
  prefix,
  phoneRequired = false,
}: {
  value: PersonForm;
  onChange: (next: PersonForm) => void;
  errors: Record<string, string>;
  /** Namespaces the error keys. Registration uses `applicant`; the back-office
   *  edit uses `user`, and neither needs to know about the other. */
  prefix: string;
  /** Prospective public registrations require contact; legacy profile edits do not. */
  phoneRequired?: boolean;
}): ReactNode {
  const set = (patch: Partial<PersonForm>) => onChange({ ...value, ...patch });

  return (
    <>
      <NameFields value={value} onChange={set} errors={errors} prefix={prefix} />
      <TextField
        label={t(phoneRequired ? 'register.phone' : 'register.phoneOptional')}
        type="tel"
        value={value.phone}
        onChange={(next) => set({ phone: next })}
        hint={t('register.phoneHint')}
        error={errors[`${prefix}.phone`] ?? null}
        required={phoneRequired}
      />
    </>
  );
}
