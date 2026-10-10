/**
 * General framing willingness captured during a هيئة التأطير request (R115).
 *
 * `all_branches` is future-inclusive planning data, never an RBAC scope and
 * never an expansion into today's branch catalogue.
 */
export interface FramingPreferenceView {
  mode: 'in_person' | 'online' | 'both';
  all_branches: boolean;
  branches: { id: string; name: string }[];
  /** R215 — when she is available; `null` not stated. Absent on a read that
   *  predates R215's fields (the approvals queue). */
  period?:
    | { kind: 'academic_year'; label: string }
    | { kind: 'academic_period'; label: string; sequence: number; from: string; until: string }
    | { kind: 'date_range'; from: string; until: string }
    | null;
  position?: 'teacher' | 'assistant' | 'both' | null;
  all_levels?: boolean;
  levels?: { id: string; name: string; category_name: string }[];
  /** R215 — available this semester; `null` when no period is stated. */
  available_now?: boolean | null;
}
