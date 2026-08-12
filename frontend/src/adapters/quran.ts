import { api } from '../lib/api.js';

/**
 * Quran memorization tracking (§4.5, BR-13; M4a, SRS Revision 73).
 *
 * **Coverage comes back with every write.** §4.5 requires a مؤطرة correcting a
 * mis-logged range to see the corrected percentage immediately, so the server
 * returns the recalculated figure rather than making the client fetch a value
 * the same request already computed.
 */

export interface AyahInterval {
  start: number;
  end: number;
}

export interface SurahCoverage {
  surah_id: number;
  name_arabic: string;
  total_ayahs: number;
  merged_ayah_count: number;
  coverage_percent: number;
  merged_intervals: AyahInterval[];
}

export interface QuranLogRow {
  id: string;
  surah_id: number;
  start_ayah: number;
  end_ayah: number;
  category: string;
  logged_at: string;
  logged_by_name: string | null;
}

export interface QuranStudent {
  id: string;
  name_arabic: string;
}

/** The مستفيدات this caller may log for — the selector's source (R73.1), so the
 *  screen cannot offer somebody the server would refuse. */
export async function listQuranStudents(token: string | null): Promise<QuranStudent[]> {
  return (await api<{ data: QuranStudent[] }>('/quran-students', { token })).data;
}

/**
 * `GET /students/me/quran` — **the acting student's own progress** (M4b).
 *
 * **No id crosses the wire**, and that is the security property: the server
 * takes the subject from the child context or the JWT, so a parent reads the
 * child they are acting for and a student reads herself. There is nowhere in
 * this request to name somebody else.
 */
export async function fetchMyCoverage(
  token: string | null,
): Promise<{ surahs: SurahCoverage[]; logs: QuranLogRow[] }> {
  return (
    await api<{ data: { surahs: SurahCoverage[]; logs: QuranLogRow[] } }>('/students/me/quran', {
      token,
    })
  ).data;
}

export async function fetchCoverage(
  studentId: string,
  token: string | null,
): Promise<{ surahs: SurahCoverage[]; logs: QuranLogRow[] }> {
  return (
    await api<{ data: { surahs: SurahCoverage[]; logs: QuranLogRow[] } }>(
      `/students/${studentId}/quran`,
      { token },
    )
  ).data;
}

export async function logProgress(
  input: {
    student_id: string;
    surah_id: number;
    start_ayah: number;
    end_ayah: number;
    category: 'new_memorization' | 'revision';
  },
  token: string | null,
): Promise<SurahCoverage> {
  return (await api<{ data: SurahCoverage }>('/quran-logs', { method: 'POST', token, body: input }))
    .data;
}

/** A correction. **No `version`** — TD-15.5 and R73.5: appends interleave freely
 *  and BR-13 recomputes the union, so a lost correction is re-correctable. */
export async function correctLog(
  id: string,
  patch: { start_ayah?: number; end_ayah?: number; category?: 'new_memorization' | 'revision' },
  token: string | null,
): Promise<SurahCoverage> {
  return (
    await api<{ data: SurahCoverage }>(`/quran-logs/${id}`, {
      method: 'PATCH',
      token,
      body: patch,
    })
  ).data;
}

export async function deleteLog(id: string, token: string | null): Promise<SurahCoverage> {
  return (await api<{ data: SurahCoverage }>(`/quran-logs/${id}`, { method: 'DELETE', token })).data;
}
