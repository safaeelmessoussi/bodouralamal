import type { ReactNode } from 'react';

import { SelectField } from '../ui/field.js';
import { t } from '../../i18n/index.js';

/**
 * **مستوى الظهور — one control, one vocabulary, everywhere** (R109, NEW B §D).
 *
 * ## Why this is a component and not three selectors
 *
 * The tier used to belong to نشاط alone, so its control lived inside
 * `ActivitySection`. R109 gave a حصة and an امتحان one too, and an occurrence
 * one of its own — which would have meant the same `<select>`, the same three
 * options and the same three labels written out four times. This project's
 * record on that is unambiguous: **every duplicated rule here has drifted, and
 * the copy that drifts still passes its own tests** (rule C/S).
 *
 * The options are `public | private | hidden` — §4.4's enum, the platform's one
 * vocabulary for the concept. `calendar.visibility*` are the same keys the
 * calendar and the details dialog already render, so a reader meets one word per
 * tier wherever she meets the tier.
 *
 * ## `hidden` is not «nobody»
 *
 * The hint says who actually reads a hidden item — the person responsible for it
 * and a Super Admin (R109) — because an administrator choosing it is making an
 * access decision and *«مخفي»* alone does not say from whom.
 */
export function VisibilityField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Read-only where the caller may not decide it. The server is the authority
   *  regardless (rule O); this only stops offering a refusal. */
  disabled?: boolean;
}): ReactNode {
  return (
    <SelectField
      label={t('admin.calendar.colVisibility')}
      value={value}
      onChange={onChange}
      disabled={disabled}
      hint={t('admin.calendar.visibilityHint')}
      options={[
        { value: 'public', label: t('calendar.visibilityPublic') },
        { value: 'private', label: t('calendar.visibilityPrivate') },
        { value: 'hidden', label: t('calendar.visibilityHidden') },
      ]}
    />
  );
}
