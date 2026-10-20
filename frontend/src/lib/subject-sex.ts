import { useSyncExternalStore } from 'react';

import { setTextSubject, type SubjectSex } from '../i18n/index.js';

/**
 * **SRS Revision 229 — the student portal speaks of its subject in her or his
 * own gender** (the Owner, 2026-10-20: «لوحة المستفيد(ة) should change based
 * on the sex of the user … do same for anything else that can be identified by
 * the user's sex»).
 *
 * The subject is the ACTING student — the account holder, or the child a
 * guardian acts for — read from `GET /students/me`. Remembered for the tab
 * (sessionStorage, per account and child) so the next page reads right from its
 * first paint; until it is known, the bracket form «المستفيد(ة)» stands.
 */
let current: SubjectSex | null = null;
const listeners = new Set<() => void>();

const keyFor = (userId: string, childId: string | null): string => `bodour.subject-sex.${userId}.${childId ?? 'self'}`;

/** Called while the portal renders: the remembered sex, before any request. */
export function primeSubjectSex(userId: string | null, childId: string | null): void {
  if (userId === null || current !== null) return;
  try {
    const stored = window.sessionStorage.getItem(keyFor(userId, childId));
    if (stored === 'female' || stored === 'male') {
      current = stored;
      setTextSubject(stored);
    }
  } catch {
    // Storage refused: the first answer from the server will do.
  }
}

export function setSubjectSex(userId: string | null, childId: string | null, sex: SubjectSex | null): void {
  if (sex === current) return;
  current = sex;
  setTextSubject(sex);
  if (userId !== null && sex !== null) {
    try {
      window.sessionStorage.setItem(keyFor(userId, childId), sex);
    } catch {
      // Not remembered: asked again next page.
    }
  }
  for (const listener of listeners) listener();
}

/** Re-renders a component when the subject's sex becomes known. */
export function useSubjectSex(): SubjectSex | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
