import { describe, expect, it } from 'vitest';

import { ADMIN_MODULES } from './admin-modules.js';
import {
  TEACHER_MODULES,
  teacherModuleForPath,
  visibleTeacherModules,
} from './teacher-modules.js';

/**
 * The Teacher portal registry.
 *
 * The properties asserted here are the ones that would otherwise fail silently:
 * a navigation entry with no route, a module a role may not open, and — the one
 * specific to having *several* portals — a path that resolves into the wrong
 * application.
 */
describe('the teacher registry matches §14.1', () => {
  it('lists every teaching node the sitemap defines, and no others', () => {
    expect(TEACHER_MODULES.map((m) => m.path).sort()).toEqual(
      ['/teacher', '/teacher/content', '/teacher/exams', '/teacher/schedules'].sort(),
    );
  });

  it('shares no path with the back office', () => {
    // The registries are separate applications, not two views of one list. An
    // overlapping path would make resolution depend on which registry a caller
    // happened to ask, and the two would answer differently.
    const admin = new Set(ADMIN_MODULES.map((m) => m.path));
    for (const module of TEACHER_MODULES) {
      expect(admin.has(module.path)).toBe(false);
    }
  });

  it('admits a teacher and refuses an administrator', () => {
    // Revision 30: teachers do not browse reference data, and the converse
    // holds here — the teaching portal is not a second door into the back
    // office. The server enforces TD-2 regardless; this is the UX layer.
    expect(visibleTeacherModules(['teacher'])).toHaveLength(TEACHER_MODULES.length);
    expect(visibleTeacherModules(['admin'])).toHaveLength(0);
    expect(visibleTeacherModules([])).toHaveLength(0);
  });

  it('resolves sub-paths to their parent, longest match winning', () => {
    expect(teacherModuleForPath('/teacher')?.path).toBe('/teacher');
    expect(teacherModuleForPath('/teacher/schedules')?.path).toBe('/teacher/schedules');
    // A module owns its internal views without registering each as a node.
    expect(teacherModuleForPath('/teacher/schedules/abc')?.path).toBe('/teacher/schedules');
    expect(teacherModuleForPath('/teacher-not-really')).toBeNull();
    expect(teacherModuleForPath('/admin')).toBeNull();
  });

  it('names what each blocked module is waiting for', () => {
    // §14.4 forbids the blank page; "coming soon" tells nobody whether the wait
    // is a day or a milestone.
    for (const module of TEACHER_MODULES) {
      if (module.status === 'blocked') expect(module.blockedReasonKey).toBeTruthy();
    }
  });
});
