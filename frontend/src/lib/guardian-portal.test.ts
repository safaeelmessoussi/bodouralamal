import { describe, expect, it } from 'vitest';

import { canAccess as canAccessModule } from './portal-modules.js';
import { homeForRole } from './role-home.js';
import {
  STUDENT_MODULES,
  canAccess,
  studentModuleForPath,
  visibleStudentModules,
} from './student-modules.js';

const account = studentModuleForPath('/dashboard/student/account')!;
const ACTING = { actingForChild: true };

/**
 * **A guardian acting for a linked child reaches the beneficiary portal**
 * (R96.1, §4.3).
 *
 * The defect this closes was not in the QR: `role-home.ts` sends a parent to
 * `/dashboard/student`, and `canAccess` refused her there — so a parent-only
 * account selecting a child was navigated straight into a permission error, and
 * every beneficiary screen was unreachable to her. Each case below fixes one
 * half of that in place.
 */
describe('the gate matches what role-home has always intended', () => {
  it('sends a parent to the beneficiary portal', () => {
    // If this ever stops being true, the cases below are testing nothing.
    expect(homeForRole('parent')).toBe('/dashboard/student');
  });

  it('admits her there when she is acting for a child', () => {
    expect(canAccess(account, ['parent'], ACTING)).toBe(true);
    expect(visibleStudentModules(['parent'], ACTING).map((m) => m.path)).toEqual(
      STUDENT_MODULES.map((m) => m.path),
    );
  });

  it('refuses a parent who has selected NOBODY — there is no subject', () => {
    expect(canAccess(account, ['parent'])).toBe(false);
    expect(visibleStudentModules(['parent'])).toEqual([]);
  });
});

describe('nothing else is broadened', () => {
  it('gives the guardian no student role — the roles list is untouched', () => {
    for (const module of STUDENT_MODULES) {
      expect(module.roles).toEqual(['student']);
      expect(module.roles).not.toContain('parent');
    }
  });

  it('leaves a beneficiary exactly as she was, acting or not', () => {
    for (const module of STUDENT_MODULES) {
      expect(canAccess(module, ['student'])).toBe(true);
    }
  });

  it('admits nobody else — a teacher or an admin is still refused', () => {
    for (const roles of [['teacher'], ['admin'], ['super_admin'], []]) {
      expect(canAccess(account, roles, ACTING)).toBe(false);
      expect(visibleStudentModules(roles, ACTING)).toEqual([]);
    }
  });

  it('changes nothing for a module that does NOT declare childContext', () => {
    // The shared predicate is what other portals use; acting for a child must
    // not open an admin or teacher node.
    const notChildScoped = { path: '/x', labelKey: 'x', roles: ['admin'], status: 'ready' } as const;
    expect(canAccessModule(notChildScoped, ['parent'], ACTING)).toBe(false);
    expect(canAccessModule(notChildScoped, ['admin'], ACTING)).toBe(true);
  });

  it('defaults to closed — omitting the context is today’s behaviour exactly', () => {
    expect(canAccessModule({ ...account }, ['parent'])).toBe(false);
  });
});

describe('every beneficiary module answers whose record it shows', () => {
  it('declares childContext, so a new one cannot be added without deciding', () => {
    // Required on `StudentModule` at the type level; asserted here because a
    // `false` would silently close a screen to every guardian.
    for (const module of STUDENT_MODULES) {
      expect(module.childContext, module.path).toBe(true);
    }
  });
});
