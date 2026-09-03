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

/**
 * **`childContext` is REQUIRED here**, unlike on the shared type (R96.1).
 *
 * This portal is read by two kinds of caller — the مستفيدة herself and a
 * **guardian acting for a linked child** — so every entry must answer *whose
 * record does this show*. Making it required means a new beneficiary module
 * cannot be added without answering it: the alternative is a screen that shows
 * a guardian **her own** data while the banner names her child.
 *
 * This is what `role-home.ts` has always assumed. It sends a parent to
 * `/dashboard/student` and records that *"the active role decides whether it
 * renders their own record or their child's"* — while `canAccess` refused her
 * on arrival, so a parent-only account selecting a child was navigated straight
 * into «ليست لديك صلاحية لعرض هذه الصفحة». The intent was written down; only
 * the gate disagreed.
 */
export type StudentModule = PortalModule & { childContext: boolean };

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
    // Reads `activeChildId` and names the child in a banner (R62.10).
    childContext: true,
    status: 'ready',
  },
  {
    /** Her own week, from `/me/calendar` (R82.8) — never the public timetable. */
    path: '/dashboard/student/calendar',
    // `/me/calendar` resolved for the acting student (R85).
    childContext: true,
    labelKey: 'student.nav.calendar',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /**
     * §5.2's library, **scoped to her enrolments and inside her frame** (R86).
     * It pointed at `/resources` — the PUBLIC index — so her sidebar vanished
     * and she landed on the whole curriculum to hunt for her own Level.
     */
    path: '/dashboard/student/library',
    // Scoped to the acting student's own enrolments (R86).
    childContext: true,
    labelKey: 'student.nav.content',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /** §4.5 — what she has memorised, as her مؤطرة recorded it. */
    path: '/dashboard/student/quran',
    // `/students/me/quran` under child context (§4.5, M4b).
    childContext: true,
    labelKey: 'student.nav.quran',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /**
     * **R124 — her own assessments**: the papers she may open, the drafts she
     * saved, and what she has sent. **Her grade is not here** — it reaches her
     * through «نقاطي» below, and only once published.
     */
    path: '/dashboard/student/assessments',
    // `/me/assessments` resolves the subject through the §4.3 middleware, so a
    // guardian reaches her child's list the same way she reaches everything
    // else.
    childContext: true,
    labelKey: 'student.nav.assessments',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /** §5.3 — published grades only, `score / max_grade` (R81). */
    path: '/dashboard/student/grades',
    // `/students/me/grades` under child context (BR-8).
    childContext: true,
    labelKey: 'student.nav.grades',
    roles: STUDENT,
    status: 'ready',
  },
  {
    /**
     * **The existing personal surface** (`/profile`), not a new one.
     *
     * R65 put `/profile` outside the portals deliberately: it is about the
     * PERSON and is reachable whatever role the account is working as. **That
     * route is unchanged**; this is the framed way in, which also carries the
     * Category/Level/Branch the Owner moved off the landing page (R86).
     */
    path: '/dashboard/student/account',
    // `/students/me` under child context — and R96's QR.
    childContext: true,
    labelKey: 'student.nav.account',
    roles: STUDENT,
    status: 'ready',
  },
];

/** The modules this session may see — the shared predicate, not a local copy. */
export function visibleStudentModules(
  roles: readonly string[],
  /** A guardian acting for a linked child reaches this portal's modules
   *  without holding — or gaining — the student role (R96.1). */
  context: { actingForChild?: boolean } = {},
): StudentModule[] {
  return visibleIn(STUDENT_MODULES, roles, context);
}

/** The module a path belongs to, or `null` — the shared resolver. */
export function studentModuleForPath(pathname: string): StudentModule | null {
  return resolveModule(STUDENT_MODULES, pathname);
}

/** Whether this session may open the module (UX layer; the server decides). */
export function canAccess(
  module: StudentModule,
  roles: readonly string[],
  context: { actingForChild?: boolean } = {},
): boolean {
  return canAccessModule(module, roles, context);
}
