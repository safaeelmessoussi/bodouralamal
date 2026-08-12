import { describe, expect, it } from 'vitest';

import { ADMIN_MODULES } from '../../lib/admin-modules.js';

/**
 * **The hierarchy المستوى → مواد المستوى → حلقات مادة, as routes.**
 *
 * `TeachingGroup` is scoped to `(subject_id, level_id)`, so a Subject's circles
 * need **two** ids. Every entry point into this area therefore lands on
 * `/admin/levels/{id}/subjects` — the Subject list — because that is where the
 * second id is chosen. It is not a detour on the way to the circles; it is the
 * step that makes them reachable.
 *
 * Two navigation bugs shared one symptom — *"I clicked حلقات مادة and got مواد
 * المستوى"* — and neither was a routing bug:
 *
 * 1. `/admin/groups`' row action was **labelled with the next screen's title**
 *    while navigating to the Subject list;
 * 2. the Subject selector navigated to `/admin/levels/{id}/subjects/` when the
 *    placeholder was chosen — an empty second segment.
 *
 * The second is what this file pins, because it is silent: the router's
 * optional capture does not match an empty segment, so the path **falls back**
 * to the Subject list rather than failing.
 */
const SUBJECT_ORG = /^\/admin\/levels\/([^/]+)\/subjects(?:\/([^/]+))?\/?$/;

/** What `AdminRouter` decides from a path — the two screens, or neither. */
function screenFor(path: string): 'level-subjects' | 'subject-organisation' | null {
  const match = SUBJECT_ORG.exec(path);
  if (!match) return null;
  return match[2] === undefined ? 'level-subjects' : 'subject-organisation';
}

describe('the two screens are chosen by the number of ids in the path', () => {
  it('one id → مواد المستوى, the step where a Subject is chosen', () => {
    expect(screenFor('/admin/levels/L1/subjects')).toBe('level-subjects');
    expect(screenFor('/admin/levels/L1/subjects/')).toBe('level-subjects');
  });

  it('two ids → حلقات مادة', () => {
    expect(screenFor('/admin/levels/L1/subjects/S1')).toBe('subject-organisation');
  });

  it('an EMPTY second segment falls back silently — which is the trap', () => {
    // `/admin/levels/L1/subjects/` is what `go('')` produced, and it renders the
    // Subject list with no error: a reader who touched the selector was simply
    // moved, with nothing to tell them why. The page now refuses to navigate on
    // the placeholder rather than relying on the router to be forgiving.
    expect(screenFor('/admin/levels/L1/subjects/')).toBe('level-subjects');
    expect(screenFor('/admin/levels/L1/subjects/S1')).not.toBe('level-subjects');
  });
});

describe('nothing links straight to the circles, and nothing should', () => {
  it('§14.1 lists no menu node carrying two ids', () => {
    // A menu cannot supply a Subject and a Level, so the circles are reachable
    // only by drilling in. That is why the Subject list is the destination of
    // every entry point rather than a screen anyone navigates to by name.
    for (const module of ADMIN_MODULES) {
      expect(module.path, module.path).not.toMatch(/\/subjects\/[^/]+$/);
    }
  });

  it('the Levels module is the ancestor both screens hang off', () => {
    expect(ADMIN_MODULES.map((m) => m.path)).toContain('/admin/levels');
  });
});
