import { api } from '../lib/api.js';

/**
 * «إتمام المستوى» and its certificate (SRS Revision 167 §3).
 *
 * Two facts travel side by side and must never be merged: `requirements` is
 * what BR-11 reads NOW (derived by the server, never stored), and `mark` is
 * what the administration recorded. She may be marked while the first is unmet
 * — the server refuses that until the caller says she has seen what is missing.
 */
export interface LevelCompletionRow {
  level_id: string;
  level_name: string;
  category_name: string;
  requirements: {
    /** `null` — the Level has no «مقرر الحفظ», so BR-11 cannot be asked. */
    complete: boolean | null;
    configured_surahs: number;
    memorised_surahs: number;
    examined_surahs: number;
    exams_required: boolean;
  };
  mark: {
    completed_on: string;
    completed_by_name: string;
    requirements_met: boolean;
    certificate_number: number | null;
    certificate_issued_on: string | null;
  } | null;
}

const base = (studentId: string): string =>
  `/admin/students/${encodeURIComponent(studentId)}/level-completions`;

export async function listLevelCompletions(
  studentId: string,
  token: string | null,
): Promise<LevelCompletionRow[]> {
  return (await api<{ data: LevelCompletionRow[] }>(base(studentId), { token })).data;
}

export async function markLevelCompleted(
  studentId: string,
  levelId: string,
  acknowledgeUnmet: boolean,
  token: string | null,
): Promise<void> {
  await api<void>(`${base(studentId)}/${encodeURIComponent(levelId)}`, {
    method: 'PUT',
    token,
    body: acknowledgeUnmet ? { acknowledge_unmet: true } : {},
  });
}

export async function unmarkLevelCompleted(
  studentId: string,
  levelId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`${base(studentId)}/${encodeURIComponent(levelId)}`, { method: 'DELETE', token });
}

export async function issueLevelCertificate(
  studentId: string,
  levelId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`${base(studentId)}/${encodeURIComponent(levelId)}/certificate`, {
    method: 'PUT',
    token,
  });
}

export async function withdrawLevelCertificate(
  studentId: string,
  levelId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`${base(studentId)}/${encodeURIComponent(levelId)}/certificate`, {
    method: 'DELETE',
    token,
  });
}

/** One confirmed certificate, as the printed page states it. */
export interface LevelCertificate {
  certificate_number: number;
  student_name: string;
  level_name: string;
  category_name: string;
  branch_name: string;
  /** Morocco calendar dates (TD-11). */
  completed_on: string;
  issued_on: string;
}

/** The ACTING student's confirmed certificates (§4.3 — herself, or the child a
 *  parent is acting for). */
export async function listMyCertificates(
  token: string | null,
  activeChildId: string | null,
): Promise<LevelCertificate[]> {
  return (
    await api<{ data: LevelCertificate[] }>('/students/me/certificates', {
      token,
      ...(activeChildId ? { activeChildId } : {}),
    })
  ).data;
}
