import { useEffect, useMemo, useRef, useState } from 'react';

import {
  appraiseCandidates,
  type ProposedClassQuery,
  type TeachingCandidate,
} from '../adapters/teaching-candidates.js';

/**
 * **R90 — appraise the candidates against the class currently on the form.**
 *
 * Re-asked whenever the class's *shape* changes: its Subject, its Level, its
 * recurrence, its weekdays and its hours. Nothing else, and deliberately not the
 * chosen مؤطِّرة — the appraisal is about the class, and re-fetching on every
 * selection would flicker the warnings under the control the reader is using.
 *
 * **It answers nothing until the class has hours.** A time-less form has no
 * availability question to ask, so there is no appraisal and the picker renders
 * exactly as it did before R90.
 *
 * **A failure is silence, never a blocked form.** The appraisal is advisory —
 * R88.4 — so a screen that refused to let an administrator staff a class because
 * an advisory read failed would have converted planning data into a permission,
 * which is the one thing R88 exists to prevent.
 */
export function useTeachingCandidates(
  proposed: ProposedClassQuery | null,
  token: string | null,
): Record<string, TeachingCandidate> {
  const [candidates, setCandidates] = useState<Record<string, TeachingCandidate>>({});

  // The identity of the QUESTION, so an unchanged class does not re-ask it on
  // every keystroke elsewhere in the form.
  const key = proposed
    ? [
        proposed.recurrence,
        [...proposed.weekdays].sort().join(','),
        proposed.startTime,
        proposed.endTime,
        proposed.subjectId ?? '',
        proposed.levelId ?? '',
        proposed.excludeScheduleId ?? '',
        proposed.deliveryMode ?? '',
      ].join('|')
    : '';

  const latest = useRef(proposed);
  latest.current = proposed;

  useEffect(() => {
    if (key === '') {
      setCandidates({});
      return;
    }
    let live = true;
    const query = latest.current;
    if (!query) return;
    void appraiseCandidates(query, token)
      .then((list) => {
        if (!live) return;
        setCandidates(Object.fromEntries(list.map((c) => [c.id, c])));
      })
      // Advisory: a failed appraisal leaves the picker unannotated and fully
      // usable. It must never become a reason an administrator cannot assign.
      .catch(() => {
        if (live) setCandidates({});
      });
    return () => {
      live = false;
    };
  }, [key, token]);

  return useMemo(() => candidates, [candidates]);
}
