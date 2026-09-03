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
  /** R130 — `YYYY-MM-DD`. Empty means *not recorded*, which is a real state:
   *  beneficiaries who predate the requirement have no date and none was
   *  invented for them. */
  birthDate: string;
}

export const emptyPerson: PersonForm = {
  firstNameArabic: '',
  lastNameArabic: '',
  firstNameFrench: '',
  lastNameFrench: '',
  nickname: '',
  phone: '',
  sex: '',
  birthDate: '',
};

export function PersonFields({
  value,
  onChange,
  errors,
  prefix,
  phoneRequired = false,
  collectBirthDate,
  birthDateRequired = false,
}: {
  value: PersonForm;
  onChange: (next: PersonForm) => void;
  errors: Record<string, string>;
  /** Namespaces the error keys. Registration uses `applicant`; the back-office
   *  edit uses `user`, and neither needs to know about the other. */
  prefix: string;
  /** Prospective public registrations require contact; legacy profile edits do not. */
  phoneRequired?: boolean;
  /**
   * **R130 — whether this person is a BENEFICIARY**, which is the only thing
   * that decides whether a date of birth is asked for.
   *
   * **Required, deliberately, and not defaulted** (rule AE): a behaviour each
   * caller must remember to opt into is one that will be missing somewhere, and
   * the two answers here are opposite — the public form asks a woman
   * registering herself and must NOT ask a مؤطِّرة or a guardian, while the
   * back office asks on every account because that screen is where a missing
   * legacy date is completed. Making it required means TypeScript refuses a
   * caller that has not decided.
   */
  collectBirthDate: boolean;
  /** Whether the date is REQUIRED once collected. False on the back-office
   *  edit, where a legacy row legitimately has none yet. */
  birthDateRequired?: boolean;
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
      {collectBirthDate ? (
        <TextField
          type="date"
          label={t('register.birthDate')}
          value={value.birthDate}
          onChange={(next) => set({ birthDate: next })}
          hint={t('register.birthDateHint')}
          required={birthDateRequired ?? false}
          error={errors[`${prefix}.birthDate`] ?? null}
        />
      ) : null}
    </>
  );
}
