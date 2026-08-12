import type { ReactNode } from 'react';

import { SelectField } from '../ui/field.js';
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

      <fieldset className="field">
        <legend className="field__label">{assistantsLabel}</legend>
        <div className="field__choices">
          {staff
            // One person holds one position on one thing; the server refuses the
            // pair as a duplicate assignment.
            .filter((x) => x.id !== leadId)
            .map((x) => (
              <label key={x.id} className="field field--choice">
                <input
                  type="checkbox"
                  checked={assistantIds.includes(x.id)}
                  disabled={disabled}
                  onChange={(e) =>
                    onAssistants(
                      e.target.checked
                        ? [...assistantIds, x.id]
                        : assistantIds.filter((id) => id !== x.id),
                    )
                  }
                />
                <span>{x.name_arabic}</span>
              </label>
            ))}
        </div>
        <p className="field__hint">{assistantsHint}</p>
      </fieldset>
    </>
  );
}
