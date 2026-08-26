import type { ReactNode } from 'react';

import { Button } from '../ui/button.js';
import { SelectField, TextField } from '../ui/field.js';
import { t } from '../../i18n/index.js';
import type { AvailabilityRange } from '../../adapters/teaching-profile.js';

/**
 * **One weekly availability editor, used by both people who may edit one.**
 *
 * ## Why it is extracted (R106)
 *
 * The administration has edited a مؤطِّرة's ranges since R88, inside
 * `TeachingProfileDialog`. R106 lets her edit her own — and the moment there
 * are two editors for one table, this project's own record says what happens
 * next: *every duplicated requirement here has drifted, and the copy that
 * drifts still passes its own tests.* R88's rules are subtle enough that a
 * drifted copy would be a real defect rather than a cosmetic one — touching
 * ranges are legal, overlapping ones are not, and ranges are never merged.
 *
 * So this is the editor, and the two callers differ only in **what surrounds
 * it**: a dialog with Subjects and Categories for the administration, a page
 * with a read-only summary of them for her.
 *
 * ## What it deliberately does not do
 *
 * **No validation of its own.** Overlap is R88.6's rule and lives in the
 * service, which answers `OVERLAPPING_AVAILABILITY` naming the clash; a
 * client-side copy would be a second statement of the same rule with no way to
 * be authoritative. This component collects ranges and reports them.
 *
 * **No save button and no persistence.** The two callers write to different
 * endpoints with different scopes — `PUT /admin/users/{id}/teaching-profile`
 * replaces a whole profile, `PUT /me/teaching-profile/availability` replaces
 * the ranges alone (R88.2, R106.2, R106.5). A shared save would have to know
 * which, which is the caller's fact and not this component's.
 */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** The range a reader gets when they ask for one. A morning, because that is
 *  the commonest and an empty row would make her type four values to say
 *  anything at all. */
export const DEFAULT_RANGE: AvailabilityRange = {
  weekday: 'monday',
  start_time: '09:00',
  end_time: '12:00',
};

export function AvailabilityEditor({
  ranges,
  onChange,
  disabled = false,
}: {
  ranges: readonly AvailabilityRange[];
  onChange: (next: AvailabilityRange[]) => void;
  disabled?: boolean;
}): ReactNode {
  const update = (index: number, patch: Partial<AvailabilityRange>): void =>
    onChange(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <fieldset className="form__group">
      <legend>{t('admin.teachingProfile.availability')}</legend>
      {ranges.length === 0 ? (
        <p className="muted">{t('admin.teachingProfile.noAvailability')}</p>
      ) : null}

      {ranges.map((range, index) => (
        // Keyed by POSITION deliberately: a range has no id until it is saved,
        // and keying by its values would remount the row on every keystroke.
        <div className="form__row" key={`range-${index}`}>
          <SelectField
            label={t('admin.teachingProfile.weekday')}
            value={range.weekday}
            onChange={(v) => update(index, { weekday: v })}
            disabled={disabled}
            // **`scheduling.weekday`, which is where the labels actually
            //   live.** This read `calendar.weekday` and rendered seven raw
            //   keys on screen: a computed key's namespace was never checked,
            //   which `resolves.test.ts` now does.
            options={WEEKDAYS.map((d) => ({ value: d, label: t(`scheduling.weekday.${d}`) }))}
          />
          {/* **The platform's wall-clock input, not a second one.** A
              24-hour `TextField` with the scheduling hint is what
              `RecurrenceEditor` uses for exactly this value, and TD-11 times
              are stored as the string the reader typed — a native
              `type="time"` would hand the two screens different locale
              behaviour for one concept. The hint is `scheduling.timeHint`
              rather than a hard-coded «HH:MM»: an Arabic sentence the reader
              understands, written once, and it sits on the pair rather than
              on each field. */}
          <TextField
            label={t('admin.teachingProfile.from')}
            value={range.start_time}
            onChange={(v) => update(index, { start_time: v })}
            hint={t('scheduling.timeHint')}
            disabled={disabled}
          />
          <TextField
            label={t('admin.teachingProfile.to')}
            value={range.end_time}
            onChange={(v) => update(index, { end_time: v })}
            disabled={disabled}
          />
          <Button
            variant="danger"
            className="row-action"
            disabled={disabled}
            onClick={() => onChange(ranges.filter((_, i) => i !== index))}
          >
            {t('common.delete')}
          </Button>
        </div>
      ))}

      <Button variant="add" disabled={disabled} onClick={() => onChange([...ranges, DEFAULT_RANGE])}>
        {t('admin.teachingProfile.addRange')}
      </Button>
    </fieldset>
  );
}
