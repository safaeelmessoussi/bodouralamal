import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchMyTeachingProfile,
  saveMyAvailability,
  saveMyCapabilities,
  type AvailabilityRange,
} from '../../adapters/teaching-profile.js';
import { AvailabilityEditor } from '../../components/teaching/availability-editor.js';
import {
  CapabilitiesEditor,
  type CapabilityOption,
} from '../../components/teaching/capabilities-editor.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { Button } from '../../components/ui/button.js';
import { ErrorPanel } from '../../components/ui/error-panel.js';
import { Feedback } from '../../components/ui/feedback.js';
import { LoadingState } from '../../components/states.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { isDirty } from '../../lib/form-dirty.js';

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
 * ## Two saves, deliberately
 *
 * Capabilities and availability are separate writes to separate routes, each
 * replacing only the half it names. One combined save would let a page holding
 * a stale copy of either half erase it — and the two are edited at different
 * moments: she revises her declarations once a year and her availability every
 * term.
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
 */
export function TeacherAvailabilityPage(): ReactNode {
  const { accessToken } = useSession();
  const [ranges, setRanges] = useState<AvailabilityRange[]>([]);
  /** What the server last confirmed — the comparison `dirty` is made against. */
  const [pristine, setPristine] = useState<AvailabilityRange[]>([]);
  /** The catalogue she chooses from, carried on her own profile read — she
   *  cannot call `/admin/subjects`, and widening that to make this screen work
   *  would be the one fix that is never right (rule O). */
  const [allSubjects, setAllSubjects] = useState<CapabilityOption[]>([]);
  const [allCategories, setAllCategories] = useState<CapabilityOption[]>([]);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  /** What the server last confirmed for the capabilities half. Sorted, because
   *  `MultiSelectField` returns click order and `isDirty` is order-sensitive —
   *  the trap AY.1 records. */
  const [pristineCaps, setPristineCaps] = useState<{ subjects: string[]; categories: string[] }>({
    subjects: [],
    categories: [],
  });
  const [capsBusy, setCapsBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const profile = await fetchMyTeachingProfile(accessToken);
      // The `id` each stored range carries is the server's; the editor works in
      // the shape the write takes, so it is dropped rather than round-tripped.
      const stored = profile.availability.map((a) => ({
        weekday: a.weekday,
        start_time: a.start_time,
        end_time: a.end_time,
      }));
      setRanges(stored);
      setPristine(stored);
      setAllSubjects(profile.selectable_subjects);
      setAllCategories(profile.selectable_categories);
      const subs = profile.subjects.map((x) => x.id);
      const cats = profile.categories.map((x) => x.id);
      setSubjectIds(subs);
      setCategoryIds(cats);
      setPristineCaps({ subjects: [...subs].sort(), categories: [...cats].sort() });
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = isDirty(ranges, pristine);
  const capsDirty = isDirty(
    { subjects: [...subjectIds].sort(), categories: [...categoryIds].sort() },
    pristineCaps,
  );

  async function saveCapabilities(): Promise<void> {
    setCapsBusy(true);
    setNotice(null);
    try {
      const profile = await saveMyCapabilities(subjectIds, categoryIds, accessToken);
      const subs = profile.subjects.map((x) => x.id);
      const cats = profile.categories.map((x) => x.id);
      setSubjectIds(subs);
      setCategoryIds(cats);
      setPristineCaps({ subjects: [...subs].sort(), categories: [...cats].sort() });
      setNotice(t('teacher.availability.capabilitiesSaved'));
    } catch {
      // The refusal is the server's — a retired Subject is refused there, and a
      // client-side copy of that rule would be a second statement of it.
      setNotice(t('teacher.availability.capabilitiesSaveFailed'));
    } finally {
      setCapsBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const profile = await saveMyAvailability(ranges, accessToken);
      const stored = profile.availability.map((a) => ({
        weekday: a.weekday,
        start_time: a.start_time,
        end_time: a.end_time,
      }));
      setRanges(stored);
      setPristine(stored);
      setNotice(t('teacher.availability.saved'));
    } catch {
      // **The overlap rule is the server's** (R88.6), and its refusal is what
      // this reports. A client-side copy of the rule would be a second
      // statement of it with no way to be authoritative.
      setNotice(t('teacher.availability.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TeacherLayout
      title={t('teacher.nav.availability')}
      lede={t('teacher.availability.lede')}
    >
      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorPanel error={loadError} variant="region" onRetry={() => void load()} />
      ) : (
        <>
          <p className="field__hint">{t('teacher.availability.planningOnly')}</p>

          {/* Hers to state since 2026-08-30, through the SHARED editor — the
              administrator's dialog renders the identical controls. */}
          <section className="form">
            <h2 className="form__legend">{t('teacher.availability.capabilities')}</h2>
            <CapabilitiesEditor
              subjects={allSubjects}
              categories={allCategories}
              subjectIds={subjectIds}
              categoryIds={categoryIds}
              onSubjects={setSubjectIds}
              onCategories={setCategoryIds}
              disabled={capsBusy}
            />
            <div className="form__actions">
              <Button
                variant="primary"
                disabled={capsBusy || !capsDirty}
                onClick={() => void saveCapabilities()}
              >
                {t('common.save')}
              </Button>
            </div>
          </section>

          <div className="form">
            <AvailabilityEditor ranges={ranges} onChange={setRanges} disabled={busy} />
          </div>

          {/* Rule AH — a FORM message, so it belongs above the form's buttons. */}
          {notice ? <Feedback>{notice}</Feedback> : null}

          <div className="form__actions">
            <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </>
      )}
    </TeacherLayout>
  );
}
