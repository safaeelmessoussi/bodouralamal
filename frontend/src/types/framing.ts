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
}
