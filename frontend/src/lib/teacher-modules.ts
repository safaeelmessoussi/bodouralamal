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
 * **This menu has no groups (SRS Revision 106).**
 *
 * It had three — `التدريس`, `الجدولة`, `المحتوى` — added in 2026-08-17 to make
 * the two portals read alike. R105 removed the back office's decorative
 * headings on a rule this menu fails just as plainly: **a section exists only
 * where the heading states a fact about permission.** These three gated
 * nothing, and a menu of six entries needs no finding aids. The type is kept as
 * `never` rather than deleted so that a module reintroducing a section fails to
 * compile, which is a clearer signal than a heading quietly reappearing.
 */
export type TeacherSection = never;

/** No groups (R106). Kept so the layout's loop has something to read. */
export const TEACHER_SECTIONS: readonly TeacherSection[] = [];

export interface TeacherModule extends PortalModule {
  /** Always `null` now — see `TeacherSection`. */
  section: TeacherSection | null;
}

const TEACHER = ['teacher'] as const;

/**
 * §14.1's teaching nodes, **in the Document Owner's order** (R106).
 *
 * The order is the menu, exactly as `ADMIN_MODULES` is — pinned literally in
 * `teacher-modules.test.ts`, because §14.1's *"no reshuffling"* can only be
 * honoured by a generated menu if reordering this array fails a test.
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
     * **إدخال متى أنا متاحة — R106, and the question R88 deliberately left open.**
     *
     * R88.2 refused it in terms: *"a مؤطِّرة may not edit her own, because who
     * may assert their own availability, and whether the administration may
     * then rely on it, is a separate decision the Owner has not taken."* The
     * Owner has now taken it, narrowly — **`TeacherAvailability` only**. What
     * she may *teach* stays the administration's record of her.
     *
     * **No capability condition, and that is deliberate.** Unlike the Quran
     * node below, availability is meaningful for every مؤطِّرة whatever she
     * teaches — including one who currently staffs nothing, whose availability
     * is exactly what the administration needs in order to give her a class.
     */
    path: '/teacher/availability',
    labelKey: 'teacher.nav.availability',
    section: null,
    roles: TEACHER,
    status: 'ready',
  },
  {
    /**
     * **إدخال حفظ المستفيدات** — recording a beneficiary's memorisation
     * (§4.5, R73). Renamed by R106: *whose* memorisation, said plainly — hers
     * is not what is being recorded.
     *
     * The page and the router case have existed since M4; **the registry entry
     * had not**, so the capability was complete and unreachable — rule P's
     * defect for the seventh time. Nothing about the screen changed then either.
     */
    path: '/teacher/quran',
    labelKey: 'teacher.nav.quran',
    section: null,
    roles: TEACHER,
    status: 'ready',
    /**
     * **R87 §M — only for somebody who actually teaches Quran.** A مؤطرة
     * teaching only Tafseer holds the same role and must not see this entry;
     * the condition is staffing a schedule whose Subject carries R73's marker,
     * never the role, a declared capability or the Subject's name.
     *
     * **Kept by R106, which lists the node unconditionally in §14.1.** The two
     * do not conflict: the sitemap states what the menu contains, and this
     * states who is shown it. It mirrors a rule the SERVER already enforces —
     * without it the entry opens a screen `assertCanManageQuranProgress` will
     * empty — so it is a menu agreeing with the boundary, never standing in
     * for one.
     */
    requiresCapability: 'teachesQuran',
  },
  {
    // R70 — unblocked for **grading**. §4.6's online paper builder is still
    // declared and refused, so what this node opens is the grade sheet, which
    // is the same component `/admin/exam-grades` renders (R70.1).
    //
    // Renamed **إدخال نقاط الامتحانات** by R106: she enters marks here rather
    // than browsing a report, and the verb is what the other entries carry.
    path: '/teacher/exams',
    labelKey: 'teacher.nav.exams',
    section: null,
    roles: TEACHER,
    status: 'ready',
  },
  {
    /**
     * §14.1: *"Course Schedules … /teacher/schedules (teacher view)"*; §5.6 line
     * 753 defines its content — the schedules this teacher staffs, with their
     * co-staff and roster access. R72 added Activity authoring in her own scope
     * and R94 added Exam authoring beside it.
     *
     * **R106 adds the occurrences beneath it** — `/teacher/schedules/{id}/sessions`
     * — which TD-2 has granted since R43 (*"CRUD Sessions ✔ (only sessions they
     * staff)"*) and no screen had ever offered. It is a parameterised view and
     * not a menu node, exactly like `/admin/schedules/{id}/sessions`: the path
     * carries an id, so nothing can link to it from a menu.
     *
     * **`/admin/schedules` is deliberately NOT offered to her.** That screen is
     * every branch's scheduling, and putting it in this menu would be widening
     * authorization to fix a vocabulary problem.
     */
    path: '/teacher/schedules',
    labelKey: 'teacher.nav.schedules',
    section: null,
    roles: TEACHER,
    status: 'ready',
  },
  {
    /**
     * §5.5: file attach with progress and retry, visibility honouring the
     * Category default, and **no Global scope** — the server enforces all three
     * (§4.9), and the screen renders its refusals rather than reimplementing them.
     *
     * **`/admin/content` is NOT offered to her** — that is the staff-wide
     * library, and pointing her at it would be an authorization change dressed
     * as a rename. R106 leaves this node untouched in every respect.
     */
    path: '/teacher/content',
    labelKey: 'teacher.nav.content',
    section: null,
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
