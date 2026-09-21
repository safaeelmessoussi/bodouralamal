import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listCourseSchedules, updateCourseSchedule } from '../../adapters/course-schedules.js';
import {
  cancelSession,
  listScheduleSessions,
  restoreSession,
  updateSession,
  notifySessionChange,
  type EditScope,
  type ScheduleSession,
} from '../../adapters/sessions.js';
import { listBranches, listRooms } from '../../adapters/branches-admin.js';
import { searchDirectory, type DirectoryEntry } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { SessionMaterialsDialog } from '../../components/content/session-materials-dialog.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  SessionAudienceDialog,
  SessionAudienceFields,
  useSessionAudience,
} from '../../components/scheduling/session-audience-dialog.js';
import {
  SurahsField,
  subjectWorksBySurah,
  surahChoices,
} from '../../components/scheduling/surahs.js';
import {
  AudienceFilters,
  audienceDimensions,
  homeBranchOf,
  namesATeachingPopulation,
  useAudienceFilters,
} from '../../components/scheduling/audience-filters.js';
import {
  DeliverySection,
  deliveryLabel,
  initialMediaMode,
  mediaLabel,
  type DeliveryMode,
  type OnlineMediaMode,
} from '../../components/scheduling/delivery.js';
import { StaffPicker } from '../../components/scheduling/staff-picker.js';
import {
  ManualEditsDialog,
  sessionsEligibleForOverwrite,
} from '../../components/scheduling/manual-edits-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { Dialog } from '../../components/ui/dialog.js';
import { DateField, SelectField, TextArea, TextField } from '../../components/ui/field.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';
import { VisibilityField } from '../../components/scheduling/visibility-field.js';
import { ScopeSelectors } from '../../components/scope/scope-selectors.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';

/**
 * The fields `ScopeDialog` edits, whichever scope carries them onward —
 * `this_session` to `PATCH /sessions/{id}`, the two wider scopes into the
 * schedule's own `title`/`description`/etc. (R138 §4.4). One shape for all
 * three scopes is what makes the field SET identical between them; only the
 * destination differs, in `applyEdit` below.
 */
interface SessionScopeEdit {
  date: string;
  start_time: string;
  end_time: string;
  room_id: string | null;
  delivery_mode: DeliveryMode;
  online_media_mode: OnlineMediaMode | null;
  visibility: string;
  /** R138 — on the same footing as `delivery_mode`/`visibility` above. (No
   *  `title`: it is composed by the server since SRS Revision 166 §3.) */
  description: string | null;
  /**
   * **Owner-reported, 2026-09-17 — this occurrence's own Subject** (§4.4),
   * on exactly the footing `room_id` has: `null` clears an existing
   * override and returns THIS occurrence to the schedule's own Subject.
   * Distinct from `identity.subject_id` below, which replaces the SCHEDULE's
   * own Subject going forward (`this_and_future` only) — this field never
   * touches the schedule.
   */
  subject_id: string | null;
  /**
   * SRS Revision 165 §2/§5 — **the Surahs**, present only when the dialog
   * asked for them (the Subject in play works by Surah and some are on offer).
   * `this_session`: they REPLACE the class's for that date, and `[]` returns
   * the occurrence to the class's own. The wider scopes: the class's (or the
   * successor's) Surahs, replaced whole.
   */
  surah_ids?: number[];
  /**
   * SRS Revision 166 §2 — **`this_session` only, and only what she changed.**
   * The occurrence's own audience (the five lists `PUT /sessions/{id}/audience`
   * takes) and its own staffing, sent in the SAME save as everything above so
   * one «حفظ» is one decision. Absent leaves each exactly as it is — re-sending
   * an inherited audience untouched would turn it into an override nobody made.
   */
  audience?: {
    branch_ids: string[];
    category_ids: string[];
    level_ids: string[];
    administrative_group_ids: string[];
    teaching_group_ids: string[];
  };
  staff?: { user_id: string; position: 'teacher' | 'assistant' }[];
  /**
   * **Owner-reported, 2026-09-15 — a "good, simple" design for editing what
   * §4.4 otherwise freezes**, present only for `this_and_future` (the split
   * REPLACES these too, which is what makes changing them safe): the same
   * fields CREATE takes, resolved server-side exactly the same way. Absent
   * for `this_session`/`all_sessions`, which never touch identity.
   */
  /** SRS Revision 163 §5 — always the five filters; «نمط التدريس» is no longer
   *  asked here either, and `multi_dimension` is how the successor is stored. */
  identity?: {
    subject_id: string;
    branch_id: string;
    academic_year_id: string;
    dimensions: ReturnType<typeof audienceDimensions>;
  };
}

/**
 * `/admin/schedules/{id}/sessions` — the occurrences of one recurring class,
 * and **the screen SRS Revision 50 exists for**.
 *
 * **Every operation that can reach a series asks which occurrences it applies
 * to**, and R50 makes that mandatory rather than courteous: an administrator who
 * moves "the Tuesday class" without being asked cannot know whether they moved
 * one week or a year. The dialog therefore **states what is about to change
 * before it confirms**, and a scope is always chosen explicitly — a default is
 * permitted, a silent choice is not.
 *
 * **The three scopes reach three different places**, which is why this is not
 * one endpoint with a flag:
 *
 * - *This session only* → `PATCH /sessions/{id}`, marking it `overridden`, which
 *   is what protects it from every later schedule rewrite (R43.4, R43.6).
 * - *This and all future* → the schedule is **split**: closed the day before,
 *   with a successor anchored here.
 * - *All sessions* → the schedule itself, sparing overridden occurrences.
 *
 * **`protected_reasons` is rendered, not hidden.** An occurrence somebody
 * overrode, held or attached work to will be spared by the wider scopes, and the
 * dialog says so — otherwise an administrator choosing *all sessions* would
 * reasonably expect it to include everything, and be wrong.
 *
 * **A sub-view of the Schedules module**, reached by drilling in: the path
 * carries an id, so nothing links to it from a menu (§14.1 lists no such node) —
 * the same relationship `/admin/groups/{id}/roster` has to its module.
 */
