/**
 * The administrative module registry — **the single source for the back-office
 * navigation, its routing and its role gating.**
 *
 * §14.1's sitemap is authoritative: *"AI agents must implement exactly this
 * navigation hierarchy — no invented sections, no reshuffling."* Holding it as
 * data rather than as JSX in three places is what makes that checkable: the
 * sidebar, the router and the role guard all read this list, so a module cannot
 * appear in the menu without a route, or be reachable without its permission.
 *
 * Adding a module is **one entry here**. Forgetting one of the three wirings is
 * no longer possible.
 *
 * **`status` is not decoration.** A module whose endpoints do not exist yet
 * renders an explicit, named "not built" state instead of a blank screen — §14.4
 * forbids the blank page, and naming *what* is missing is what stops the same
 * investigation being repeated. It is also the honest signal to the Document
 * Owner about where the back office actually stands.
 */
import {
  canAccess as canAccessModule,
  resolveModule,
  visibleIn,
  type ModuleStatus,
  type PortalModule,
} from './portal-modules.js';

/**
 * A back-office node: a portal module plus §14.1's grouping.
 *
 * `section` is the one thing that is genuinely admin-shaped — §14.1 groups the
 * back office and gives the teacher portal no equivalent — so it lives here
 * rather than in the shared layer.
 */
export interface AdminModule extends PortalModule {
  /** §14.1's grouping. `null` is the main list, which is now most of the menu. */
  section: AdminSection | null;
}

export type { ModuleStatus };

/**
 * **§14.1 has ONE group now — الإدارة (Revision 105).**
 *
 * It used to have five: `academic`, `people`, `scheduling`, `content` and
 * `administration`. The Document Owner collapsed the first four into a single
 * flat list, and the reason is worth keeping, because it is the argument
 * against re-introducing them:
 *
 * **الإدارة is the only group that MEANS anything.** Every node inside it is
 * Super-Admin-only *by placement* (R61), so the heading is a statement about
 * authority that a reader can act on. The other four headings sorted eleven
 * destinations into buckets that carried no such consequence — `الأشخاص` and
 * `الشؤون التعليمية` gate nothing, and a menu of eleven items does not need
 * finding aids. Worse, `Administration` appeared **twice** in the §14.1 tree
 * (once holding Trash, once holding the configuration nodes), which is what a
 * grouping looks like when it has stopped describing anything.
 *
 * So the rule is now: **a section exists only where the heading is a fact about
 * permission.** Adding a decorative group back is a change to §14.1, not a
 * layout preference.
 */
export type AdminSection = 'administration';

/** §14.1's group order — one group, rendered after the main list. */
export const ADMIN_SECTIONS: readonly AdminSection[] = ['administration'];

const STAFF = ['admin', 'super_admin'] as const;
const SUPER_ONLY = ['super_admin'] as const;

/**
 * Every back-office node §14.1 defines, **in the Document Owner's order**
 * (Revision 105).
 *
 * **This array's order IS the navigation order and IS the dashboard order.**
 * The sidebar renders it as it stands and the dashboard launcher maps the same
 * list, so the two cannot disagree — which is the whole reason the registry
 * exists. `admin-modules.test.ts` pins both sequences literally, so a
 * well-meant reshuffle fails a test instead of quietly changing §14.1.
 *
 * Reference-data modules list **both** roles where §14.1 marks them *"read:
 * Admin · write: Super Admin"* (Revision 26) — but every node in الإدارة is
 * `SUPER_ONLY` because R61 makes the SECTION the gate. The distinction that
 * survives is between the SCREEN and the ENDPOINT: `GET /admin/levels`,
 * `/admin/categories`, `/admin/subjects` and `/admin/branches` stay
 * Admin-readable, because scheduling, enrolment and every scope selector feed
 * from them (R61.2). **The menu is never the boundary** — the server enforces
 * TD-2 on every request, and R105 changed no permission at all.
 */
