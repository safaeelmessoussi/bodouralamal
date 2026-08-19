import type { ReactNode } from 'react';

import { Button } from '../ui/button.js';
import { markedLabel, Warnings } from './staff-picker.js';
import { DateField, SelectField } from '../ui/field.js';
import { t } from '../../i18n/index.js';
import type { TeachingCandidate } from '../../adapters/teaching-candidates.js';
import type { UserSummary } from '../../adapters/users.js';

/**
 * **Who teaches this class, and WHEN** (R91).
 *
 * ## Why this replaced the lead-plus-assistants controls
 *
 * `StaffPicker` expresses *one lead and any number of assistants* — the shape of
 * an exam sitting and a celebration, and the shape a class had while an
 * assignment carried no period. R91 makes an assignment a **row with dates**,
 * and the association's real cases cannot be said in the old shape at all:
 *
 * | Case | Rows |
 * |---|---|
 * | ordinary | Safa, main, open → open |
 * | temporary replacement | Safa → 30 Nov · **Amina 1–30 Nov** · Safa 1 Dec → open |
 * | rest of semester | Safa → 15 Jan · Amina 16 Jan → open |
 *
 * Safa holds **two rows** in the first replacement, which a single «المؤطّرة»
 * selector cannot represent — and the platform's `(schedule, user)` unique index
 * could not store, which is why R91 withdrew it.
 *
 * **The exam and the celebration keep `StaffPicker` unchanged.** They staff a
 * single dated thing, so a period would be a field with one possible value.
 *
 * ## What the administrator sees
 *
 * One row per assignment: who · main or assistant · from · until. Empty dates
 * read as «من بداية الحصة» and «حتى نهايتها», because *open-ended* is the
 * commonest answer and a blank field that means something must say what.
 *
 * R90's planning warnings ride along on each row — same appraisal, same rule:
 * they inform and never refuse.
 */
export interface StaffingPeriod {
  user_id: string;
  position: 'teacher' | 'assistant';
  /** `''` is open-ended at that end. The wire carries `null`; the form carries
   *  the empty string a date input produces, converted once at the boundary. */
  effective_from: string;
  effective_until: string;
}

export interface StaffingPeriodsProps {
  staff: UserSummary[];
  value: StaffingPeriod[];
  onChange: (next: StaffingPeriod[]) => void;
  disabled?: boolean;
  appraisal?: Record<string, TeachingCandidate>;
}

export function StaffingPeriods({
  staff,
  value,
  onChange,
  disabled = false,
  appraisal,
}: StaffingPeriodsProps): ReactNode {
  const update = (index: number, patch: Partial<StaffingPeriod>): void =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <fieldset className="form__group">
      <legend>{t('admin.schedules.staffing')}</legend>
      <p className="field__hint">{t('admin.schedules.staffingHint')}</p>

      {value.length === 0 ? (
        <p className="muted">{t('admin.schedules.noStaffing')}</p>
      ) : null}

      {value.map((row, index) => (
        // Keyed by POSITION in the list deliberately: a row has no id until it
        // is saved, and keying by its values would remount it on every keystroke
        // — the same reasoning the teaching-profile dialog records for its
        // availability rows.
        <div className="form__row" key={`staffing-${index}`}>
          <SelectField
            label={t('admin.schedules.staffMember')}
            value={row.user_id}
            onChange={(v) => update(index, { user_id: v })}
            disabled={disabled}
            /**
             * **Marked BEFORE the choice** (rule AR). This rendered bare names,
             * so moving a class onto this editor silently dropped half of R90:
             * the chips below still appeared once somebody was chosen, which is
             * what made the loss hard to see. `markedLabel` is the shared
             * `StaffPicker` helper, not a second copy.
             */
            options={[
              { value: '', label: t('common.choose') },
              ...staff.map((x) => ({ value: x.id, label: markedLabel(x, appraisal) })),
            ]}
          />
          <SelectField
            label={t('admin.schedules.staffPosition')}
            value={row.position}
            onChange={(v) => update(index, { position: v as StaffingPeriod['position'] })}
            disabled={disabled}
            options={[
              { value: 'teacher', label: t('admin.schedules.positionTeacher') },
              { value: 'assistant', label: t('admin.schedules.positionAssistant') },
            ]}
          />
          <DateField
            label={t('admin.schedules.effectiveFrom')}
            value={row.effective_from}
            onChange={(v) => update(index, { effective_from: v })}
            disabled={disabled}
            hint={t('admin.schedules.effectiveFromHint')}
          />
          <DateField
            label={t('admin.schedules.effectiveUntil')}
            value={row.effective_until}
            onChange={(v) => update(index, { effective_until: v })}
            disabled={disabled}
            hint={t('admin.schedules.effectiveUntilHint')}
          />
          <Button
            variant="danger"
            className="row-action"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            {t('common.delete')}
          </Button>
          <Warnings candidate={appraisal?.[row.user_id]} />
        </div>
      ))}

      <Button
        variant="add"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...value,
            // A new row defaults to **assistant**, not to main teacher: at most
            // one main may be active on a date (R91 §6), and defaulting to the
            // position that is capped would make the commonest next action a
            // refusal.
            { user_id: '', position: 'assistant', effective_from: '', effective_until: '' },
          ])
        }
      >
        {t('admin.schedules.addStaffing')}
      </Button>
    </fieldset>
  );
}
