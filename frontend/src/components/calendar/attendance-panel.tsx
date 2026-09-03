import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import {
  attendanceCandidates,
  checkInSelf,
  markPresent,
  readAttendance,
  removeAttendance,
  type AttendanceSheet,
  type OccurrenceKind,
} from '../../adapters/attendance.js';
import type { Occurrence } from '../../adapters/calendar.js';
import { SessionContext } from '../../contexts/session.js';
import { useActiveRoleOrNull } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { SearchInput } from '../ui/field.js';
import { Feedback } from '../ui/feedback.js';

/**
 * **الحضور — the register, where the occurrence already is** (SRS §4.7, R123).
 *
 * ## Why it lives in the shared occurrence dialog
 *
 * All four calendars — public, back office, مؤطِّرة, beneficiary — open the same
 * details dialog, and that dialog is the one place every kind of occurrence is
 * already addressed by both staff and beneficiaries. A separate
 * `/admin/attendance?id=` page would need a menu node that shows nothing until a
 * deep link fills it, which is exactly the data-first rule A forbids; and it
 * would have to be reached from this dialog anyway.
 *
 * ## Two audiences, two controls, and never both
 *
 * * **Staff** open the sheet inline. Whether this particular reader may is the
 *   **server's** answer: the read is attempted and a refusal simply renders no
 *   panel, so nothing here decides a permission (rule O).
 * * **A beneficiary** is offered «تسجيل حضوري» and **never the roster**. Who
 *   else is in her class is not a question she may ask, and the sheet endpoint
 *   refuses her — this component does not merely decline to render it.
 *
 * ## Why the self control can be hidden rather than discovered
 *
 * `me.self_attendance_allowed` is derived server-side (§4.7): every Category she
 * is enrolled in must permit it. The Owner's rule is that اليافعات and الطفل see
 * **no** self check-in control at all, which is only possible if the server says
 * so before the control renders. The POST refuses regardless — this is what
 * stops a child being offered a button that can only fail.
 */
const STAFF_ROLES = ['admin', 'super_admin', 'teacher'];

export function AttendancePanel({ occurrence }: { occurrence: Occurrence }): ReactNode {
  const session = useContext(SessionContext);
  /**
   * **Optional, like `SessionContext` beside it.** This dialog is the one the
   * PUBLIC calendar opens and is rendered standalone in tests, so a component
   * inside it may not require the authenticated container — `useActiveRole`
   * throws without a provider, and using it here crashed every public
   * occurrence dialog until the calendar's own tests caught it.
   */
  const activeRoles = useActiveRoleOrNull()?.activeRoles ?? [];
  const accessToken = session?.accessToken ?? null;

  // A عطلة and a حفل have no sheet at all, and the server refuses every route.
  // Rendering nothing is the honest client half of that (R123).
  if (occurrence.attendance_mode === 'disabled') return null;
  if (accessToken === null) return null;

  const isStaff = activeRoles.some((role) => STAFF_ROLES.includes(role));
  if (isStaff) return <StaffSheet occurrence={occurrence} token={accessToken} />;

  const mayCheckIn =
    occurrence.attendance_marking === 'self_or_staff' &&
    session?.me?.self_attendance_allowed === true;
  if (!mayCheckIn) return null;
  return <SelfCheckIn occurrence={occurrence} token={accessToken} />;
}

/** The one action a beneficiary has, and the one sentence that answers it. */
function SelfCheckIn({
  occurrence,
  token,
}: {
  occurrence: Occurrence;
  token: string;
}): ReactNode {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

  if (occurrence.kind === 'exam') return null;

  async function submit(): Promise<void> {
    setState('busy');
    try {
      await checkInSelf(
        occurrence.kind as 'session' | 'event',
        occurrence.id,
        occurrence.kind === 'event' ? occurrence.date : null,
        token,
      );
      setState('done');
    } catch {
      setState('failed');
    }
  }

  if (state === 'done') {
    return (
      <p className="details__action">
        <Feedback>{t('attendance.selfDone')}</Feedback>
      </p>
    );
  }

  return (
    <p className="details__action">
      <Button variant="primary" disabled={state === 'busy'} onClick={() => void submit()}>
        {t('attendance.selfCheckIn')}
      </Button>
      {state === 'failed' ? <Feedback tone="warn">{t('attendance.selfFailed')}</Feedback> : null}
    </p>
  );
}

/**
 * The paper sheet, in the two shapes the association keeps it.
 *
 * `required` opens on the expected roster; `optional` opens empty and names are
 * added as people arrive. **Nobody is written as absent**: an expected person
 * with no mark simply has none, and that is the model rather than a rendering
 * choice.
 */
