import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchMyTeachingProfile,
  saveMyAvailability,
  type AvailabilityRange,
} from '../../adapters/teaching-profile.js';
import { AvailabilityEditor } from '../../components/teaching/availability-editor.js';
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
 * ## Why the capabilities are on the page but not editable
 *
 * What she may *teach* is the administration's record of her (R88.2, unchanged).
 * They are shown because availability presented with no sight of what it is
 * availability **for** is a question asked out of context — she is deciding
 * when she can teach *Quran and Tafsir*, not when she is free in the abstract.
 * Rendered as text, with no control, because **§14.1 rule AF is the rule here**:
 * a value the server will refuse is shown as a fact and not as a disabled input
 * that implies it might one day be editable.
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
  const [capabilities, setCapabilities] = useState<string[]>([]);
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
      setCapabilities([...profile.subjects, ...profile.categories].map((c) => c.name));
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

          {/* Rule AF — the administration's record of her, shown as text. */}
          <section className="form__group">
            <h2 className="form__legend">{t('teacher.availability.capabilities')}</h2>
            <p className={capabilities.length === 0 ? 'muted' : ''}>
              {capabilities.length === 0
                ? t('teacher.availability.noCapabilities')
                : capabilities.join(' · ')}
            </p>
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
