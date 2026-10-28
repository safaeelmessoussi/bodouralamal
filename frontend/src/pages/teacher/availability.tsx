import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchMyTeachingProfile,
  saveMyAvailability,
  saveMyCapabilities,
  saveMyFraming,
  type AvailabilityRange,
} from '../../adapters/teaching-profile.js';
import { AvailabilityEditor } from '../../components/teaching/availability-editor.js';
import { FramingPreferenceEditor } from '../../components/teaching/framing-preference-editor.js';
import type { FramingPreferenceView } from '../../components/teaching/framing-preference-summary.js';
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
import { ApiError } from '../../lib/api.js';
import {
  framingPayload,
  teachingSectionFrom,
  validateTeachingSection,
  type TeachingSectionValue,
} from '../../components/registration/role-sections.js';

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
 */
export function TeacherAvailabilityPage(): ReactNode {
  const { accessToken } = useSession();
  const [ranges, setRanges] = useState<AvailabilityRange[]>([]);
  const [framing, setFraming] = useState<FramingPreferenceView | null>(null);
  /** R253 — the framing preference as edited, and as last confirmed. */
  const [framingValue, setFramingValue] = useState<TeachingSectionValue>(() => teachingSectionFrom(null));
  const [pristineFraming, setPristineFraming] = useState<TeachingSectionValue>(() => teachingSectionFrom(null));
  const [showFramingErrors, setShowFramingErrors] = useState(false);
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
        mode: a.mode,
      }));
      setRanges(stored);
      setPristine(stored);
      setFraming(profile.framing);
      setFramingValue(teachingSectionFrom(profile.framing));
      setPristineFraming(teachingSectionFrom(profile.framing));
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

  const framingDirty = isDirty(framingValue, pristineFraming);
  const anyDirty = dirty || capsDirty || framingDirty;

  /** R253 — one save for the page: each changed part to its own route, in turn. */
  async function saveAll(): Promise<void> {
    setNotice(null);
    if (framingDirty && Object.keys(validateTeachingSection(framingValue)).length > 0) {
      setShowFramingErrors(true);
      setNotice(t('teacher.availability.framingIncomplete'));
      return;
    }
    setBusy(true);
    let part: 'framing' | 'capabilities' | 'availability' = 'framing';
    try {
      if (framingDirty) {
        const saved = await saveMyFraming(framingPayload(framingValue), accessToken);
        setFraming(saved.framing);
        setFramingValue(teachingSectionFrom(saved.framing));
        setPristineFraming(teachingSectionFrom(saved.framing));
        setShowFramingErrors(false);
      }
      part = 'capabilities';
      if (capsDirty) {
        const profile = await saveMyCapabilities(subjectIds, categoryIds, accessToken);
        const subs = profile.subjects.map((x) => x.id);
        const cats = profile.categories.map((x) => x.id);
        setSubjectIds(subs);
        setCategoryIds(cats);
        setPristineCaps({ subjects: [...subs].sort(), categories: [...cats].sort() });
      }
      part = 'availability';
      if (dirty) {
        const profile = await saveMyAvailability(ranges, accessToken);
        const stored = profile.availability.map((a) => ({
          weekday: a.weekday,
          start_time: a.start_time,
          end_time: a.end_time,
          mode: a.mode,
        }));
        setRanges(stored);
        setPristine(stored);
      }
      setNotice(t('teacher.availability.allSaved'));
    } catch (error) {
      // Each refusal is the server's (a retired Subject, R88.6's overlap rule,
      // no current year), told in the words of the part that was refused; the
      // parts before it are saved.
      const reason =
        error instanceof ApiError ? (error.envelope?.details as { reason?: string } | undefined)?.reason : undefined;
      setNotice(
        part === 'framing'
          ? reason === 'NO_CURRENT_YEAR'
            ? t('framing.noCurrentYear')
            : reason === 'NO_CURRENT_PERIOD'
              ? t('framing.noCurrentPeriod')
              : t('profile.saveFailed')
          : part === 'capabilities'
            ? t('teacher.availability.capabilitiesSaveFailed')
            : t('teacher.availability.saveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <TeacherLayout
      title={t('teacher.nav.availability')}
    >
      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorPanel error={loadError} variant="region" onRetry={() => void load()} />
      ) : (
        // R253 — the page's content as one white card, with one «حفظ».
        <div className="card teacher-availability">
          <p className="field__hint">{t('teacher.availability.planningOnly')}</p>

          {/* R215 — her framing preference, said by her. */}
          <FramingPreferenceEditor
            framing={framing}
            controlled={{ value: framingValue, onChange: setFramingValue, showErrors: showFramingErrors }}
          />

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
              disabled={busy}
            />
          </section>

          <section className="form">
            <AvailabilityEditor ranges={ranges} onChange={setRanges} disabled={busy} />
          </section>

          {/* Rule AH — a FORM message, so it belongs above the form's buttons. */}
          {notice ? <Feedback>{notice}</Feedback> : null}

          <div className="form__actions">
            <Button variant="primary" disabled={busy || !anyDirty} onClick={() => void saveAll()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
