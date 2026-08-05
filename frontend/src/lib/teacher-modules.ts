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
export type TeacherModule = PortalModule;

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
    roles: TEACHER,
    status: 'blocked',
    blockedReasonKey: 'teacher.blocked.dashboard',
  },
  {
    // §14.1: "Course Schedules … /teacher/schedules (teacher view)"; §5.6 line
    // 753 defines its content — the schedules this teacher staffs, with their
    // co-staff and roster access.
    path: '/teacher/schedules',
    labelKey: 'teacher.nav.schedules',
    roles: TEACHER,
    status: 'ready',
  },
  {
    path: '/teacher/content',
    labelKey: 'teacher.nav.content',
    roles: TEACHER,
    status: 'blocked',
    blockedReasonKey: 'teacher.blocked.content',
  },
  {
    path: '/teacher/exams',
    labelKey: 'teacher.nav.exams',
    roles: TEACHER,
    status: 'blocked',
    blockedReasonKey: 'teacher.blocked.exams',
  },
];

export const canAccess = canAccessModule;

/** The teaching modules a given session may see, in §14.1's order. */
export function visibleTeacherModules(roles: readonly string[]): TeacherModule[] {
  return visibleIn(TEACHER_MODULES, roles);
}

export function teacherModuleForPath(pathname: string): TeacherModule | null {
  return resolveModule(TEACHER_MODULES, pathname);
}

/** Whether a path belongs to the teacher portal at all. */
export function isTeacherPath(pathname: string): boolean {
  return teacherModuleForPath(pathname) !== null;
}
