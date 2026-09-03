import { api } from '../lib/api.js';

/**
 * **Attendance — the register the association keeps on paper** (SRS §4.7, R123).
 *
 * One adapter for the three dated occurrence carriers: a class occurrence
 * (`session`), an activity occurrence (`event`, which also needs its date,
 * because a recurring نشاط is one row expanded over many days) and an exam
 * sitting (`exam`). The paths are entity-rooted, exactly as
 * `/sessions/{id}/roster` is.
 */
export type OccurrenceKind = 'session' | 'event' | 'exam';

/** R123 — who may record presence at an occurrence. */
export type AttendanceMarking = 'staff_only' | 'self_or_staff';

export interface AttendanceMark {
  id: string;
  student_id: string;
  name: string | null;
  recorded_at: string;
  /** The beneficiary recorded it herself. */
  self: boolean;
  /** She attended without being on the expected roster — the note the paper
   *  sheet takes in the margin, not a problem. */
  beyond_roster: boolean;
}

export interface AttendanceSheet {
  occurrence_kind: OccurrenceKind;
  occurrence_id: string;
  occurrence_date: string;
  /** `disabled` never reaches here: the server refuses the read outright, so a
   *  sheet that loaded is one that may exist. */
  mode: 'optional' | 'required';
  marking: AttendanceMarking;
  self_check_in_available: boolean;
  /**
   * The register. **Empty for an `optional` occurrence by design** — that sheet
   * starts blank and is filled as people arrive — so empty here never means
   * *nobody is enrolled*.
   */
  expected: { id: string; name: string | null }[];
  present: AttendanceMark[];
}

const base = (kind: OccurrenceKind, id: string): string =>
  `/${kind === 'session' ? 'sessions' : kind === 'event' ? 'events' : 'exams'}/${id}/attendance`;

const dated = (path: string, date: string | null): string =>
  date === null ? path : `${path}?date=${date}`;

export async function readAttendance(
  kind: OccurrenceKind,
  id: string,
  date: string | null,
  token: string | null,
): Promise<AttendanceSheet> {
  return api<AttendanceSheet>(dated(base(kind, id), date), { token });
}

export async function markPresent(
  kind: OccurrenceKind,
  id: string,
  date: string | null,
  studentId: string,
  token: string | null,
): Promise<{ id: string }> {
  return api<{ id: string }>(dated(base(kind, id), date), {
    method: 'POST',
    body: { student_id: studentId },
    token,
  });
}

/**
 * **«تسجيل حضوري» — and the body is empty.**
 *
 * *A woman may mark ONLY herself* is expressed by there being nowhere to name
 * anybody else. Idempotent: pressing it twice leaves one row and answers the
 * same id.
 */
export async function checkInSelf(
  kind: 'session' | 'event',
  id: string,
  date: string | null,
  token: string | null,
): Promise<{ id: string }> {
  return api<{ id: string }>(dated(`${base(kind, id)}/self`, date), {
    method: 'POST',
    body: {},
    token,
  });
}

export async function removeAttendance(
  kind: OccurrenceKind,
  id: string,
  date: string | null,
  studentId: string,
  token: string | null,
): Promise<void> {
  await api<void>(dated(`${base(kind, id)}/${studentId}`, date), {
    method: 'DELETE',
    token,
  });
}

/**
 * **Who may be added to this sheet.**
 *
 * A picker for one occurrence, not a directory: `/admin/directory` is Admin and
 * Super Admin only, so a مؤطِّرة marking her own class could not reach it. The
 * server answers beneficiaries at the occurrence's own branch, excluding those
 * already on the sheet.
 */
export async function attendanceCandidates(
  kind: OccurrenceKind,
  id: string,
  date: string | null,
  query: string,
  token: string | null,
): Promise<{ id: string; name: string | null }[]> {
  const params = new URLSearchParams();
  if (date !== null) params.set('date', date);
  if (query.trim() !== '') params.set('q', query.trim());
  const suffix = params.toString();
  const path = `${base(kind, id)}/candidates${suffix ? `?${suffix}` : ''}`;
  return (await api<{ data: { id: string; name: string | null }[] }>(path, { token })).data;
}
