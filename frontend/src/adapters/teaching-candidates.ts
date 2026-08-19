import { api } from '../lib/api.js';

/**
 * **The staff picker's planning appraisal** (R90).
 *
 * One request for the whole picker, not one per name: the appraisal answers
 * *who would suit this class* for every candidate at once, and three of its four
 * questions are about a profile while the fourth — the scheduling conflict — is
 * a fact about every other schedule she staffs, which only the server can see.
 *
 * **It returns everybody.** A shortened list would be the one refusal an
 * administrator could not override, and R88.4 is explicit that a mismatch warns
 * and never blocks.
 */
export type CandidateWarning =
  | 'subject_not_declared'
  | 'category_not_declared'
  | 'availability_not_declared'
  | 'unavailable'
  | 'conflict'
  | 'availability_indeterminate';

export interface CandidateConflict {
  schedule_id: string;
  title: string;
  weekday: string;
  start_time: string;
  end_time: string;
}

export interface TeachingCandidate {
  id: string;
  name_arabic: string;
  /** She has declared nothing at all — said once, quietly, rather than as three
   *  separate accusations. */
  no_profile: boolean;
  warnings: CandidateWarning[];
  conflicts: CandidateConflict[];
}

export interface ProposedClassQuery {
  recurrence: string;
  weekdays: string[];
  startTime: string;
  endTime: string;
  subjectId?: string | undefined;
  levelId?: string | undefined;
  excludeScheduleId?: string | undefined;
}

export async function appraiseCandidates(
  proposed: ProposedClassQuery,
  token: string | null,
): Promise<TeachingCandidate[]> {
  const params = new URLSearchParams({
    recurrence: proposed.recurrence,
    start_time: proposed.startTime,
    end_time: proposed.endTime,
  });
  if (proposed.weekdays.length > 0) params.set('weekdays', proposed.weekdays.join(','));
  if (proposed.subjectId) params.set('subject_id', proposed.subjectId);
  if (proposed.levelId) params.set('level_id', proposed.levelId);
  if (proposed.excludeScheduleId) params.set('exclude_schedule_id', proposed.excludeScheduleId);

  const res = await api<{ data: TeachingCandidate[] }>(
    `/admin/teaching-candidates?${params.toString()}`,
    { token },
  );
  return res.data;
}
