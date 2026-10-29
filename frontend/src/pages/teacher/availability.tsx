import { useCallback, type ReactNode } from 'react';

import {
  fetchMyTeachingProfile,
  saveMyAvailability,
  saveMyCapabilities,
  saveMyFraming,
} from '../../adapters/teaching-profile.js';
import {
  TeachingProfileSaveError,
  useTeachingProfileForm,
  type TeachingProfileChange,
} from '../../components/teaching/teaching-profile-form.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { Button } from '../../components/ui/button.js';
import { ErrorPanel } from '../../components/ui/error-panel.js';
import { Feedback } from '../../components/ui/feedback.js';
import { LoadingState } from '../../components/states.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/teacher/availability` — **إدخال متى أنا متاحة** (SRS Revision 106).
 *
 * ## The decision this screen embodies
 *
 * R88.2 refused it in terms: *"a مؤطِّرة may not edit her own, because who may
 * assert their own availability, and whether the administration may then rely
 * on it, is a separate decision the Owner has not taken."* R106 takes it, and
 * takes it **narrowly** — she states her `TeacherAvailability` ranges and
 * nothing else.
 *
 * ## The capabilities became editable (Owner, 2026-08-30)
 *
 * They were rendered as **text** here, on rule AF's reasoning: R88.2 reserved
 * *what she may teach* to the administration, so showing a control the server
 * would refuse would have implied an edit that could not happen. **The Owner
 * has now taken that decision the other way**, so the same two controls the
 * administrator's dialog offers are here — from the same component, against the
 * same two tables, with the same refusal of a retired Subject.
 *
 * They remain on the page for the original reason too: availability presented
 * with no sight of what it is availability **for** is a question asked out of
 * context. She is deciding when she can teach *Quran and Tafsir*, not when she
 * is free in the abstract.
 *
 * ## One «حفظ» (R253, the Owner: «use one save button حفظ to save all change on
 * that page»)
 *
 * The framing preference, the capabilities and the availability are still
 * separate writes to separate routes, each replacing only the part it names —
 * and the one button sends **only the parts that changed**, so a part she did
 * not touch is never rewritten from a stale copy. The framing fields are
 * checked first: an incomplete preference saves nothing.
 *
 * ## It grants nothing, and the page says so
 *
 * R88.3 is the whole reason this grant is safe, and a مؤطِّرة filling in a
 * weekly grid could easily read it as claiming classes. The lede says plainly
 * that assignment is the administration's — the same sentence
 * `TeachingProfileDialog` shows an administrator, for the same reason.
 *
 * ## Unsaved work
 *
 * Rule AY. This is a page rather than a dialog, so `useUnsavedGuard` does not
 * apply — its mechanism is a dialog's dismissal paths. What a page can do is
 * keep the save action live and honest, so `dirty` drives the button rather
 * than being decorative: nothing is auto-saved and nothing is silently lost.

 * ## One form with the administrator's dialog (R256)
 *
 * The fields, the dirty check and the one save are `useTeachingProfileForm`,
 * which «الملف التدريسي» renders too; this page sends each part to her own
 * route.
 */
export function TeacherAvailabilityPage(): ReactNode {
  const { accessToken } = useSession();
  const load = useCallback(async () => {
    const profile = await fetchMyTeachingProfile(accessToken);
    return { profile, subjects: profile.selectable_subjects, categories: profile.selectable_categories };
  }, [accessToken]);
  const save = useCallback(
    async (change: TeachingProfileChange) => {
      // Each changed part to her own route, in turn; the parts before a refusal are saved.
      if (change.framing) {
        await saveMyFraming(change.framing, accessToken).catch((error: unknown) => {
          throw new TeachingProfileSaveError('framing', error);
        });
      }
      if (change.capabilities) {
        await saveMyCapabilities(change.capabilities.subjectIds, change.capabilities.categoryIds, accessToken).catch(
          (error: unknown) => {
            throw new TeachingProfileSaveError('capabilities', error);
          },
        );
      }
      if (change.availability) {
        await saveMyAvailability(change.availability, accessToken).catch((error: unknown) => {
          throw new TeachingProfileSaveError('availability', error);
        });
      }
    },
    [accessToken],
  );
  const form = useTeachingProfileForm({ load, save });

  return (
    <TeacherLayout title={t('teacher.nav.availability')}>
      {form.loading ? (
        <LoadingState />
      ) : form.loadError ? (
        <ErrorPanel error={form.loadError} variant="region" onRetry={() => void form.reload()} />
      ) : (
        // R253 — the page's content as one white card, with one «حفظ».
        <div className="card teacher-availability">
          {form.fields}
          {/* Rule AH — a FORM message, so it belongs above the form's buttons. */}
          {form.notice ? <Feedback>{form.notice}</Feedback> : null}
          <div className="form__actions">
            <Button variant="primary" disabled={form.busy || !form.dirty} onClick={() => void form.saveAll()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
