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
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { SessionMaterialsDialog } from '../../components/content/session-materials-dialog.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { SessionAudienceDialog } from '../../components/scheduling/session-audience-dialog.js';
import {
  DeliverySection,
  deliveryLabel,
  mediaLabel,
  type DeliveryMode,
  type OnlineMediaMode,
} from '../../components/scheduling/delivery.js';
import { StaffPicker } from '../../components/scheduling/staff-picker.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { Dialog } from '../../components/ui/dialog.js';
import { DateField, TextField } from '../../components/ui/field.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

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
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
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
  const [materialsFor, setMaterialsFor] = useState<string | null>(null);
  /** The schedule's own scope, so an upload from a session lands where the
   *  class actually is — §4.9 requires Level, Subject, Year and Branch, and a
   *  session carries none of them itself (it references a schedule). */
  const [scope, setScope] = useState<{
    levelId: string;
    subjectId: string;
    academicYearId: string;
    branchId: string | null;
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
    void searchUsers(accessToken, { role: 'teacher' })
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
      // **R92 — who attends this one, which is not who teaches it.** Only for a
      // whole-Level class: in the other modes the branch is carried by the
      // target itself, so a branch list has no meaning and the server refuses
      // it. An action that can only be refused is not offered (§14.4).
      label: t('admin.sessions.audienceAction'),
      onSelect: (r) => setAudienceFor(r),
      // Administrative, like the staffing action beside it: R92's cross-branch
      // audience is the association deciding who a lesson is delivered to.
      available: () => !isTeacherPortal && klass?.teachingMode === 'entire_level',
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

  /** The three scopes, each reaching the endpoint that owns it. */
  async function applyEdit(
    session: ScheduleSession,
    scope: EditScope,
    edit: {
      date: string;
      start_time: string;
      end_time: string;
      room_id: string | null;
      delivery_mode: DeliveryMode;
      online_media_mode: OnlineMediaMode | null;
    },
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
    // Both wider scopes edit the RULE, so they carry only what a rule has —
    // times, never a date. Moving one occurrence to another day is exactly what
    // "this session only" is for.
    //
    // **Delivery IS a rule-level fact** (R97), so it travels with them: taking
    // a class عن بُعد from next week onward is a change to how the class is
    // delivered, and the server resyncs the future un-protected occurrences
    // while leaving the past exactly as it happened.
    const scheduleEdit = {
      start_time: edit.start_time,
      end_time: edit.end_time,
      room_id: edit.room_id,
      delivery_mode: edit.delivery_mode,
      online_media_mode: edit.online_media_mode,
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
          onConfirm={(scope, edit) => void applyEdit(editing, scope, edit)}
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
}: {
  session: ScheduleSession;
  total: number;
  /** R97 — the branch's rooms; empty until the schedule's scope has loaded,
   *  which only affects the in-person branch of the section below. */
  rooms: { id: string; name: string; capacity: number | null }[];
  busy: boolean;
  onConfirm: (
    scope: EditScope,
    edit: {
      date: string;
      start_time: string;
      end_time: string;
      room_id: string | null;
      delivery_mode: DeliveryMode;
      online_media_mode: OnlineMediaMode | null;
    },
  ) => void;
  onCancel: () => void;
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
    session.online_media_mode === 'audio_only' ? 'audio_only' : 'audio_video',
  );
  const [roomId, setRoomId] = useState(session.room_id ?? '');

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

        <div className="form__actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
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
              })
            }
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
  teachers: UserSummary[];
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
