import type { ReactNode } from 'react';

import { SelectField } from '../ui/field.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { t } from '../../i18n/index.js';
import type { UserSummary } from '../../adapters/users.js';

/**
 * **One lead مؤطرة, and any number of assistants.**
 *
 * The same shape three parts of the platform need and, until R71, two of them
 * had written out longhand:
 *
 * | | Lead | Where |
 * |---|---|---|
 * | A course schedule | `teacher` | §4.4c, R43 |
 * | An exam sitting | `supervisor` | §4.6, R58 |
 * | An event | `responsible` | §4.4, **R71** |
 *
 * **The lead's NAME differs and that is deliberate** — §20 rule 22: a مؤطرة who
 * supervises an exam is not teaching it, and one responsible for a celebration
 * is doing neither. The *control* is identical, so it is shared; the *word* is
 * passed in, so the vocabulary stays each feature's own.
 *
 * **The lead is excluded from the assistant list.** One person holds one
 * position on one thing, and every server refuses the pair as a duplicate — so
 * offering somebody as both is offering a refusal.
 *
 * This renders no fieldset wrapper of its own beyond the assistants' one,
 * because it is composed into sections that already own their layout.
 */
export interface StaffPickerProps {
  staff: UserSummary[];
  /** The label for the single lead — «المشرفة», «المسؤولة», «المؤطِّرة». */
  leadLabel: string;
  leadId: string;
  onLead: (id: string) => void;
  assistantsLabel: string;
  assistantsHint: string;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
  /** Rendered read-only for a caller who may see the assignment and not set it
   *  — R71.4 keeps event staffing with Admins, and the server enforces it. */
  disabled?: boolean;
}

export function StaffPicker({
  staff,
  leadLabel,
  leadId,
  onLead,
  assistantsLabel,
  assistantsHint,
  assistantIds,
  onAssistants,
  disabled = false,
}: StaffPickerProps): ReactNode {
  return (
    <>
      <SelectField
        label={leadLabel}
        value={leadId}
        onChange={onLead}
        disabled={disabled}
        options={[
          { value: '', label: t('common.choose') },
          ...staff.map((x) => ({ value: x.id, label: x.name_arabic })),
        ]}
      />

      {/* **The assistants are a multi-select, not an expanded list** (2026-08-13).
          Every person rendered as a checkbox reads fine for a handful and turns
          the form into a page of checkboxes for a real roster — burying the
          fields below it. `MultiSelectField` shows the chosen as chips and
          filters the rest, so the control's height stops tracking the size of
          the association.

          **The lead is excluded here, not there**: one person holds one
          position on one thing, and the server refuses the pair as a duplicate,
          so offering somebody as both would be offering a refusal. The atomic
          control has no opinion about *why* an option is absent. */}
      <MultiSelectField
        label={assistantsLabel}
        options={staff
          .filter((x) => x.id !== leadId)
          .map((x) => ({ value: x.id, label: x.name_arabic }))}
        selected={assistantIds}
        onChange={onAssistants}
        hint={assistantsHint}
        disabled={disabled}
      />
    </>
  );
}
