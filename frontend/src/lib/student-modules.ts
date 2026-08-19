import {
  canAccess as canAccessModule,
  resolveModule,
  visibleIn,
  type PortalModule,
} from './portal-modules.js';

/**
 * The **beneficiary's** navigation registry.
 *
 * Its own list, exactly as `teacher-modules.ts` is and for the reason that file
 * records: these are different *kinds* of list, and mixing them would make
 * *"the back office is exactly §14.1's five sections"* a filter you apply rather
 * than a fact you read. The mechanics — role gating, path resolution, the status
 * vocabulary — are shared in [`portal-modules.ts`](./portal-modules.ts), so this
 * file is only the list.
 *
 * **Every entry opens a screen that already exists.** Nothing here is new
 * capability: her calendar, her library, her memorisation, her grades and her
 * account were all built and reachable only by typing a URL or from one
 * dashboard. A registry entry is what makes a capability *reachable*, which is
 * the defect rule P names and this project has now paid for eight times.
 *
 * **No sections.** The back office groups five; a beneficiary has five entries
 * and grouping them would be chrome around a list short enough to read at once.
 */
const STUDENT = ['student'] as const;

export type StudentModule = PortalModule;

export const STUDENT_MODULES: readonly StudentModule[] = [
  {
    /**
     * **لوحة المستفيدة — deliberately minimal, for now.**
     *
     * The Owner asked that it stay empty until it is designed, and that «حصص
     * اليوم والقادمة» be removed from it: those occurrences are in تقويمي, and
     * showing them twice makes one of the two the wrong place to look.
     */
    path: '/dashboard/student',
    labelKey: 'student.nav.dashboard',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /** Her own week, from `/me/calendar` (R82.8) — never the public timetable. */
    path: '/dashboard/student/calendar',
    labelKey: 'student.nav.calendar',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /**
     * §5.2's library at **her** tier. The same screen the back office and the
     * teacher portal render; what differs is what the server returns, which is
     * where it belongs (§4.9).
     */
    path: '/resources',
    labelKey: 'student.nav.content',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /** §4.5 — what she has memorised, as her مؤطرة recorded it. */
    path: '/dashboard/student/quran',
    labelKey: 'student.nav.quran',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /** §5.3 — published grades only, `score / max_grade` (R81). */
    path: '/dashboard/student/grades',
    labelKey: 'student.nav.grades',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /**
     * **The existing personal surface** (`/profile`), not a new one.
     *
     * R65 put it outside the portals deliberately: it is about the PERSON and
     * is reachable whatever role the account is working as. Listing it here is
     * a way in, not a second implementation.
     */
    path: '/profile',
    labelKey: 'student.nav.account',
    roles: STUDENT,
    status: 'ready',
  },
];

/** The modules this session may see — the shared predicate, not a local copy. */
export function visibleStudentModules(roles: readonly string[]): StudentModule[] {
  return visibleIn(STUDENT_MODULES, roles);
}

/** The module a path belongs to, or `null` — the shared resolver. */
export function studentModuleForPath(pathname: string): StudentModule | null {
  return resolveModule(STUDENT_MODULES, pathname);
}

/** Whether this session may open the module (UX layer; the server decides). */
export function canAccess(module: StudentModule, roles: readonly string[]): boolean {
  return canAccessModule(module, roles);
}
