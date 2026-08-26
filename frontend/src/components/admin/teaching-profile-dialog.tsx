import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchTeachingProfile,
  saveTeachingProfile,
  type AvailabilityRange,
} from '../../adapters/teaching-profile.js';
import { t } from '../../i18n/index.js';
import { AvailabilityEditor } from '../teaching/availability-editor.js';
import { FormDialog } from '../ui/form-dialog.js';
import { MultiSelectField } from '../ui/multi-select.js';

/**
 * **الملف التدريسي — what she can teach, and when** (R88).
 *
 * **Opened from المؤطِّرات**, and from nowhere else. It shipped as a row
 * action on المستخدمون — "the person is where the administration already goes"
 * — and that reasoning was wrong about *which* people: المستخدمون administers
 * every account, so a guardian, a minor and an administrator were each offered
 * a teaching profile. Whether somebody can teach a Subject is a question of the
 * teaching section, which now has a screen for the people who do the teaching
 * beside the one for the people being taught.
 *
 * **Nothing here grants anything.** The dialog says so in its own hint, and it
 * is the truth: assignment is what carries authority, and this only helps the
 * administration choose one. That sentence is on the screen because the
 * distinction is invisible otherwise — a form that lists Subjects and Quran
 * looks exactly like a permissions form.
 */
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

      {/* **The shared editor** (R106). It was written out here, and the
          moment a مؤطِّرة could edit her own ranges there would have been two
          copies of R88's subtleties — one of which would drift. */}
      <AvailabilityEditor ranges={ranges} onChange={setRanges} />
    </FormDialog>
  );

}
