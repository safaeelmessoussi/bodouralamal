import { describe, expect, it } from 'vitest';

import { t } from '../i18n/index.js';
import { ADMIN_MODULES } from './admin-modules.js';
import {
  TEACHER_MODULES,
  TEACHER_SECTIONS,
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
    // **Two nodes joined, and one of them had existed all along.**
    // `/teacher/quran` has had a page and a router case since M4 and **no
    // registry entry**, so the capability was complete and unreachable — rule
    // P's defect.
    //
    // **`/teacher/calendar` left this list on 2026-08-20**, and the property is
    // restated rather than dropped: it and `/teacher/schedules` were two menu
    // entries onto the same operational question, so a مؤطرة had to know which
    // of the two held what she wanted. The MENU offers الجدولة alone; the old
    // PATH still renders the merged page, which is why the router test below
    // still names it and this one does not.
    expect(TEACHER_MODULES.map((m) => m.path).sort()).toEqual(
      [
        '/teacher',
        '/teacher/content',
        '/teacher/exams',
        '/teacher/quran',
        '/teacher/schedules',
      ].sort(),
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
    // **R87 §M — the role is no longer sufficient for every entry.** «إدخال
    // الحفظ» additionally requires actually staffing a Quran class, so the full
    // list needs the capability as well as the role.
    expect(visibleTeacherModules(['teacher'], { teachesQuran: true })).toHaveLength(
      TEACHER_MODULES.length,
    );
    expect(visibleTeacherModules(['admin'])).toHaveLength(0);
    expect(visibleTeacherModules([])).toHaveLength(0);
  });

  /**
   * **A capability hides a menu entry; it authorises nothing** (R87 §M).
   *
   * A مؤطرة teaching only Tafseer holds the teacher role and must not meet
   * «إدخال الحفظ» — the condition is staffing a schedule whose Subject carries
   * R73's marker, never the role, a declared capability or the Subject's name.
   * The server refuses the write regardless of what the menu shows.
   */
  it('hides إدخال الحفظ from a teacher with no Quran assignment', () => {
    const withQuran = visibleTeacherModules(['teacher'], { teachesQuran: true });
    const without = visibleTeacherModules(['teacher'], { teachesQuran: false });

    expect(withQuran.some((m) => m.path === '/teacher/quran')).toBe(true);
    expect(without.some((m) => m.path === '/teacher/quran')).toBe(false);
    // Exactly one entry differs: gating one module must not hide another.
    expect(without).toHaveLength(withQuran.length - 1);
  });

  it('hides it when the capability is unknown, which is the safe direction', () => {
    // A caller that has not asked the server sees LESS, rather than an entry the
    // server would then refuse.
    expect(
      visibleTeacherModules(['teacher']).some((m) => m.path === '/teacher/quran'),
    ).toBe(false);
  });

  it('resolves sub-paths to their parent, longest match winning', () => {
    expect(teacherModuleForPath('/teacher')?.path).toBe('/teacher');
    expect(teacherModuleForPath('/teacher/schedules')?.path).toBe('/teacher/schedules');
    // A module owns its internal views without registering each as a node.
    expect(teacherModuleForPath('/teacher/schedules/abc')?.path).toBe('/teacher/schedules');
    expect(teacherModuleForPath('/teacher-not-really')).toBeNull();
    expect(teacherModuleForPath('/admin')).toBeNull();
  });

  it('marks the schedules module ready — it shares the back office endpoint', () => {
    // The Document Owner decided (2026-08-05) to role-scope
    // GET /admin/course-schedules rather than add a teacher route returning the
    // identical representation. `ready` here is the registry's promise that a
    // screen exists; the router's switch is what keeps it.
    expect(TEACHER_MODULES.find((m) => m.path === '/teacher/schedules')?.status).toBe('ready');
  });

  it('names what each blocked module is waiting for', () => {
    // §14.4 forbids the blank page; "coming soon" tells nobody whether the wait
    // is a day or a milestone.
    for (const module of TEACHER_MODULES) {
      if (module.status === 'blocked') expect(module.blockedReasonKey).toBeTruthy();
    }
  });
});

/**
 * **The مؤطرة's scheduling and content access** (2026-08-17).
 *
 * The Document Owner asked for her menu to show `الجدولة` and `مكتبة المحتوى`.
 * The audit found the **access already granted** — `/teacher/schedules` (R72 gave
 * her Activity authoring) and `/teacher/content` were both `ready` — and the
 * *labels* to be what misled: they read «حصصي» and «المحتوى التعليمي», so one
 * platform named one concept two ways and she could not tell she was looking at
 * the same feature the back office calls الجدولة.
 *
 * So this pins **both halves**: the words are the back office's, and **no
 * `/admin/*` path is in her menu**. `مكتبة المحتوى` in the back office *is*
 * `/admin/content`, the staff-wide library — pointing her at it would have been
 * an authorization change dressed as a rename, and it is the specific mistake
 * this guard exists to catch.
 */
describe('the مؤطرة reaches her own scheduling and content, and nothing else', () => {
  it('carries both nodes, ready, in her own portal', () => {
    for (const path of ['/teacher/schedules', '/teacher/content']) {
      const module = TEACHER_MODULES.find((m) => m.path === path);
      expect(module, path).toBeDefined();
      expect(module!.status, path).toBe('ready');
      expect(module!.roles, path).toContain('teacher');
    }
  });

  it('offers no back-office path — access is never widened to fix a label', () => {
    for (const module of TEACHER_MODULES) {
      expect(module.path.startsWith('/admin'), module.path).toBe(false);
      expect(module.path.startsWith('/superadmin'), module.path).toBe(false);
    }
  });

  it('groups her nodes into the three teaching sections, in order', () => {
    expect([...TEACHER_SECTIONS]).toEqual(['teaching', 'scheduling', 'content']);
    const sectionOf = (path: string): string | null =>
      TEACHER_MODULES.find((m) => m.path === path)?.section ?? null;
    expect(sectionOf('/teacher/exams')).toBe('teaching');
    expect(sectionOf('/teacher/schedules')).toBe('scheduling');
    expect(sectionOf('/teacher/content')).toBe('content');
    // The dashboard sits above the groups, like the back office's.
    expect(sectionOf('/teacher')).toBeNull();
  });

  it('every section heading resolves to Arabic, never to the key', () => {
    for (const section of TEACHER_SECTIONS) {
      const key = `teacher.section.${section}`;
      expect(t(key), key).not.toBe(key);
    }
  });

  it('uses the back office’s own words for the two shared concepts', () => {
    // The defect was two vocabularies for one platform. Asserted against the
    // ADMIN catalogue rather than against literals, so the two cannot drift apart
    // again — which is the whole property.
    //
    // **Restated for R105**: this read `admin.section.scheduling`, and R105
    // removed that heading with the four decorative sections. The word it was
    // reaching for is the back office's NAV entry — the same thing the line
    // below already compares against — so the guard now asks the question it
    // meant to ask, and asks it the same way twice.
    expect(t('teacher.nav.schedules')).toBe(t('admin.nav.scheduling'));
    expect(t('teacher.nav.content')).toBe(t('admin.nav.content'));
  });
});