export function ScheduleSessionsPage({
  scheduleId,
  portal = 'admin',
}: {
  scheduleId: string;
  /**
   * **Which chrome, and which verbs** (R106).
   *
   * The `ContentPage` precedent, applied to occurrences: one capability, two
   * ways in, never two implementations. TD-2 has granted a Teacher
   * *"CRUD Sessions — cancel, reschedule, change room, notes ✔ (only sessions
   * they staff)"* since R43, and `staffsSession` has enforced exactly that just
   * as long — **no screen ever offered it.** Rule P, the tenth instance.
   *
   * The two differ in the verbs offered, and the difference is TD-2's rather
   * than this component's judgement: **per-occurrence staffing (R91 §11) and
   * the R92 audience override are administrative acts** and are not on the
   * teacher's list. Both would fail anyway — the staff picker reads
   * `GET /admin/users`, which answers 403 for her (R93.4) — but they are
   * withheld because TD-2 does not grant them, not because a request would
   * fail. **The server decides either way**; this keeps a control off the
   * screen of somebody it would refuse, which §14.2 asks for and which is never
   * the enforcement.
   */
  portal?: 'admin' | 'teacher';
}): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  const isTeacherPortal = portal === 'teacher';
  /**
   * The portal's own shell — its sidebar, its role gate, its breadcrumb. The
   * two components take the same props, which is what makes one page render in
   * either without a branch anywhere below this line.
   */
  const Layout = isTeacherPortal ? TeacherLayout : AdminLayout;
  /**
   * **Who may attach materials to a class, may record for it** (R75.3): the
   * recorder inherits the session's own link authority and TD-2 gains no row.
   * The server is the authority either way — this only keeps a control off the
   * screen of somebody it would refuse, which §14.2 asks for and which is not
   * the enforcement.
   */
  const canWrite = activeRoles.some(
    (r) => r === 'teacher' || r === 'admin' || r === 'super_admin',
  );

  const [rows, setRows] = useState<ScheduleSession[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [editing, setEditing] = useState<ScheduleSession | null>(null);
  const [cancelling, setCancelling] = useState<ScheduleSession | null>(null);
  /** R91 §11 — the occurrence whose own staffing is being set. */
  const [staffingFor, setStaffingFor] = useState<ScheduleSession | null>(null);
  const [teachers, setTeachers] = useState<DirectoryEntry[]>([]);
  /** R92 — the occurrence whose audience branches are being set. */
  const [audienceFor, setAudienceFor] = useState<ScheduleSession | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  /** The saved change awaiting the tell-or-not decision (R83.3). */
  const [notifying, setNotifying] = useState<{
    id: string;
    change: 'cancelled' | 'rescheduled';
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * **R138 §4.4 — the preserve-vs-overwrite question**, held until answered.
   * Set only when a wider-scope edit would otherwise touch a Session eligible
   * for forced resync (protected for `OVERRIDDEN` alone — never one also
   * `HAS_CONTENT`/`HAS_ATTENDANCE`/`LIFECYCLE`, which no answer here can move).
   */
  const [manualEditsPrompt, setManualEditsPrompt] = useState<{
    session: ScheduleSession;
    scope: EditScope;
    edit: SessionScopeEdit;
    count: number;
  } | null>(null);
  const [materialsFor, setMaterialsFor] = useState<string | null>(null);
  /** The schedule's own scope, so an upload from a session lands where the
   *  class actually is — §4.9 requires Level, Subject, Year and Branch, and a
   *  session carries none of them itself (it references a schedule). */
  const [scope, setScope] = useState<{
    levelId: string;
    subjectId: string;
    academicYearId: string;
    branchId: string | null;
    /** Owner-reported, 2026-09-15 — the schedule's own current group,
     *  `administrative_group` mode only, so `ScopeDialog`'s identity section
     *  can pre-fill the target it edits. */
    targetId: string;
    /** SRS Revision 163 §5 — a filter-built class's own five filters, `null`
     *  for a class created under a single target before that revision. */
    dimensions: {
      branch_ids: string[];
      category_ids: string[];
      level_ids: string[];
      administrative_group_ids: string[];
      teaching_group_ids: string[];
    } | null;
    /** SRS Revision 165 §2 — the class's own Surahs: what an occurrence with
     *  none of its own inherits, and what the editor opens on. */
    surahIds: number[];
  } | null>(null);
  /** R75.6 — the class's own name and note, which a recording is named from.
   *  They belong to the schedule, not to the occurrence. */
  const [klass, setKlass] = useState<{
    title: string;
    description: string | null;
    /** R92 — the audience override is whole-Level only, so the row action is
     *  offered only where the server would accept it (§14.4). */
    teachingMode: string;
  } | null>(null);

  /** R97 — the branch's rooms, so an occurrence moved back to حضوري can name
   *  the one it meets in. Loaded once the schedule's branch is known. */
  const [rooms, setRooms] = useState<{ id: string; name: string; capacity: number | null }[]>([]);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows((await listScheduleSessions(scheduleId, accessToken)).data);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [scheduleId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      // The list endpoint is the only place this screen can learn its schedule's
      // scope: there is no single-schedule read in TD-3.12, and inventing one
      // for four fields would be a new endpoint (§20 rule 16).
      const page = await listCourseSchedules(accessToken);
      const mine = page.data.find((row) => row.id === scheduleId);
      if (mine) {
        setScope({
          /**
           * **`level_id`, never `target_id`** (2026-08-18).
           *
           * This read `target_id`, which is the *Group* for an
           * `administrative_group` class — so every upload and every recording
           * made from a group-taught class's session was declaring a Group id
           * as its `level_id`. §4.9 requires the Level, and the contract now
           * resolves it whatever the mode names.
           */
          levelId: mine.level_id ?? '',
          subjectId: mine.subject_id,
          academicYearId: mine.academic_year_id,
          branchId: mine.branch_id,
          // Unlike the upload/recording use above, the identity SECTION needs
          // the raw target back — an `administrative_group` class's own group.
          targetId: mine.target_id,
          dimensions: mine.dimensions,
          surahIds: mine.surah_ids ?? [],
        });
        setKlass({
          title: mine.title,
          description: mine.description,
          teachingMode: mine.teaching_mode,
        });
      }
    })();
  }, [scheduleId, accessToken]);

  const columns: Column<ScheduleSession>[] = [
    {
      key: 'date',
      header: t('admin.sessions.colDate'),
      cell: (r) => <time dateTime={r.date}>{formatDate(r.date)}</time>,
    },
    {
      key: 'time',
      // Rendered exactly as sent: parsing a wall-clock value would move the
      // class for a reader in another timezone (TD-11).
      header: t('admin.sessions.colTime'),
      cell: (r) => `${r.start_time} – ${r.end_time}`,
    },
    {
      key: 'status',
      header: t('admin.sessions.colStatus'),
      // Announced as a word, never colour alone (§14.4).
      cell: (r) => t(`admin.sessions.status.${r.status}`),
    },
    {
      // **R97 — what this occurrence actually is**, which after an override is
      // not what its schedule says. Rendered through the one shared label
      // (rule C), and the media mode rides in the same cell rather than in a
      // column of its own — it is meaningful for online rows only, so a column
      // would be empty for most of the table.
      key: 'delivery',
      header: t('delivery.label'),
      cell: (r) => {
        const media = mediaLabel(r);
        return media
          ? `${deliveryLabel(r) ?? '—'} · ${media}`
          : (deliveryLabel(r) ?? '—');
      },
    },
    {
      // §8 — where the occurrence actually happens. An online occurrence has no
      // room by construction, so it says so rather than showing an empty cell.
      key: 'venue',
      header: t('admin.schedules.venue'),
      secondary: true,
      cell: (r) => {
        if (r.delivery_mode === 'online') return t('delivery.online');
        if (r.room_id === null) return <span className="muted">—</span>;
        return rooms.find((room) => room.id === r.room_id)?.name ?? <span className="muted">—</span>;
      },
    },
    {
      // §8/R109 — THIS occurrence's own tier, which after an override differs
      // from the schedule's. Showing the schedule's here would hide the override.
      key: 'visibility',
      header: t('admin.calendar.colVisibility'),
      secondary: true,
      cell: (r) =>
        t(`calendar.visibility${r.visibility.charAt(0).toUpperCase()}${r.visibility.slice(1)}`),
    },
    {
      // §8 — who is assigned to this occurrence. Staffing is per-date
      // (R91/R43.4), so this is not the series' answer.
      //
      // Owner-reported, 2026-09-16 — this rendered a bare count under a
      // column literally labeled "المؤطِّرات"; names are what the header
      // promises.
      key: 'staff',
      header: t('admin.schedules.staffCount'),
      secondary: true,
      cell: (r) =>
        r.staff.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          r.staff.map((s) => s.user_name ?? s.user_id).join('، ')
        ),
    },
    {
      key: 'protection',
      header: t('admin.sessions.colProtection'),
      secondary: true,
      // The honest reading of an empty list: a wider scope MAY rewrite this one.
      cell: (r) =>
        r.protected_reasons.length === 0 ? (
          <span className="muted">{t('admin.sessions.notProtected')}</span>
        ) : (
          r.protected_reasons.map((c) => t(`admin.sessions.protection.${c}`)).join('، ')
        ),
    },
  ];

  useEffect(() => {
    // The people who may be named. Asked of the server by role, exactly as
    // إدارة المؤطِّرات does (rule AQ) — never filtered here.
    void searchDirectory(accessToken, { role: 'teacher' })
      .then((p) => setTeachers(p.data))
      .catch(() => setTeachers([]));
    // Every branch, because a combined occurrence may draw from any of them —
    // and the server refuses one that does not exist rather than dropping it.
    void listBranches(accessToken)
      .then((p) => setBranches(p.data.map((b) => ({ id: b.id, name: b.name }))))
      .catch(() => setBranches([]));
  }, [accessToken]);

  useEffect(() => {
    // A room belongs to a branch, so the list follows the schedule's branch —
    // the same rule the scheduling form applies (§4.4). The server refuses a
    // room at another branch regardless (`ROOM_BRANCH_MISMATCH`).
    const branchId = scope?.branchId;
    if (!branchId) return;
    void listRooms(branchId, accessToken)
      .then((p) => setRooms(p.data.map((r) => ({ id: r.id, name: r.name, capacity: null }))))
      .catch(() => setRooms([]));
  }, [scope?.branchId, accessToken]);

  const actions: RowAction<ScheduleSession>[] = [
    { label: t('common.edit'), onSelect: (r) => setEditing(r) },
    {
      // **R91 §11 — a one-off cover.** The schedule answers *who is assigned
      // for this period*; this answers *who took this lesson*, which is a fact
      // about one date and lives on the occurrence (R43.4).
      //
      // **Administrative** — deciding who else answers for a lesson is not
      // among TD-2's four teacher session verbs, and R71.4's reasoning applies
      // unchanged: being answerable for something is not authority to decide
      // who else is.
      label: t('admin.sessions.staffAction'),
      onSelect: (r) => setStaffingFor(r),
      available: () => !isTeacherPortal,
    },
    {
      label: t('session.materialsAction'),
      onSelect: (r) => setMaterialsFor(r.id),
      // Without the schedule's scope an upload has nowhere to land, so the
      // action waits rather than opening a dialog that cannot finish.
      available: () => scope !== null,
    },
    {
      // **R92 — who attends this one, which is not who teaches it.**
      // Owner-reported, 2026-09-17 — generalised to every teaching mode:
      // the override now resolves through `multi_dimension`'s own
      // composition regardless of the schedule's real mode, so every
      // mode's occurrence may gain a Level/Category/Group/Circle addition,
      // not whole-Level classes alone.
      label: t('admin.sessions.audienceAction'),
      onSelect: (r) => setAudienceFor(r),
      // Administrative, like the staffing action beside it: R92's cross-branch
      // audience is the association deciding who a lesson is delivered to.
      available: () => !isTeacherPortal,
    },
    {
      label: t('admin.sessions.cancel'),
      danger: true,
      onSelect: (r) => setCancelling(r),
      available: (r) => r.status === 'scheduled',
    },
    {
      label: t('admin.sessions.restore'),
      onSelect: (r) => void run(() => restoreSession(r.id, r.version, accessToken), 'admin.sessions.restored'),
      // TD-1 allows this only from `cancelled`, and the server additionally
      // refuses it once the date has passed.
      available: (r) => r.status === 'cancelled',
    },
  ];

  /**
   * Runs a mutation and, when it changed something people are waiting on,
   * **asks whether to tell them** (R83.3).
   *
   * The change is already committed when the question is asked — R77.4 and
   * R78.4 wrote the notices inside the changing transaction, which could not
   * express *don't tell anyone*. Declining now creates nothing at all.
   */
  async function run(
    action: () => Promise<unknown>,
    okKey: string,
    announce?: { id: string; change: 'cancelled' | 'rescheduled' },
  ): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setEditing(null);
      setCancelling(null);
      await load();
      setNotice(t(okKey));
      if (announce) setNotifying(announce);
    } catch (error) {
      const reason =
        error instanceof ApiError ? (error.details?.['reason'] as string | undefined) : undefined;
      setNotice(
        t(
          reason === 'SESSION_IN_PAST'
            ? 'admin.sessions.pastRestore'
            : reason === 'ALREADY_HELD'
              ? 'admin.sessions.alreadyHeld'
              : error instanceof ApiError && error.status === 409
                ? 'common.conflict'
                : 'common.saveFailed',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  /** The two wider scopes, once any preserve-vs-overwrite question is answered. */
  async function performWideEdit(
    session: ScheduleSession,
    scope: 'this_and_future' | 'all_sessions',
    edit: SessionScopeEdit,
    overwriteManuallyEdited: boolean,
  ): Promise<void> {
    // Both wider scopes edit the RULE, so they carry only what a rule has —
    // times, never a date. Moving one occurrence to another day is exactly what
    // "this session only" is for.
    //
    // **Delivery IS a rule-level fact** (R97), so it travels with them: taking
    // a class عن بُعد from next week onward is a change to how the class is
    // delivered, and the server resyncs the future un-protected occurrences
    // while leaving the past exactly as it happened.
    // **R109 — the tier IS a rule-level fact**, on the same footing as delivery
    // and for the same reason: hiding a class from next week onward is a change
    // to the class, and the server resyncs the future un-protected occurrences
    // while leaving the past exactly as it happened (R43.4).
    // **R138 — title/description are rule-level facts too**, on the same
    // footing, per the Owner's own worked example (§4.4 item 4).
    const scheduleEdit = {
      start_time: edit.start_time,
      end_time: edit.end_time,
      room_id: edit.room_id,
      delivery_mode: edit.delivery_mode,
      online_media_mode: edit.online_media_mode,
      visibility: edit.visibility,
      description: edit.description,
      // R165 §2 — the class's (or the successor's) Surahs, when the dialog asked.
      ...(edit.surah_ids !== undefined ? { surah_ids: edit.surah_ids } : {}),
      overwrite_manually_edited: overwriteManuallyEdited,
      // **Owner-reported, 2026-09-15 — only `this_and_future` may carry
      // these** (the server refuses them otherwise, §4.4); `edit.identity`
      // itself is only ever set by `ScopeDialog` while that scope is chosen.
      ...(scope === 'this_and_future' && edit.identity
        ? {
            subject_id: edit.identity.subject_id,
            branch_id: edit.identity.branch_id,
            academic_year_id: edit.identity.academic_year_id,
            teaching_mode: 'multi_dimension',
            dimensions: {
              ...(edit.identity.dimensions.branchIds
                ? { branch_ids: edit.identity.dimensions.branchIds }
                : {}),
              ...(edit.identity.dimensions.categoryIds
                ? { category_ids: edit.identity.dimensions.categoryIds }
                : {}),
              ...(edit.identity.dimensions.levelIds
                ? { level_ids: edit.identity.dimensions.levelIds }
                : {}),
              ...(edit.identity.dimensions.administrativeGroupIds
                ? { administrative_group_ids: edit.identity.dimensions.administrativeGroupIds }
                : {}),
              ...(edit.identity.dimensions.teachingGroupIds
                ? { teaching_group_ids: edit.identity.dimensions.teachingGroupIds }
                : {}),
            },
          }
        : {}),
    };
    await run(
      () =>
        updateCourseSchedule(
          scheduleId,
          // The schedule's own version is not on this screen; the server
          // refuses a stale one, and the notice tells the reader to reload.
          0,
          scope === 'this_and_future'
            ? { ...scheduleEdit, scope: 'this_and_future', from_date: session.date }
            : scheduleEdit,
          accessToken,
        ),
      scope === 'this_and_future' ? 'admin.sessions.savedSplit' : 'admin.sessions.savedAll',
    );
  }

  /** The three scopes, each reaching the endpoint that owns it. */
  async function applyEdit(
    session: ScheduleSession,
    scope: EditScope,
    edit: SessionScopeEdit,
  ): Promise<void> {
    if (scope === 'this_session') {
      // **Only THIS scope announces** (R83.3): the two wider ones edit the RULE
      // and re-materialize many occurrences, which is a different kind of news
      // and not one a per-occurrence notice can carry honestly.
      const moved =
        edit.date !== session.date ||
        edit.start_time !== session.start_time ||
        edit.end_time !== session.end_time;
      await run(
        () => updateSession(session.id, session.version, edit, accessToken),
        'admin.sessions.savedOne',
        // Retiming nothing is not news, so the question is only asked when the
        // occurrence actually moved.
        moved ? { id: session.id, change: 'rescheduled' } : undefined,
      );
      return;
    }
    // **R138 §4.4 item 5 — ask first, only when it matters.** The question is
    // withheld unless a Session eligible for forced resync actually sits in
    // this edit's range: asking it every time would train an administrator to
    // click through it without reading, which is the failure §14.4 exists to
    // prevent.
    const affected = sessionsEligibleForOverwrite(
      rows,
      scope === 'this_and_future' ? session.date : undefined,
    );
    if (affected.length === 0) {
      await performWideEdit(session, scope, edit, false);
      return;
    }
    setEditing(null);
    setManualEditsPrompt({ session, scope, edit, count: affected.length });
  }

  return (
    <Layout
      title={t('admin.sessions.title')}
      lede={t('admin.sessions.lede')}
      actions={
        <Button
          variant="secondary"
          onClick={() =>
            (window.location.href = isTeacherPortal ? '/teacher/schedules' : '/admin/schedules')
          }
        >
          {t('admin.sessions.backToSchedules')}
        </Button>
      }
    >
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      <DataTable
        caption={t('admin.sessions.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
      />

      {editing ? (
        <ScopeDialog
          session={editing}
          total={rows.length}
          rooms={rooms}
          busy={busy}
          onCancel={() => setEditing(null)}
          onConfirm={(editScope, edit) => void applyEdit(editing, editScope, edit)}
          /**
           * **Owner-reported, 2026-09-15 — manager-only, same as the split
           * itself** (`assertCanManage` gates `this_and_future`'s identity
           * fields server-side too). `token`/`identity` are both `null` for
           * the teacher portal, and `ScopeDialog` renders no identity section
           * at all when either is.
           */
          token={isTeacherPortal ? null : accessToken}
          identity={isTeacherPortal || !scope || !klass ? null : { ...scope, ...klass }}
          scheduleSubjectId={isTeacherPortal ? null : scope?.subjectId ?? null}
          teachers={teachers}
          branches={branches}
        />
      ) : null}

      {/* R138 §4.4 item 5 — asked only once `applyEdit` has found a Session
          eligible for forced resync inside the edit's range. */}
      {manualEditsPrompt ? (
        <ManualEditsDialog
          count={manualEditsPrompt.count}
          busy={busy}
          onOverwrite={() => {
            const { session, scope, edit } = manualEditsPrompt;
            setManualEditsPrompt(null);
            void performWideEdit(session, scope as 'this_and_future' | 'all_sessions', edit, true);
          }}
          onPreserve={() => {
            const { session, scope, edit } = manualEditsPrompt;
            setManualEditsPrompt(null);
            void performWideEdit(
              session,
              scope as 'this_and_future' | 'all_sessions',
              edit,
              false,
            );
          }}
          onCancel={() => setManualEditsPrompt(null)}
        />
      ) : null}

      {/* **R83.3 — the optional notice, after the change is saved.** The same
          question the activity form asks, through the same shared dialog, so
          «هل أُشعر المعنيين؟» is asked once in the platform's voice. */}
      <ConfirmDialog
        open={notifying !== null}
        title={t('scheduling.notify.title')}
        body={t('scheduling.notify.body')}
        details={<p className="muted">{t('scheduling.notify.audience')}</p>}
        confirmLabel={t('scheduling.notify.send')}
        cancelLabel={t('scheduling.notify.skip')}
        busy={busy}
        onConfirm={() => {
          void (async () => {
            if (!notifying) return;
            setBusy(true);
            try {
              const result = await notifySessionChange(
                notifying.id,
                notifying.change,
                accessToken,
              );
              /**
               * **Zero is an ANSWER, not a quiet success.**
               *
               * «أُرسل الإشعار إلى 0 من المعنيين» reads as *done*, and the case
               * that showed it is ordinary: the only beneficiary enrolled in
               * that Level at that branch was the administrator's own account,
               * and nobody is ever notified of their own act (R78.3). She sent,
               * saw a success message, logged in as herself and found nothing —
               * with the platform never saying that nobody was concerned.
               */
              setNotice(
                result.notified === 0
                  ? t('scheduling.notify.sentNone')
                  : t('scheduling.notify.sent').replace('{n}', String(result.notified)),
              );
              setNotifying(null);
            } catch {
              /**
               * **The change is saved; only the notice failed** — and saying so
               * precisely matters, because a generic failure would read as
               * though the cancellation had not happened.
               *
               * **The dialog stays open** (2026-08-20). It used to close, so
               * «يمكنك المحاولة لاحقاً» named a retry that did not exist: the
               * only way back was to cancel the occurrence again, which is not
               * a thing anybody should do to re-send a notice. Pressing
               * «إرسال الإشعار» again is safe — the `(user, session, type)`
               * unique index makes a repeat the same rows.
               */
              setNotice(t('scheduling.notify.failed'));
            } finally {
              setBusy(false);
            }
          })();
        }}
        onCancel={() => {
          // Nothing is called. Declining is the absence of the request.
          setNotifying(null);
          setNotice(t('scheduling.notify.skipped'));
        }}
      />

      {cancelling ? (
        <CancelDialog
          session={cancelling}
          busy={busy}
          onCancel={() => setCancelling(null)}
          onConfirm={(reason) =>
            void run(
              () => cancelSession(cancelling.id, cancelling.version, reason, accessToken),
              'admin.sessions.cancelled',
              { id: cancelling.id, change: 'cancelled' },
            )
          }
        />
      ) : null}
      {audienceFor ? (
        <SessionAudienceDialog
          key={audienceFor.id}
          sessionId={audienceFor.id}
          version={audienceFor.version}
          date={formatDate(audienceFor.date)}
          branches={branches}
          token={accessToken}
          onClose={() => setAudienceFor(null)}
          onSaved={(message) => {
            setAudienceFor(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}

      {staffingFor ? (
        // **The flat picker is exactly right here** (R91 §11): an occurrence IS
        // a date, so a staffing period on it would be a field with one possible
        // value. The dated editor belongs to the recurring schedule.
        <OccurrenceStaffDialog
          key={staffingFor.id}
          session={staffingFor}
          teachers={teachers}
          onClose={() => setStaffingFor(null)}
          onSave={async (staff) => {
            await run(
              () => updateSession(staffingFor.id, staffingFor.version, { staff }, accessToken),
              'admin.sessions.staffSaved',
            );
            setStaffingFor(null);
          }}
        />
      ) : null}

      {scope ? (
        <SessionMaterialsDialog
          sessionId={materialsFor}
          canRecord={canWrite}
          scope={scope}
          token={accessToken}
          onClose={() => setMaterialsFor(null)}
        />
      ) : null}
    </Layout>
  );
}

/**
 * **The scope question §4.4 (Revision 50) makes mandatory.**
 *
 * It states *which* occurrences each choice touches, with a live count, before
 * anything is confirmed. The counts are the point: "this and all future" reads
 * very differently when it means three occurrences than when it means thirty.
 *
 * **The date is editable only under *this session only***, because the wider
 * scopes edit the recurrence *rule*, and a rule has times but no single date.
 * Moving one class to another day is precisely what the narrow scope is for.
 */
function ScopeDialog({
  session,
  total,
  rooms,
  busy,
  onConfirm,
  onCancel,
  token,
  identity,
  scheduleSubjectId,
  teachers,
  branches,
}: {
  session: ScheduleSession;
  total: number;
  /** SRS Revision 166 §2 — whom «هذه الحصة فقط» may be staffed with, and the
   *  branches its audience may draw from; both already loaded by the page. */
  teachers: DirectoryEntry[];
  branches: { id: string; name: string }[];
  /** R97 — the branch's rooms; empty until the schedule's scope has loaded,
   *  which only affects the in-person branch of the section below. */
  rooms: { id: string; name: string; capacity: number | null }[];
  busy: boolean;
  onConfirm: (scope: EditScope, edit: SessionScopeEdit) => void;
  onCancel: () => void;
  /**
   * **Owner-reported, 2026-09-15 — a "good, simple" design for editing what
   * §4.4 otherwise freezes, `this_and_future`-only.** `null` for the teacher
   * portal (splitting stays manager-only) and while the page's own schedule
   * read has not resolved yet — either way, no identity section renders.
   */
  token: string | null;
  identity: {
    branchId: string | null;
    levelId: string;
    subjectId: string;
    academicYearId: string;
    targetId: string;
    teachingMode: string;
    /** SRS Revision 163 §5 — a filter-built class's own five filters, `null`
     *  for a class created under a single target before that revision. */
    dimensions: {
      branch_ids: string[];
      category_ids: string[];
      level_ids: string[];
      administrative_group_ids: string[];
      teaching_group_ids: string[];
    } | null;
    /** SRS Revision 165 §2 — the class's own Surahs. */
    surahIds: number[];
  } | null;
  /**
   * **Owner-reported, 2026-09-17 — the schedule's own current Subject**, so
   * the this-session-only Subject picker below can seed a real value rather
   * than an empty-looking select when this occurrence carries no override
   * of its own yet. `null` on the identical footing `token` already has
   * (teacher portal, or not yet loaded) — manager-only, same as `identity`.
   */
  scheduleSubjectId: string | null;
}): ReactNode {
  const [scope, setScope] = useState<EditScope>('this_session');
  const [date, setDate] = useState(session.date);
  const [startTime, setStartTime] = useState(session.start_time);
  const [endTime, setEndTime] = useState(session.end_time);
  /**
   * **R97 — opened on what this occurrence IS**, not on the schedule's default.
   * After an override the two differ, and seeding from the schedule would let a
   * reader re-save an unrelated field and silently undo the override.
   */
  const [delivery, setDelivery] = useState<DeliveryMode>(
    session.delivery_mode === 'online' ? 'online' : 'in_person',
  );
  const [mediaMode, setMediaMode] = useState<OnlineMediaMode>(
    initialMediaMode(session.online_media_mode),
  );
  const [roomId, setRoomId] = useState(session.room_id ?? '');
  /**
   * **R109 — opened on what this OCCURRENCE is**, never on the schedule's
   * default, for the reason stated above `delivery`: after an override the two
   * differ, and hydrating from the schedule would let an unrelated edit silently
   * republish an occurrence somebody had deliberately hidden.
   */
  const [visibility, setVisibility] = useState(session.visibility);
  /**
   * **R138 §4.4 item 2 — the same editable class properties as the series
   * form**, opened on THIS occurrence's own name and note for the identical
   * reason `delivery`/`visibility` are above.
   */
  const [description, setDescription] = useState(session.description ?? '');
  /**
   * **Owner-reported, 2026-09-17 — opened on THIS occurrence's effective
   * Subject**: its own override if it has one, else the schedule's current
   * Subject — the identical fallback `audienceForSession` itself uses, so
   * the picker never opens on an empty-looking value for an occurrence that
   * has simply never been retaught.
   */
  const [subjectId, setSubjectId] = useState(session.subject_id ?? scheduleSubjectId ?? '');
  // Unscoped (`mode: 'filter'`), the same reasoning the multi_dimension
  // class picker's own reads already established: this list offers every
  // Subject on the platform rather than one chained to a Level this dialog
  // does not otherwise track, and the server is the real boundary regardless
  // (`assertSubjectTaughtAtLevel`, looped over the schedule's own Level(s)).
  // `fields: []` when `token` is null (teacher portal) — manager-only, same
  // as `identity` below, and the same "no request for a control that will
  // not render" rule that section's own comment states.
  const subjectScope = useScopeOptions({
    token,
    fields: token ? (['subjectId'] as const) : [],
    mode: 'filter',
  });
  /**
   * **SRS Revision 165 §2/§5 — «السور», opened on what THIS occurrence is
   * about**: its own Surahs where it has them, else the class's.
   */
  /**
   * **SRS Revision 166 §2 — everything about ONE occurrence, in this one
   * dialog** (Owner, 2026-09-21: *«like how it's done for an event»*). Its
   * audience — branch, Category, Level, group, circle — used to live behind a
   * separate «الحضور» row action and its staff behind «طاقم التدريس», so
   * «تعديل الحصة» looked as though it could not change them. Both are still
   * there; this dialog now offers the same two editors, through the same
   * shared pieces, and sends whatever changed in its single save.
   * Manager-only, on the footing the Subject below has (`token`).
   */
  const audience = useSessionAudience({
    sessionId: session.id,
    token,
    active: token !== null && scope === 'this_session',
  });
  const initialLead = session.staff.find((x) => x.position === 'teacher')?.user_id ?? '';
  const initialAssistants = session.staff
    .filter((x) => x.position === 'assistant')
    .map((x) => x.user_id);
  const [leadId, setLeadId] = useState(initialLead);
  const [assistantIds, setAssistantIds] = useState<string[]>(initialAssistants);
  const staffDirty =
    leadId !== initialLead ||
    [...assistantIds].sort().join(',') !== [...initialAssistants].sort().join(',');

  const classSurahIds = identity?.surahIds ?? [];
  const [surahIds, setSurahIds] = useState<number[]>(
    (session.surah_ids ?? []).length > 0 ? (session.surah_ids ?? []) : classSurahIds,
  );

  /**
   * **Owner-reported, 2026-09-15 — the successor's identity, edited exactly
   * as CREATE edits it, shown only for `this_and_future`.**
   *
   * `fields: []` when `identity` is `null` (teacher portal, or not yet
   * loaded) — the hook's own rule is "a screen that shows no Branch selector
   * should not make an Admin-only branch request it will never render."
   * `mode` is `administrative_group`-only here: `entire_level` asks nothing
   * further (§4.4c, exactly as `ClassSection` already treats it), and
   * `teaching_group` has no working target picker on the CREATE form either
   * — not a gap this pass introduces or fixes.
   */
  const identityScope = useScopeOptions({
    token,
    // `categoryId` and `levelId` are requested for their OPTION lists (the
    // filters read them); `levelId`'s own value is only the representative
    // Level `useAudienceFilters` keeps, which drives the Subject list.
    fields: identity
      ? (['branchId', 'categoryId', 'levelId', 'subjectId', 'academicYearId'] as const)
      : [],
    initial: identity
      ? {
          branchId: identity.branchId ?? '',
          levelId: identity.levelId,
          subjectId: identity.subjectId,
          academicYearId: identity.academicYearId,
        }
      : {},
    mode: 'form',
  });
  /**
   * **Seeded from the class as it stands, whatever it was stored as** (SRS
   * Revision 163 §5). A filter-built class brings its own five filters; a class
   * created under a single target says the same thing in the new vocabulary —
   * one whole Level at its branch, or one Administrative Group. «نمط التدريس»
   * is asked nowhere any more.
   */
  const seeded = identity?.dimensions ?? null;
  const [branchIds, setBranchIds] = useState<string[]>(
    seeded ? seeded.branch_ids : identity?.branchId ? [identity.branchId] : [],
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(seeded ? seeded.category_ids : []);
  const [levelIds, setLevelIds] = useState<string[]>(
    seeded
      ? seeded.level_ids
      : identity && identity.teachingMode === 'entire_level' && identity.levelId
        ? [identity.levelId]
        : [],
  );
  const [groupIds, setGroupIds] = useState<string[]>(
    seeded
      ? seeded.administrative_group_ids
      : identity && identity.teachingMode === 'administrative_group' && identity.targetId
        ? [identity.targetId]
        : [],
  );
  const [teachingGroupIds, setTeachingGroupIds] = useState<string[]>(
    seeded
      ? seeded.teaching_group_ids
      : identity && identity.teachingMode === 'teaching_group' && identity.targetId
        ? [identity.targetId]
        : [],
  );
  const audienceSelection = { branchIds, categoryIds, levelIds, groupIds, teachingGroupIds };
  const audienceChoices = useAudienceFilters({
    active: identity !== null && scope === 'this_and_future',
    token,
    scope: identityScope,
    selection: audienceSelection,
    setters: { setLevelIds, setGroupIds, setTeachingGroupIds },
  });
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);
  /**
   * Which Subject decides «أي سورة؟», and which Levels its Surahs come from,
   * follow the scope she chose: this occurrence's own Subject; the successor's
   * identity; or the class as it stands. A class whose Levels this dialog
   * cannot read (a filter-built one, outside «from this date onward») is
   * offered every Surah some Level's «مقرر الحفظ» holds — the server holds the
   * choice to the class's real Levels either way (`resolveSurahs`).
   */
  const surahSubjectId =
    scope === 'this_session'
      ? subjectId || (identity?.subjectId ?? '')
      : scope === 'this_and_future'
        ? identityScope.value.subjectId
        : (identity?.subjectId ?? '');
  const asksSurahs = subjectWorksBySurah(subjectScope, surahSubjectId);
  const classLevelIds = [
    ...(identity?.dimensions?.level_ids ?? []),
    ...(identity?.levelId ? [identity.levelId] : []),
  ];
  const knownLevelIds =
    scope === 'this_and_future' ? audienceChoices.levelIdsInPlay : classLevelIds;
  const surahLevelIds =
    knownLevelIds.length > 0 ? knownLevelIds : Object.keys(subjectScope.levelSurahIds);
  const offeredSurahKey = surahChoices(subjectScope, surahLevelIds)
    .map((x) => x.id)
    .join(',');
  const surahsOnOffer = offeredSurahKey !== '';
  // Each scope opens on ITS OWN current answer: this occurrence's Surahs for
  // «this session», the class's for the two scopes that edit the class.
  const ownSurahKey = (session.surah_ids ?? []).join(',');
  const classSurahKey = classSurahIds.join(',');
  useEffect(() => {
    const parse = (key: string): number[] => (key === '' ? [] : key.split(',').map(Number));
    setSurahIds(scope === 'this_session' && ownSurahKey !== '' ? parse(ownSurahKey) : parse(classSurahKey));
  }, [scope, ownSurahKey, classSurahKey]);
  // A Surah the Levels in play no longer hold is dropped, never sent unseen.
  useEffect(() => {
    if (!subjectScope.ready || offeredSurahKey === '') return;
    const offered = new Set(offeredSurahKey.split(',').map(Number));
    if (surahIds.some((id) => !offered.has(id))) setSurahIds(surahIds.filter((id) => offered.has(id)));
  }, [subjectScope.ready, offeredSurahKey, surahIds]);
  /** Derived, never asked (SRS Revision 165 §6) — and it stays the branch the
   *  class already belongs to for as long as the filter still includes it. */
  const identityBranchId = homeBranchOf(audienceSelection, {
    currentBranchId: identity?.branchId ?? null,
    permitted: identityScope.options.branchId.map((o) => o.value),
  });

  return (
    <Dialog open onClose={onCancel} title={t('admin.sessions.editTitle')} wide>
      <div className="form">
        <fieldset>
          <legend>{t('admin.sessions.scopeLegend')}</legend>
          {/* Radios, not a select: three mutually exclusive answers to one
              question, all of which must be visible at once — a collapsed
              control would hide two thirds of a decision §4.4 calls mandatory. */}
          {(['this_session', 'this_and_future', 'all_sessions'] as EditScope[]).map((option) => (
            <label key={option} className="field field--choice">
              <input
                type="radio"
                name="scope"
                value={option}
                checked={scope === option}
                onChange={() => setScope(option)}
              />
              <span>
                <strong>{t(`admin.sessions.scope.${option}`)}</strong>
                <span className="field__hint">
                  {t(`admin.sessions.scopeHint.${option}`)
                    .replace('{date}', session.date)
                    .replace('{total}', String(total))}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* Stated before confirming, which is the clause's actual requirement. */}
        <Feedback>
          {t(`admin.sessions.willChange.${scope}`)
            .replace('{date}', session.date)
            .replace('{total}', String(total))}
        </Feedback>

        {/* **What the occurrence is CALLED is composed by the server** (SRS
            Revision 166 §3) and shown, not asked: it follows the Subject, the
            Surah, the main teacher and the time below the moment they change.
            «الوصف» is where she adds anything in her own words — opened on
            this occurrence's own value, exactly as `delivery`/`visibility` are:
            a wider scope carries it into the rule, the narrow one keeps it as
            this occurrence's own. */}
        <p className="field__hint">
          <strong>{t('scheduling.title')}:</strong> {session.title}
        </p>
        <TextArea
          label={t('scheduling.description')}
          value={description}
          onChange={setDescription}
          rows={3}
        />

        {/* **R109 — the same control the scheduling form uses** (§D). Where the
            change LANDS is the scope's decision, not this field's: one
            occurrence, the successor of a split, or the rule itself. */}
        <VisibilityField value={visibility} onChange={setVisibility} />

        {scope === 'this_session' ? (
          <DateField label={t('admin.sessions.colDate')} value={date} onChange={setDate} />
        ) : (
          // Said rather than silently omitted: a reader who expected to move the
          // date needs to know which choice does that.
          <p className="muted">{t('admin.sessions.dateOnlyThisSession')}</p>
        )}
        <div className="form__row">
          <TextField
            label={t('admin.sessions.startTime')}
            value={startTime}
            onChange={setStartTime}
            hint={t('admin.sessions.timeHint')}
          />
          <TextField
            label={t('admin.sessions.endTime')}
            value={endTime}
            onChange={setEndTime}
          />
        </div>

        {/* **R97 — the SAME section the scheduling form uses** (rule C). One
            occurrence moved عن بُعد and a whole class scheduled عن بُعد must
            offer the same choices under the same words; a dialog-local copy is
            how one of them ends up missing «صوت فقط». */}
        <DeliverySection
          mode={delivery}
          onMode={setDelivery}
          mediaMode={mediaMode}
          onMediaMode={setMediaMode}
          rooms={rooms}
          roomId={roomId}
          onRoom={setRoomId}
        />

        {/* **Owner-reported, 2026-09-17 — this occurrence's own Subject**,
            on the same footing `room_id`/`delivery_mode` have above: THIS
            date only, manager-only (same as `identity` below), and absent
            for the wider scopes — a rule has no single occurrence to
            retach, only `this_and_future`'s own identity replacement
            (below) touches the SCHEDULE's Subject. */}
        {scope === 'this_session' && token ? (
          <SelectField
            label={t('admin.sessions.subjectLabel')}
            value={subjectId}
            onChange={setSubjectId}
            hint={t('admin.sessions.subjectHint')}
            options={[
              { value: '', label: t('admin.sessions.subjectInherit') },
              ...subjectScope.options.subjectId,
            ]}
          />
        ) : null}

        {/* SRS Revision 165 §2/§5 — «السور», on every scope: this occurrence's
            own, the successor's, or the whole class's. Manager-only, on the
            footing the Subject above has (`token`). */}
        {token && asksSurahs ? (
          <SurahsField
            facts={subjectScope}
            levelIds={surahLevelIds}
            selected={surahIds}
            onChange={setSurahIds}
          />
        ) : null}

        {/* SRS Revision 166 §2 — who this ONE occurrence is for, and who takes
            it. The same shared editors the «الحضور» and «طاقم التدريس» row
            actions open; nothing here touches the class. */}
        {scope === 'this_session' && token ? (
          <>
            <fieldset>
              <legend>{t('admin.sessions.audienceLegend')}</legend>
              <p className="field__hint">{t('admin.sessions.audienceHint')}</p>
              <SessionAudienceFields audience={audience} branches={branches} />
            </fieldset>
            <fieldset>
              <legend>{t('admin.sessions.staffLegend')}</legend>
              <p className="field__hint">{t('admin.sessions.staffHint')}</p>
              <StaffPicker
                staff={teachers}
                leadLabel={t('admin.schedules.teacher')}
                leadId={leadId}
                onLead={setLeadId}
                assistantsLabel={t('admin.schedules.assistants')}
                assistantsHint={t('admin.schedules.assistantsHint')}
                assistantIds={assistantIds}
                onAssistants={setAssistantIds}
              />
            </fieldset>
          </>
        ) : null}

        {/* **Owner-reported, 2026-09-15 — the good, simple design for editing
            what §4.4 otherwise freezes.** `this_and_future` splits the
            schedule regardless (R50); this is that split's successor
            choosing a new identity instead of inheriting the old one
            unchanged, through the exact same server-side resolution CREATE
            uses (`resolveTarget`/`assertSubjectTaughtAtLevel`). Absent from
            every other scope, and from the teacher portal entirely, both of
            which the freeze still applies to in full. */}
        {scope === 'this_and_future' && identity ? (
          <fieldset>
            <legend>{t('admin.sessions.identityLegend')}</legend>
            <p className="field__hint">
              {t('admin.sessions.identityHint').replace('{date}', session.date)}
            </p>
            <AudienceFilters
              scope={identityScope}
              selection={audienceSelection}
              setters={{
                setBranchIds,
                setCategoryIds,
                setLevelIds,
                setGroupIds,
                setTeachingGroupIds,
              }}
              choices={audienceChoices}
            />
            <ScopeSelectors
              scope={identityScope}
              fields={['subjectId', 'academicYearId']}
              mode="form"
            />
          </fieldset>
        ) : null}

        {identityNotice ? <Feedback tone="warn">{identityNotice}</Feedback> : null}

        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              // The server's own rules, said before the request rather than
              // after it (`MULTI_DIMENSION_NEEDS_A_LEVEL`; `branch_id` required).
              if (scope === 'this_and_future' && identity) {
                if (!namesATeachingPopulation(audienceSelection)) {
                  setIdentityNotice(t('scheduling.invalid.multiDimensionNeedsLevel'));
                  return;
                }
                if (identityBranchId === '') {
                  setIdentityNotice(t('scheduling.invalid.branch'));
                  return;
                }
                // An unchosen Subject or year used to travel as an empty id and
                // come back as a bare `400` naming no field.
                if (identityScope.value.subjectId === '') {
                  setIdentityNotice(t('scheduling.invalid.subject'));
                  return;
                }
                if (identityScope.value.academicYearId === '') {
                  setIdentityNotice(t('scheduling.invalid.year'));
                  return;
                }
              }
              // R165 §2 — required wherever a Surah CAN be chosen. A class
              // scheduled before the rule, at a Level whose «مقرر الحفظ» is
              // still empty, stays editable: nothing is asked and nothing sent.
              const sendsSurahs = token !== null && asksSurahs && surahsOnOffer;
              if (sendsSurahs && surahIds.length === 0) {
                setIdentityNotice(t('scheduling.invalid.surahs'));
                return;
              }
              const sameAsClass =
                surahIds.length === classSurahIds.length &&
                surahIds.every((id) => classSurahIds.includes(id));
              setIdentityNotice(null);
              onConfirm(scope, {
                date: scope === 'this_session' ? date : session.date,
                start_time: startTime,
                end_time: endTime,
                // Hidden means CLEARED (§13): an online occurrence submits no
                // room whatever was selected before the switch, and an
                // in-person one submits no media mode.
                room_id: delivery === 'online' ? null : roomId || null,
                delivery_mode: delivery,
                online_media_mode: delivery === 'online' ? mediaMode : null,
                visibility,
                description: description.trim() === '' ? null : description,
                // Owner-reported, 2026-09-17 — only `this_session` carries a
                // Subject override; the wider scopes touch the schedule's
                // Subject through `identity.subject_id` alone, and
                // `performWideEdit` never reads this key.
                subject_id: subjectId || null,
                // One occurrence that names the class's own Surahs is not an
                // override: `[]` keeps it following the class when that changes.
                ...(sendsSurahs
                  ? { surah_ids: scope === 'this_session' && sameAsClass ? [] : surahIds }
                  : {}),
                // R166 §2 — only what she changed, and only for this occurrence.
                ...(scope === 'this_session' && token !== null && audience.dirty
                  ? {
                      audience: {
                        branch_ids: audience.chosen.branchIds,
                        category_ids: audience.chosen.categoryIds,
                        level_ids: audience.chosen.levelIds,
                        administrative_group_ids: audience.chosen.administrativeGroupIds,
                        teaching_group_ids: audience.chosen.teachingGroupIds,
                      },
                    }
                  : {}),
                ...(scope === 'this_session' && token !== null && staffDirty
                  ? {
                      staff: [
                        ...(leadId ? [{ user_id: leadId, position: 'teacher' as const }] : []),
                        ...assistantIds.map((id) => ({
                          user_id: id,
                          position: 'assistant' as const,
                        })),
                      ],
                    }
                  : {}),
                ...(scope === 'this_and_future' && identity
                  ? {
                      identity: {
                        subject_id: identityScope.value.subjectId,
                        branch_id: identityBranchId,
                        academic_year_id: identityScope.value.academicYearId,
                        dimensions: audienceDimensions(audienceSelection),
                      },
                    }
                  : {}),
              });
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Cancelling one occurrence.
 *
 * **The reason is mandatory** and the dialog says why: it is the only record of
 * why a class did not happen, and the audience size is written to the audit row
 * at this moment — while it is still answerable.
 *
 * **Scoped to this occurrence alone**, deliberately. Cancelling a whole series
 * is deleting the schedule, which is a different act on a different screen with
 * its own confirmation; offering it here would let one click end a term.
 */
function CancelDialog({
  session,
  busy,
  onConfirm,
  onCancel,
}: {
  session: ScheduleSession;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('admin.sessions.cancelTitle').replace('{date}', session.date)}
    >
      <div className="form">
        <p>{t('admin.sessions.cancelBody')}</p>
        {/* **R83.2 — optional.** R77 required it, on the reasoning that a
            cancellation without a reason is indistinguishable from an accident.
            The Owner has decided otherwise: a class is sometimes simply not
            held, and demanding a sentence first is a gate with no purpose. */}
        <TextField
          label={t('admin.sessions.cancelReason')}
          value={reason}
          onChange={setReason}
          hint={t('admin.sessions.cancelReasonHint')}
        />
        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => onConfirm(reason.trim())}
          >
            {t('admin.sessions.cancel')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * **Who takes THIS lesson** (R43.4, surfaced by R91 §11).
 *
 * A cover for one occurrence: the schedule's own assignments are untouched, the
 * next occurrence resolves to the normal مؤطِّرة, and a past occurrence keeps
 * whoever actually took it whatever the schedule later says.
 *
 * The sentence on the dialog says so, because *this occurrence only* is exactly
 * the thing an administrator would otherwise have to infer from what did not
 * change.
 */
function OccurrenceStaffDialog({
  session,
  teachers,
  onClose,
  onSave,
}: {
  session: ScheduleSession;
  teachers: DirectoryEntry[];
  onClose: () => void;
  onSave: (staff: { user_id: string; position: 'teacher' | 'assistant' }[]) => Promise<void>;
}): ReactNode {
  const initialLead = session.staff.find((x) => x.position === 'teacher')?.user_id ?? '';
  const initialAssistants = session.staff
    .filter((x) => x.position === 'assistant')
    .map((x) => x.user_id);
  const [leadId, setLeadId] = useState(initialLead);
  const [assistantIds, setAssistantIds] = useState<string[]>(initialAssistants);
  const [busy, setBusy] = useState(false);

  const dirty =
    leadId !== initialLead ||
    [...assistantIds].sort().join(',') !== [...initialAssistants].sort().join(',');

  return (
    <FormDialog
      open
      title={t('admin.sessions.staffTitle').replace('{date}', formatDate(session.date))}
      onCancel={onClose}
      dirty={dirty}
      busy={busy}
      onSubmit={async () => {
        setBusy(true);
        try {
          await onSave([
            ...(leadId ? [{ user_id: leadId, position: 'teacher' as const }] : []),
            ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
          ]);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="field__hint">{t('admin.sessions.staffHint')}</p>
      <StaffPicker
        staff={teachers}
        leadLabel={t('admin.schedules.teacher')}
        leadId={leadId}
        onLead={setLeadId}
        assistantsLabel={t('admin.schedules.assistants')}
        assistantsHint={t('admin.schedules.assistantsHint')}
        assistantIds={assistantIds}
        onAssistants={setAssistantIds}
      />
    </FormDialog>
  );
}
