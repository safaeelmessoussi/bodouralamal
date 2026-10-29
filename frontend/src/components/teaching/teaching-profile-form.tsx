import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { AvailabilityRange, TeachingProfile } from '../../adapters/teaching-profile.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { isDirty } from '../../lib/form-dirty.js';
import {
  framingPayload,
  teachingSectionFrom,
  validateTeachingSection,
  type FramingPayload,
  type TeachingSectionValue,
} from '../registration/role-sections.js';
import { AvailabilityEditor } from './availability-editor.js';
import type { CapabilityOption } from './capabilities-editor.js';
import { FramingPreferenceEditor } from './framing-preference-editor.js';

/** What the form reads: the profile, and the catalogue it chooses from. */
export interface LoadedTeachingProfile {
  profile: TeachingProfile;
  subjects: readonly CapabilityOption[];
  categories: readonly CapabilityOption[];
}

/** The parts of one «حفظ», in the order they are sent. */
export type TeachingProfilePart = 'framing' | 'capabilities' | 'availability';

/** Which parts changed, and their values — each saver sends what its route takes. */
export interface TeachingProfileChange {
  framing: FramingPayload | null;
  capabilities: { subjectIds: string[]; categoryIds: string[] } | null;
  availability: AvailabilityRange[] | null;
  /** The whole current state, for a route that replaces more than one part. */
  all: { subjectIds: string[]; categoryIds: string[]; ranges: AvailabilityRange[] };
  /** R256 — the `self_saved_at` the form opened with (an administrator's save names it). */
  selfSavedAt: string | null | undefined;
}

/** A refused part, named so the message can say which. */
export class TeachingProfileSaveError extends Error {
  constructor(
    readonly part: TeachingProfilePart,
    readonly cause: unknown,
  ) {
    super(`teaching profile ${part} refused`);
  }
}

const rangesOf = (profile: TeachingProfile): AvailabilityRange[] =>
  profile.availability.map((a) => ({
    weekday: a.weekday,
    start_time: a.start_time,
    end_time: a.end_time,
    mode: a.mode,
  }));

interface Snapshot {
  framing: TeachingSectionValue;
  subjects: string[];
  categories: string[];
  ranges: AvailabilityRange[];
}

/**
 * **R256 — «الملف التدريسي» and «إدخال أوقات التوفّر» are one form** (the
 * Owner: «for them both same thing is opened, and they are both allowed to
 * edit same thing»). The framing preference with her Subjects and Categories
 * among its fields (R254), her weekly times, and ONE «حفظ» that sends only the
 * parts that changed (R253) — on her page and in the administrator's dialog
 * alike; only how each part is sent differs (`save`).
 *
 * **Her save takes priority** (the Owner: «if both of them trying to save at
 * the same time, prioritize the teacher saving»): an administrator's save names
 * the `self_saved_at` the form opened with, the server refuses it if she saved
 * since (`TEACHER_SAVED_FIRST`), and the form then re-reads what she saved.
 */
export function useTeachingProfileForm({
  load,
  save,
}: {
  load: () => Promise<LoadedTeachingProfile>;
  /** Sends the changed parts, in order; throws `TeachingProfileSaveError` naming the refused one. */
  save: (change: TeachingProfileChange) => Promise<void>;
}): {
  loading: boolean;
  loadError: unknown;
  reload: () => Promise<void>;
  dirty: boolean;
  busy: boolean;
  notice: string | null;
  /** Saves; `true` when every changed part was accepted. */
  saveAll: () => Promise<boolean>;
  fields: ReactNode;
} {
  const [loaded, setLoaded] = useState<LoadedTeachingProfile | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Only the first read shows a loading state; a re-read after a save keeps the form.
  const loading = loaded === null && loadError === null;
  const [framing, setFraming] = useState<TeachingSectionValue>(() => teachingSectionFrom(null));
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [ranges, setRanges] = useState<AvailabilityRange[]>([]);
  /** What the server last confirmed — the comparison `dirty` is made against.
   *  The selections sorted: `MultiSelectField` returns click order (AY.1). */
  const [pristine, setPristine] = useState<Snapshot | null>(null);
  const [showFramingErrors, setShowFramingErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await load();
      const value = teachingSectionFrom(next.profile.framing);
      const subs = next.profile.subjects.map((x) => x.id);
      const cats = next.profile.categories.map((x) => x.id);
      const stored = rangesOf(next.profile);
      setLoaded(next);
      setFraming(value);
      setSubjectIds(subs);
      setCategoryIds(cats);
      setRanges(stored);
      setPristine({ framing: value, subjects: [...subs].sort(), categories: [...cats].sort(), ranges: stored });
      setShowFramingErrors(false);
    } catch (error) {
      setLoadError(error);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const framingDirty = pristine !== null && isDirty(framing, pristine.framing);
  const capsDirty =
    pristine !== null &&
    isDirty(
      { subjects: [...subjectIds].sort(), categories: [...categoryIds].sort() },
      { subjects: pristine.subjects, categories: pristine.categories },
    );
  const rangesDirty = pristine !== null && isDirty(ranges, pristine.ranges);
  const dirty = framingDirty || capsDirty || rangesDirty;

  async function saveAll(): Promise<boolean> {
    setNotice(null);
    if (framingDirty && Object.keys(validateTeachingSection(framing)).length > 0) {
      setShowFramingErrors(true);
      setNotice(t('teacher.availability.framingIncomplete'));
      return false;
    }
    setBusy(true);
    try {
      await save({
        framing: framingDirty ? framingPayload(framing) : null,
        capabilities: capsDirty ? { subjectIds, categoryIds } : null,
        availability: rangesDirty ? ranges : null,
        all: { subjectIds, categoryIds, ranges },
        selfSavedAt: loaded?.profile.self_saved_at,
      });
      await reload();
      setNotice(t('teacher.availability.allSaved'));
      return true;
    } catch (error) {
      const part = error instanceof TeachingProfileSaveError ? error.part : 'availability';
      const cause = error instanceof TeachingProfileSaveError ? error.cause : error;
      const reason =
        cause instanceof ApiError ? (cause.envelope?.details as { reason?: string } | undefined)?.reason : undefined;
      if (reason === 'TEACHER_SAVED_FIRST') {
        // Hers stands: show what she saved, and say so.
        await reload();
        setNotice(t('admin.teachingProfile.teacherSavedFirst'));
        return false;
      }
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
      return false;
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <>
      <p className="field__hint">{t('teacher.availability.planningOnly')}</p>
      <FramingPreferenceEditor
        framing={loaded?.profile.framing ?? null}
        controlled={{ value: framing, onChange: setFraming, showErrors: showFramingErrors }}
        // R254 — the Subjects and Categories among the framing fields; the
        // Categories narrow the Levels offered there.
        capabilities={{
          subjects: [...(loaded?.subjects ?? [])],
          categories: [...(loaded?.categories ?? [])],
          subjectIds,
          categoryIds,
          onSubjects: setSubjectIds,
          onCategories: setCategoryIds,
          disabled: busy,
        }}
      />
      <section className="form">
        <AvailabilityEditor ranges={ranges} onChange={setRanges} disabled={busy} />
      </section>
    </>
  );

  return { loading, loadError, reload, dirty, busy, notice, saveAll, fields };
}
