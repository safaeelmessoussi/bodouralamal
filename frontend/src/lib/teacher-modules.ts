import {
  canAccess as canAccessModule,
  resolveModule,
  visibleIn,
  type PortalModule,
} from './portal-modules.js';

/**
 * The **Teacher portal** navigation registry — §14.1's teaching branch.
 *
 * Deliberately its own list rather than rows in `ADMIN_MODULES` with a portal
 * flag. The two are different *kinds* of list: the back office is §14.1's five
 * grouped sections of administration, and this is a short flat set of teaching
 * workflow entries. Mixing them would make *"the back office is exactly those
 * five sections"* a filter you have to apply rather than a fact you can read,
 * and every consumer would carry the same filter.
 *
 * The mechanics — role gating, path resolution, the status vocabulary — are
 * shared in [`portal-modules.ts`](./portal-modules.ts), so this file is only the
 * list. A future Student/Parent portal adds its own list the same way.
 *
 * **Teachers do not browse reference data** (Revision 30): a teacher receives
 * branch, room, level and subject information *through the operational APIs
 * they are authorised to use*, never by browsing reference-data endpoints. That
 * is why there is no Levels or Branches entry here and must not be one.
 */
/**
 * §14.1's grouping, applied to the teaching branch (2026-08-17).
 *
 * The sidebar was a **flat list**, so a مؤطرة met «حصصي» and «المحتوى التعليمي»
 * as four unrelated entries while the same concepts sat under «الجدولة» and
 * «المحتوى» in the back office — one platform with two vocabularies and two
 * shapes for one thing. Grouping is a *presentation* change and grants nothing:
 * the paths, the roles and the server's §4.4c scope resolution are untouched.
 *
 * `teaching` is this branch's own — it collects what she does with the students
 * she teaches (marking, Quran progress) and has no back-office counterpart,
 * because the back office is not organised around one person's caseload.
 */
export type TeacherSection = 'teaching' | 'scheduling' | 'content';

/** Rendered in exactly this order, like `ADMIN_SECTIONS`. */
export const TEACHER_SECTIONS: readonly TeacherSection[] = ['teaching', 'scheduling', 'content'];

export interface TeacherModule extends PortalModule {
  /** `null` sits above the groups, like the back office's dashboard. */
  section: TeacherSection | null;
}

const TEACHER = ['teacher'] as const;

/**
 * §14.1's teaching nodes, in its order.
 *
 * `/teacher/schedules` is live: the Document Owner decided (2026-08-05) that
 * `GET /admin/course-schedules` is **role-scoped on one endpoint** rather than
 * duplicated per audience, so the teacher portal consumes the same route and
 * receives the schedules they staff. The rest stay `blocked` with specific
 * reasons rather than "coming soon".
 */
export const TEACHER_MODULES: readonly TeacherModule[] = [
  {
    path: '/teacher',
    labelKey: 'teacher.nav.dashboard',
    section: null,
    roles: TEACHER,
    // R83.4/R83.5 — it was `blocked` because there was nothing to put on it.
    // There is now: what she has been told, and her own week.
    status: 'ready',
  },
  {
    /**
     * **تقويمي** — her own week, from `/me/calendar` (R82.8).
     *
     * Its own node rather than the dashboard's content: the dashboard stays
     * deliberately minimal until it is designed, and a calendar somebody opens
     * daily should be one click from the menu rather than something they scroll
     * a landing page to reach.
     */
    path: '/teacher/calendar',
    labelKey: 'teacher.nav.calendar',
    section: 'teaching',
    roles: TEACHER,
    status: 'ready',
  },
  {
    /**
     * **إدخال الحفظ** — recording a beneficiary's memorisation (§4.5, R73).
     *
     * The page and the router case have existed since M4; **the registry entry
     * had not**, so the capability was complete and unreachable — rule P's
     * defect for the seventh time. Nothing about the screen changes here; it
     * gains the menu entry it never had.
     */
    path: '/teacher/quran',
    labelKey: 'teacher.nav.quran',
    section: 'teaching',
    roles: TEACHER,
    status: 'ready',
    /**
     * **R87 §M — only for somebody who actually teaches Quran.** A مؤطرة
     * teaching only Tafseer holds the same role and must not see this entry;
     * the condition is staffing a schedule whose Subject carries R73's marker,
     * never the role, a declared capability or the Subject's name.
     */
    requiresCapability: 'teachesQuran',
  },
  {
    // R70 — unblocked for **grading**. §4.6's online paper builder is still
    // declared and refused, so what this node opens is the grade sheet, which
    // is the same component `/admin/exam-grades` renders (R70.1).
    path: '/teacher/exams',
    labelKey: 'teacher.nav.exams',
    section: 'teaching',
    roles: TEACHER,
    status: 'ready',
  },
  {
    /**
     * §14.1: *"Course Schedules … /teacher/schedules (teacher view)"*; §5.6 line
     * 753 defines its content — the schedules this teacher staffs, with their
     * co-staff and roster access. R72 added Activity authoring in her own scope.
     *
     * **Labelled «الجدولة», the back office's own word** (2026-08-17). It read
     * «حصصي», which named the same concept differently in the two portals. **No
     * access changed**: the path is the same, the role is the same, and the
     * schedules she receives are still exactly those §4.4c resolves from the
     * ones she staffs — the server decides that, not this registry.
     *
     * **`/admin/schedules` is deliberately NOT offered to her.** That screen is
     * every branch's scheduling, and putting it in this menu would be widening
     * authorization to fix a vocabulary problem.
     */
    path: '/teacher/schedules',
    labelKey: 'teacher.nav.schedules',
    section: 'scheduling',
    roles: TEACHER,
    status: 'ready',
  },
  {
    /**
     * §5.5: file attach with progress and retry, visibility honouring the
     * Category default, and **no Global scope** — the server enforces all three
     * (§4.9), and the screen renders its refusals rather than reimplementing them.
     *
     * **Labelled «مكتبة المحتوى»**, for the same reason as the schedules node.
     * §14.1 lists this path as *Upload / Record* and `/admin/content` as
     * *Content Library*; the two are the same library seen from two authorities,
     * and calling one «المحتوى التعليمي» made a مؤطرة believe she was looking at
     * a different feature. **`/admin/content` is NOT offered to her** — that is
     * the staff-wide library, and pointing her at it would be an authorization
     * change dressed as a rename.
     */
    path: '/teacher/content',
    labelKey: 'teacher.nav.content',
    section: 'content',
    roles: TEACHER,
    status: 'ready',
  },
];

export const canAccess = canAccessModule;

/** The teaching modules a given session may see, in §14.1's order. */
export function visibleTeacherModules(
  roles: readonly string[],
  capabilities: { teachesQuran?: boolean } = {},
): TeacherModule[] {
  return visibleIn(TEACHER_MODULES, roles, capabilities);
}

export function teacherModuleForPath(pathname: string): TeacherModule | null {
  return resolveModule(TEACHER_MODULES, pathname);
}

/** Whether a path belongs to the teacher portal at all. */
export function isTeacherPath(pathname: string): boolean {
  return teacherModuleForPath(pathname) !== null;
}
