import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchTeachingProfile,
  saveTeachingProfile,
  type AvailabilityRange,
} from '../../adapters/teaching-profile.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { FormDialog } from '../ui/form-dialog.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { SelectField, TextField } from '../ui/field.js';

/**
 * **الملف التدريسي — what she can teach, and when** (R88).
 *
 * Opened from المستخدمون rather than a top-level page, because it is a fact
 * *about a person* and the person is where the administration already goes to
 * manage them — a separate section would make somebody remember it exists.
 *
 * **Nothing here grants anything.** The dialog says so in its own hint, and it
 * is the truth: assignment is what carries authority, and this only helps the
 * administration choose one. That sentence is on the screen because the
 * distinction is invisible otherwise — a form that lists Subjects and Quran
 * looks exactly like a permissions form.
 */
const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export function TeachingProfileDialog({
  userId,
  userName,
  subjects,
  categories,
  token,
  onClose,
  onSaved,
}: {
  userId: string;
  userName: string;
  subjects: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [ranges, setRanges] = useState<AvailabilityRange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const profile = await fetchTeachingProfile(userId, token);
      setSubjectIds(profile.subjects.map((s) => s.id));
      setCategoryIds(profile.categories.map((c) => c.id));
      setRanges(
        profile.availability.map((a) => ({
          weekday: a.weekday,
          start_time: a.start_time,
          end_time: a.end_time,
        })),
      );
      setLoaded(true);
    } catch {
      setError(t('admin.teachingProfile.loadFailed'));
      setLoaded(true);
    }
  }, [userId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Anything typed is unsaved work the shared dialog must protect (rule U). */
  const dirty = loaded && (subjectIds.length > 0 || categoryIds.length > 0 || ranges.length > 0);

  return (
    <FormDialog
      open
      title={t('admin.teachingProfile.title').replace('{name}', userName)}
      submitLabel={t('common.save')}
      busy={busy}
      dirty={dirty}
      notice={error}
      onCancel={onClose}
      onSubmit={() => {
        void (async () => {
          setBusy(true);
          setError(null);
          try {
            await saveTeachingProfile(
              userId,
              { subject_ids: subjectIds, category_ids: categoryIds, availability: ranges },
              token,
            );
            onSaved();
          } catch {
            // The server owns the overlap rule and the reference checks; the
            // form reports its refusal rather than re-implementing either.
            setError(t('admin.teachingProfile.saveFailed'));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      {/* **Said on the screen, not only in the docs.** A form listing Subjects
          and Quran looks exactly like a permissions form; this is the sentence
          that stops an administrator believing she has just granted access. */}
      <p className="field__hint">{t('admin.teachingProfile.planningOnly')}</p>

      <MultiSelectField
        label={t('admin.teachingProfile.subjects')}
        options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        selected={subjectIds}
        onChange={setSubjectIds}
      />

      <MultiSelectField
        label={t('admin.teachingProfile.categories')}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        selected={categoryIds}
        onChange={setCategoryIds}
      />

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
              options={WEEKDAYS.map((d) => ({ value: d, label: t(`calendar.weekday.${d}`) }))}
            />
            <TextField
              label={t('admin.teachingProfile.from')}
              value={range.start_time}
              onChange={(v) => update(index, { start_time: v })}
              hint="HH:MM"
            />
            <TextField
              label={t('admin.teachingProfile.to')}
              value={range.end_time}
              onChange={(v) => update(index, { end_time: v })}
              hint="HH:MM"
            />
            <Button
              variant="danger"
              className="row-action"
              onClick={() => setRanges(ranges.filter((_, i) => i !== index))}
            >
              {t('common.delete')}
            </Button>
          </div>
        ))}

        <Button
          variant="add"
          onClick={() =>
            setRanges([...ranges, { weekday: 'monday', start_time: '09:00', end_time: '12:00' }])
          }
        >
          {t('admin.teachingProfile.addRange')}
        </Button>
      </fieldset>
    </FormDialog>
  );

  function update(index: number, patch: Partial<AvailabilityRange>): void {
    setRanges(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
}