function StaffSheet({ occurrence, token }: { occurrence: Occurrence; token: string }): ReactNode {
  const kind = occurrence.kind as OccurrenceKind;
  const date = occurrence.kind === 'event' ? occurrence.date : null;

  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ id: string; name: string | null }[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setSheet(await readAttendance(kind, occurrence.id, date, token));
      setState('ready');
    } catch {
      // A refusal is not an error the reader can act on — she is simply not the
      // person who marks this occurrence. The panel closes rather than
      // explaining a permission she was never offered.
      setState('error');
    }
  }, [kind, occurrence.id, date, token]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || query.trim() === '') {
      setFound([]);
      return;
    }
    let live = true;
    void attendanceCandidates(kind, occurrence.id, date, query, token)
      .then((rows) => {
        if (live) setFound(rows);
      })
      .catch(() => {
        if (live) setFound([]);
      });
    return () => {
      live = false;
    };
  }, [open, query, kind, occurrence.id, date, token]);

  async function mark(studentId: string): Promise<void> {
    setBusyId(studentId);
    setNotice(null);
    try {
      await markPresent(kind, occurrence.id, date, studentId, token);
      setQuery('');
      await load();
    } catch {
      setNotice(t('attendance.markFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function unmark(studentId: string): Promise<void> {
    setBusyId(studentId);
    setNotice(null);
    try {
      await removeAttendance(kind, occurrence.id, date, studentId, token);
      await load();
    } catch {
      setNotice(t('attendance.removeFailed'));
    } finally {
      setBusyId(null);
    }
  }

  if (!open) {
    return (
      <p className="details__action">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('attendance.open')}
        </Button>
      </p>
    );
  }

  if (state === 'error') return null;

  const presentBy = new Map((sheet?.present ?? []).map((p) => [p.student_id, p]));
  const matches = (name: string | null): boolean =>
    filter.trim() === '' || (name ?? '').includes(filter.trim());

  /**
   * **The roster and the marks are one list, not two.** A reader looking at a
   * register sees every expected name with a mark beside some of them; two
   * separate lists would make her cross-reference to answer *who is missing*.
   * People marked beyond the roster are appended, flagged, because they are the
   * margin note the paper sheet takes.
   */
  const beyond = (sheet?.present ?? []).filter(
    (p) => !(sheet?.expected ?? []).some((e) => e.id === p.student_id),
  );

  return (
    <section className="details__attendance">
      <h3>{t('attendance.title')}</h3>
      <p className="hint">
        {t(sheet?.mode === 'required' ? 'attendance.ledeRequired' : 'attendance.ledeOptional')}
      </p>
      {notice ? <Feedback tone="warn">{notice}</Feedback> : null}

      {state === 'loading' ? <p className="hint">{t('common.loading')}</p> : null}

      {sheet ? (
        <>
          {sheet.expected.length > 0 ? (
            <SearchInput
              label={t('attendance.search')}
              value={filter}
              onChange={setFilter}
            />
          ) : null}

          <ul className="attendance-list">
            {sheet.expected.filter((e) => matches(e.name)).map((e) => {
              const record = presentBy.get(e.id);
              return (
                <li key={e.id}>
                  <span>{e.name}</span>
                  {record ? (
                    <>
                      <Badge tone="ok">{t('attendance.presentBadge')}</Badge>
                      {record.self ? (
                        <span className="hint">{t('attendance.selfMarked')}</span>
                      ) : null}
                      <Button
                        variant="ghost"
                        disabled={busyId === e.id}
                        onClick={() => void unmark(e.id)}
                      >
                        {t('attendance.unmark')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="muted">{t('attendance.notMarked')}</span>
                      <Button
                        variant="secondary"
                        disabled={busyId === e.id}
                        onClick={() => void mark(e.id)}
                      >
                        {t('attendance.markPresent')}
                      </Button>
                    </>
                  )}
                </li>
              );
            })}

            {beyond.filter((p) => matches(p.name)).map((p) => (
              <li key={p.student_id}>
                <span>{p.name}</span>
                {/* The margin note: she came without being expected, which is
                    ordinary and is recorded as such rather than as a problem. */}
                <Badge tone="warn">{t('attendance.beyondRoster')}</Badge>
                {p.self ? <span className="hint">{t('attendance.selfMarked')}</span> : null}
                <Button
                  variant="ghost"
                  disabled={busyId === p.student_id}
                  onClick={() => void unmark(p.student_id)}
                >
                  {t('attendance.unmark')}
                </Button>
              </li>
            ))}
          </ul>

          {sheet.expected.length === 0 && sheet.present.length === 0 ? (
            <p className="hint">
              {t(
                sheet.mode === 'required' ? 'attendance.noneExpected' : 'attendance.nonePresent',
              )}
            </p>
          ) : null}

          <SearchInput
            label={t('attendance.addAttendee')}
            value={query}
            onChange={setQuery}
            hint={t('attendance.addAttendeeHint')}
          />
          {found.length > 0 ? (
            <ul className="attendance-list">
              {found.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <Button
                    variant="secondary"
                    disabled={busyId === c.id}
                    onClick={() => void mark(c.id)}
                  >
                    {t('attendance.markPresent')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
