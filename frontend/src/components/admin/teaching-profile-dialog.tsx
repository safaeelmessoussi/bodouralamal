import { useCallback, useRef, type ReactNode } from 'react';

import { fetchTeachingProfile, saveTeachingProfile, saveUserFraming } from '../../adapters/teaching-profile.js';
import { t } from '../../i18n/index.js';
import { LoadingState } from '../states.js';
import {
  TeachingProfileSaveError,
  useTeachingProfileForm,
  type TeachingProfileChange,
} from '../teaching/teaching-profile-form.js';
import { FormDialog } from '../ui/form-dialog.js';

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

 *
 * **R256 — the same form as her «إدخال أوقات التوفّر»** (the Owner: «for them
 * both same thing is opened, and they are both allowed to edit same thing»):
 * `useTeachingProfileForm`, one «حفظ». The framing goes to her framing route,
 * the Subjects, Categories and times to the profile route — each naming the
 * `self_saved_at` it opened with, so a save she made meanwhile stands.
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
  // The catalogue as it was when the dialog opened: a new array from the page
  // on each render must not re-read the form (and lose what was typed).
  const catalogue = useRef({ subjects, categories });
  const load = useCallback(
    async () => ({ profile: await fetchTeachingProfile(userId, token), ...catalogue.current }),
    [userId, token],
  );
  const save = useCallback(
    async (change: TeachingProfileChange) => {
      if (change.framing) {
        await saveUserFraming(userId, change.framing, token, change.selfSavedAt ?? null).catch((error: unknown) => {
          throw new TeachingProfileSaveError('framing', error);
        });
      }
      if (change.capabilities || change.availability) {
        // One route replaces both, so it is sent the whole current state.
        await saveTeachingProfile(
          userId,
          { subject_ids: change.all.subjectIds, category_ids: change.all.categoryIds, availability: change.all.ranges },
          token,
          change.selfSavedAt ?? null,
        ).catch((error: unknown) => {
          throw new TeachingProfileSaveError(change.capabilities ? 'capabilities' : 'availability', error);
        });
      }
    },
    [userId, token],
  );
  const form = useTeachingProfileForm({ load, save });

  return (
    <FormDialog
      open
      title={t('admin.teachingProfile.title').replace('{name}', userName)}
      submitLabel={t('common.save')}
      busy={form.busy}
      dirty={form.dirty}
      notice={form.loadError ? t('admin.teachingProfile.loadFailed') : form.notice}
      onCancel={onClose}
      onSubmit={() => {
        void form.saveAll().then((ok) => {
          if (ok) onSaved();
        });
      }}
    >
      {form.loading ? <LoadingState /> : form.loadError ? null : form.fields}
    </FormDialog>
  );
}