export const ADMIN_MODULES: readonly AdminModule[] = [
  {
    path: '/admin',
    labelKey: 'admin.nav.dashboard',
    section: null,
    roles: STAFF,
    status: 'ready',
  },

  // ── The main list (Revision 105) ──────────────────────────────────────────
  //
  // **Ordered by the working day, not by the data model.** The previous order
  // was the dependency chain — Category contains Level contains Group — which
  // is how the platform is BUILT and not how it is USED; and the configuration
  // half of that chain has since moved to الإدارة anyway, so the operational
  // half was left reading like the remains of a hierarchy.
  //
  // What the Owner ordered instead is the sequence an administrator actually
  // moves through: someone applies (طلبات الانضمام), becomes an account
  // (المستخدمون), the people who teach are set up (المؤطِّرات) and the people
  // taught are placed (المستفيدات), those two populations are divided
  // (مجموعات المستويات, حلقات المواد), what happens in class is recorded
  // (إدخال الحفظ, نقاط الامتحانات), and the supporting surfaces close the list
  // (الجدولة, مكتبة المحتوى).
  {
    path: '/admin/approvals',
    labelKey: 'admin.nav.approvals',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    /**
     * **المستخدمون — global ACCOUNT administration, Super Admin only** (Owner
     * clarification, 2026-08-28).
     *
     * It was `STAFF`. The Owner's separation is between *managing operational
     * data*, which an Admin does, and *administering accounts* — every person on
     * the platform, their address, their status, their roles and the power to
     * delete them — which is not an operational concern at all.
     *
     * **This entry is not the enforcement.** `listUsers` asserts Super Admin in
     * the service, so an Admin who types the URL still receives `403` and an
     * empty screen; the menu merely stops offering what the server refuses. An
     * Admin who needs to pick a person reaches `/admin/directory`, which is a
     * different endpoint with a deliberately smaller projection.
     */
    path: '/admin/users',
    labelKey: 'admin.nav.users',
    section: null,
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **طلبات الحساب المستقل — R132, Super Admin only.**
     *
     * A former minor at 18 asks to hold her own login. Deciding it is an
     * ACCOUNT act, so it sits beside `المستخدمون` under the same authority
     * (R112) rather than in the operational `طلبات الانضمام` queue an Admin
     * reaches — approving one binds a credential to a person's record, which is
     * the most takeover-sensitive decision the platform offers.
     *
     * As with every entry, this is reach and not enforcement: the service
     * asserts Super Admin, so a typed URL still receives `403`.
     */
    path: '/admin/self-managed-claims',
    labelKey: 'admin.nav.selfManagedClaims',
    section: null,
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **طلبات استعادة حساب** (Owner, 2026-09-04) — beside the self-managed
     * queue and NOT merged into it. That one transitions a live account to its
     * adult; this one reopens a CLOSED account, which is a materially different
     * and heavier decision, and one queue carrying both would be a queue in
     * which a reviewer cannot see which she is taking.
     *
     * As with every entry, this is reach and not enforcement: the service
     * asserts Super Admin, so a typed URL still receives `403`.
     */
    path: '/admin/account-return-requests',
    labelKey: 'admin.nav.accountReturns',
    section: null,
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **المؤطِّرات — the people who TEACH** (R88; renamed by R105).
     *
     * It was `إدارة المؤطِّرات`. The word *إدارة* named the screen's verb rather
     * than its subject, and no sibling did that — `المستخدمون` is not
     * *«إدارة المستخدمين»* — so one entry in eleven announced that it was a
     * management screen when every entry in the menu is one.
     *
     * Its R88 teaching profile lives here: declared Subjects, declared
     * Categories, declared availability. **Planning data only; it grants
     * nothing** (R88.3, §4.4c) — authority comes from an assignment.
     *
     * Immediately BEFORE المستفيدات, by the Owner: the two remain a pair —
     * the people who teach, then the people taught.
     */
    path: '/admin/teachers',
    labelKey: 'admin.nav.teachers',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    /**
     * **المستفيدات — enrolment** (R74; renamed by R105).
     *
     * It was `التسجيلات`, which named the *rows* — enrolment records. The menu
     * everywhere else names the **population** a screen is about
     * (`المستخدمون`, `المؤطِّرات`), and an administrator opening this comes
     * looking for a beneficiary, not for a record of one.
     *
     * **The model is untouched**: this is still Level enrolment with an
     * optional Group (R66/R74), and the group roster remains the per-group view
     * of the same rows. Only the word changed.
     */
    path: '/admin/enrollments',
    labelKey: 'admin.nav.enrollments',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    // How a LEVEL is subdivided, and who is in each group. Touches no Subject
    // (R69.5).
    path: '/admin/groups',
    labelKey: 'admin.nav.groups',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    /**
     * How a SUBJECT within a Level is subdivided, and who attends (R69).
     *
     * Structure is Super Admin and MEMBERSHIP is Admin, branch-scoped (R43.3) —
     * the screen gates its own write controls and the server decides. That
     * split is why it is an operational node and not a configuration one, and
     * R105 does not disturb it.
     */
    path: '/admin/teaching-groups',
    labelKey: 'admin.nav.teachingGroups',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    /**
     * **§C4 — إدخال الحفظ had no back-office node at all** (2026-08-20).
     *
     * `assertCanManageQuranProgress` has granted an Admin their branches'
     * beneficiaries and a Super Admin everyone **since R73**, and
     * `POST /quran-logs` has enforced it — but §14.1 listed the capability
     * nowhere in the back office, so nobody could use it. Rule **P**, and the
     * seventh instance of it on this project.
     *
     * **Operational, so it is in the main list** — an act on a beneficiary's
     * record, the same kind of thing as grade entry beside it, not the
     * configuration of a curriculum. `مقرّر الحفظ` (`/admin/level-surahs`) is
     * the configuration half and stays in الإدارة; this consumes it.
     *
     * `STAFF` because both Admin and Super Admin enter progress, each within
     * the reach TD-2 gives them. The server decides which; the node does not.
     */
    path: '/admin/quran',
    labelKey: 'admin.nav.quran',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    /**
     * **بناء الاختبارات** (R124) — the online assessment builder.
     *
     * Beside «نقاط الامتحانات» because they are two halves of one thing: this
     * writes the paper, that one marks it. **It is not in الإدارة**: R61 makes
     * that section Super-Admin-only by placement, and authoring an assessment
     * is a مؤطِّرة's work within her own teaching (TD-2 as split by R70.4).
     *
     * The list is empty until a paper exists, which is ordinary — and the one
     * action, «اختبار جديد», is what a data-first page offers when there is
     * nothing yet (rule A/§14.4), not a filter standing in the way.
     */
    path: '/admin/assessments',
    labelKey: 'admin.nav.assessments',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    /**
     * R70.1 — grade entry had no node at all: §14.1 listed grading under
     * `/teacher/exams` while R56/R58 put exam scheduling on `/admin/schedules`,
     * so an Admin could reach no sheet. `?exam=` is the deep link, the pattern
     * `/resources` set and R69 applied twice — a second path segment would be a
     * node §14.1 does not list.
     */
    path: '/admin/exam-grades',
    labelKey: 'admin.nav.examGrades',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    // **R56 — one node for everything that appears on the calendar.** R51 put
    // Events and Course Schedules in one section; this makes them one screen,
    // with the type as a field on the form rather than a navigation decision.
    // The MODELS are unchanged (§4.4, §20 rule 22) — only what a person is
    // asked, and when.
    path: '/admin/schedules',
    labelKey: 'admin.nav.scheduling',
    section: null,
    roles: STAFF,
    status: 'ready',
  },
  {
    path: '/admin/content',
    labelKey: 'admin.nav.content',
    section: null,
    roles: STAFF,
    status: 'ready',
  },

  // ── الإدارة ───────────────────────────────────────────────────────────────
  //
  // **Super Admin only, as a SECTION** (R61). Every node here carries
  // `SUPER_ONLY`, and `admin-modules.test.ts` asserts it over the section rather
  // than per module — written as nine independent decisions, the tenth module
  // added here would inherit nothing and the divergence would return silently,
  // which is precisely how `/admin/branches` came to be the odd one out.
  //
  // **Ordered along the dependency chain** (R69), which is the right order for
  // configuration even though it was the wrong one for the operational list:
  // الفئات → المستويات → المواد → مواد المستوى → مقرر الحفظ, then the three
  // standalone configuration nodes and سلة المحذوفات. Reading it top to bottom
  // is reading the curriculum's structure, so a person meets a concept only
  // after the one it hangs off.
  {
    /**
     * R55: الفئات and المواد are two navigation nodes. They were one screen with
     * two tables; the Owner separated the navigation, and the **implementation
     * stays single** — `taxonomy.tsx` takes the entity as a parameter, so the
     * two cannot drift apart the way duplicated CRUD always has here.
     *
     * **Moved to الإدارة by the Owner (2026-08-12), and Super-Admin-only with
     * it** — R61's section rule is structural, so placement decides authority.
     * الإدارة collects **stable configuration**: the three Categories and the
     * Subject list are curriculum *structure*, changed rarely and by one person,
     * not operational data an Admin works with daily.
     *
     * **The READ endpoint stays Admin-accessible**, exactly as R61 decided for
     * `GET /admin/branches`: Levels, scheduling and the roster feed selectors
     * from it, and gating the data rather than the screen would break them.
     */
    path: '/admin/categories',
    labelKey: 'admin.nav.categories',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **R69 — curriculum structure, so it sits with the other configuration.**
     * Its writes have always been Super Admin, and R66 removed the last
     * operational thing it did (creating a Level's first group). It answers
     * *which Levels exist, in which Category* and nothing else now.
     *
     * The READ endpoint stays Admin-accessible: scheduling, the approval
     * queue's placement dialog and the groups screen all feed selectors from
     * it. Gating the DATA rather than the screen would break an Admin's daily
     * work — the rule R61 set for `GET /admin/branches`.
     */
    path: '/admin/levels',
    labelKey: 'admin.nav.levels',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /** With الفئات, and for the same reason — see the note there. */
    path: '/admin/subjects',
    labelKey: 'admin.nav.subjects',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **R69 — a node at last.** The screen existed and worked, but its path
     * carried a Level id, so no menu could reach it: the only ways in were row
     * actions borrowed by `المستويات` and `مجموعات المستويات`, neither of which
     * is about Subjects. The Level is chosen in the page and travels as
     * `?level=`, the pattern §14.1 already uses for `/resources`.
     */
    path: '/admin/level-subjects',
    labelKey: 'admin.nav.levelSubjects',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * M4c — the Quran-side curriculum join (§4.5, §7, BR-11).
     *
     * **Ordered AFTER `مواد المستوى`, by the Document Owner (2026-08-17), and
     * kept there by R105.** It completes the dependency chain: الفئات →
     * المستويات → المواد → **مواد المستوى** (which Subjects a Level teaches) →
     * **مقرر الحفظ** (the Quran syllabus layer on top of them).
     *
     * It carries the same authorization as `مواد المستوى` because it is the same
     * kind of fact: Super Admin writes, Admin reads (R26).
     *
     * **Recorded: `/admin/level-surahs` is not in §14.1.** M4c shipped it with
     * "no SRS change", so the sitemap had no line for it; **R105 adds one**, and
     * the gap is closed rather than carried further.
     */
    path: '/admin/level-surahs',
    labelKey: 'admin.nav.levelSurahs',
    section: 'administration',
    // R61 — every node in this section is Super-Admin-only **by placement**,
    // while its READ endpoint stays Admin-accessible: the rule R69 applied to
    // `المستويات`, because gating the data rather than the screen would break
    // an Admin's daily work.
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * R61 — was `STAFF`, because Revision 26 let an Admin *read* this screen.
     *
     * **The endpoint is unchanged.** `GET /admin/branches` stays Admin-readable,
     * branch-scoped, because `use-scope-options.ts` feeds `/admin/groups`,
     * `/admin/schedules`, `/admin/content` and every scope selector from it —
     * withdrawing it would leave a branch Admin unable to create a group or
     * schedule a class, with empty selectors and no error saying why (R61.2).
     *
     * What changes is who may *manage* branches and rooms, and who sees the
     * node. Writes were already Super Admin only.
     */
    path: '/admin/branches',
    labelKey: 'admin.nav.branches',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **R110 (NEW H) — أنواع الجدولة, the scheduling-type catalogue.**
     *
     * A NEW node rather than a reshuffle: R105 fixed the order of the existing
     * الإدارة entries and OD-01 says not to rearrange them silently, so this is
     * appended after the reference-data nodes and before the platform ones,
     * where a catalogue belongs.
     *
     * **Super Admin only**, which is OD-01's final sub-decision — scheduling
     * types stay undelegated until an Owner decision says otherwise — and which
     * is what keeps R105's الإدارة heading a fact about permission rather than a
     * label. The node's visibility is NOT the control: the service refuses an
     * Admin every write regardless of what the menu shows.
     */
    path: '/admin/scheduling-types',
    labelKey: 'admin.nav.schedulingTypes',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **الفصول الدراسية** (R122) — the semesters an academic year is made of,
     * and the reason an enrolment can say *which* year a beneficiary studied.
     *
     * **In الإدارة and Super Admin only**, because a period is curriculum
     * reference data — the same class as the academic year it belongs to — and
     * R61's section rule makes placement decide authority. Appended after the
     * existing reference-data nodes rather than reshuffled into them, which is
     * what R105 and OD-01 require of a new entry.
     *
     * **The seed creates no periods**, so this screen is not optional
     * furniture: with none open, approval refuses every applicant. A required
     * field with no screen behind it is this project's recurring defect
     * (rule P), and this is where it would have landed next.
     */
    path: '/admin/academic-periods',
    labelKey: 'admin.nav.academicPeriods',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * **شركاء بذور الأمل** (NEW N) — the names §5.1's landing section renders.
     *
     * In الإدارة and **Super Admin only**, which is OD-01's sub-decision: it
     * lists *scheduling types · Partners* as undelegated until a later Owner
     * decision. Like every node in this section, its visibility is not the
     * control — the service refuses an Admin regardless of the menu.
     */
    path: '/admin/partners',
    labelKey: 'admin.nav.partners',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    /**
     * §7/BR-15 (R52) — Super Admin only: the list spans every entity regardless
     * of branch, which no other surface allows.
     *
     * **R105 moves it into الإدارة**, where it always belonged. §14.1 carried
     * two separate `Administration` groups, one holding only this node — a
     * grouping that had stopped describing anything.
     */
    path: '/admin/trash',
    labelKey: 'admin.nav.trash',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    path: '/superadmin/hijri-calendar',
    labelKey: 'admin.nav.hijri',
    section: 'administration',
    roles: SUPER_ONLY,
    status: 'ready',
  },
  {
    path: '/superadmin/settings',
    labelKey: 'admin.nav.settings',
    section: 'administration',
    roles: SUPER_ONLY,
    // Revision 42 — first iteration carries `legal.consent_text_version`,
    // without which no registration can be accepted at all.
    status: 'ready',
  },
];

/** Whether the session holds any of the roles a module requires (TD-2). */
export const canAccess = canAccessModule;

/** The back-office modules a given session may see, in §14.1's order. */
export function visibleModules(roles: readonly string[]): AdminModule[] {
  return visibleIn(ADMIN_MODULES, roles);
}

/**
 * Resolves a pathname to its module.
 *
 * **Longest match wins**, so `/admin/groups` resolves to the groups module
 * rather than to the dashboard at `/admin`. Sub-paths resolve to their parent —
 * `/admin/groups/{id}/roster` is still the groups module — which is what lets a
 * module own its own internal views without registering each one as a
 * navigation node §14.1 does not list.
 */
export function moduleForPath(pathname: string): AdminModule | null {
  return resolveModule(ADMIN_MODULES, pathname);
}

/** Whether a path belongs to the back office at all. */
export function isAdminPath(pathname: string): boolean {
  return moduleForPath(pathname) !== null;
}
