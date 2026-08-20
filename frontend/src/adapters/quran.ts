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
  /** **Memorisation only.** مراجعة is counted below, never folded in here — see
   *  `recalculateFor` for why, and for the SRS wording that needs ratifying. */
  coverage_percent: number;
  merged_intervals: AyahInterval[];
  revision_log_count: number;
  last_revised_at: string | null;
}

/** A Level's Quran syllabus with this مستفيدة's coverage of it (§C15/§C17). */
export interface LevelCoverage {
  level_id: string;
  level_name: string;
  category_name: string;
  surahs: SurahCoverage[];
}

export interface QuranProgressRead {
  surahs: SurahCoverage[];
  levels: LevelCoverage[];
  logs: QuranLogRow[];
}

/** A Level the caller may enter progress against, with its configured Surahs. */
export interface QuranScopeLevel {
  level_id: string;
  level_name: string;
  category_name: string;
  surahs: { surah_id: number; name_arabic: string; total_ayahs: number }[];
}

export interface QuranScope {
  students: QuranStudent[];
  levels: QuranScopeLevel[];
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
  /** Every Quran-relevant Level she is enrolled in — **never truncated to the
   *  first** (§C10). One means the form opens it directly; several mean it asks. */
  level_ids: string[];
}

/**
 * **What this caller may enter, and for whom** (R73.1, extended 2026-08-20).
 *
 * The selector's source, so the screen cannot offer somebody — or a Surah — the
 * server would refuse. One request rather than three: the roster, the Levels it
 * reaches and each Level's `LevelSurah` syllabus are one question, and splitting
 * them would let the answers disagree.
 *
 * **Rule O.** A مؤطِّرة is refused by `/admin/levels/{id}/surahs`, so this narrow
 * read is what makes a curriculum-driven Surah list reachable for her without
 * widening anything: it exposes only the Levels her own roster is enrolled in.
 */
export async function fetchQuranScope(token: string | null): Promise<QuranScope> {
  return (await api<{ data: QuranScope }>('/quran-students', { token })).data;
}

/**
 * `GET /students/me/quran` — **the acting student's own progress** (M4b).
 *
 * **No id crosses the wire**, and that is the security property: the server
 * takes the subject from the child context or the JWT, so a parent reads the
 * child they are acting for and a student reads herself. There is nowhere in
 * this request to name somebody else.
 */
/**
 * `GET /students/me/quran` — the **acting** student's coverage.
 *
 * **`activeChildId` is required by the endpoint's contract and was not being
 * sent** (fixed 2026-08-17). The route mounts `childContext`, so §4.3 resolves
 * the subject from the header or the JWT `sub` — and with the header omitted a
 * parent-only account received `400 VALIDATION_FAILED`, while an account holding
 * both roles was shown **its own** progress instead of the child's. The server
 * was right throughout; the client simply never named which child it was acting
 * for. `fetchStudentIdentity` has always passed it, which is why the identity
 * block on the same dashboard worked and this screen did not.
 */
export async function fetchMyCoverage(
  token: string | null,
  activeChildId: string | null,
): Promise<QuranProgressRead> {
  return (
    await api<{ data: QuranProgressRead }>('/students/me/quran', {
      token,
      activeChildId,
    })
  ).data;
}

export async function fetchCoverage(
  studentId: string,
  token: string | null,
): Promise<QuranProgressRead> {
  return (
    await api<{ data: QuranProgressRead }>(`/students/${studentId}/quran`, { token })
  ).data;
}

export async function logProgress(
  input: {
    student_id: string;
    /** §C10 — the curriculum context. The server validates it against her
     *  enrolments and the Level's syllabus; this is not a display hint. */
    level_id: string;
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
