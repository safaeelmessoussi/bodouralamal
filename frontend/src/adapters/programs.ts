import { api } from '../lib/api.js';

/**
 * The public programme overview (`GET /programs`, TD-3.16 / Revision 144).
 *
 * A thin typed read of the endpoint, on the same footing `fetchBranches`
 * already has: the shape below is exactly the contract's projection, so a
 * field the API stops sending becomes a type error here rather than an
 * empty line on the page.
 */
export interface PublicSubject {
  id: string;
  name: string;
}

export interface PublicSurah {
  id: number;
  name: string;
}

export interface PublicProgramLevel {
  id: string;
  name: string;
  description: string | null;
  /** R180 §4 — the Level's age range, informational; `null` is «not stated». */
  min_age: number | null;
  max_age: number | null;
  /** R180 §6 — `step` (the next rung) or `preparatory` (leads into the
   *  Category's first step; not required of those who enter there). */
  journey_role: 'step' | 'preparatory';
  subjects: PublicSubject[];
  surahs: PublicSurah[];
}

export interface PublicProgramCategory {
  id: string;
  name: string;
  description: string | null;
  /** R180 §4 — derived by the server from the first and last Level; a last
   *  Level with no end leaves the Category open-ended (`max_age: null`). */
  min_age: number | null;
  max_age: number | null;
  levels: PublicProgramLevel[];
}

/** Not paginated (TD-10 does not apply) — bounded by the domain, same
 *  reasoning `fetchBranches` states for its own page-size ceiling. */
export async function fetchPrograms(): Promise<PublicProgramCategory[]> {
  const body = await api<{ data: PublicProgramCategory[] }>('/programs');
  return body.data;
}
