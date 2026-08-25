import { api } from '../lib/api.js';
import { reorderResource, sortQuery } from './reorder.js';
import type { SortState } from '../components/ui/data-table.js';
import type { SubjectRef } from './reference-data.js';

/**
 * Curriculum taxonomy — Categories, Subjects and Levels (§5.6, §14.1).
 *
 * **Subjects are read through `reference-data.ts`, not here.** That adapter owns
 * `GET /admin/subjects`, which is both the selector every form uses and the list
 * the الفئات والمواد screen edits. Adding a second read here would give one
 * concept two client-side sources, which is the same defect on the client that
 * two endpoints would be on the server — so this module carries only the writes.
 *
 * Reading is Admin and above; writing is Super Admin (TD-2 R26). The screens
 * hide the write controls accordingly, and the **server enforces it regardless**
 * — that gating is UX, never the boundary.
 */

/* ── Categories ───────────────────────────────────────────────────────────── */

export interface Category {
  id: string;
  name: string;
  display_order: number | null;
  /** Live Levels in this Category — what says whether deleting it is possible. */
  level_count: number;
  /**
   * §4.9's default content visibility for this Category (§15.1).
   *
   * The upload screen preselects it, which is what §14.1's *"visibility
   * selection honoring Category defaults"* means in practice. Optional on the
   * type because create/update responses do not read the settings table.
   */
  default_visibility?: 'public' | 'private' | 'hidden';
  /** TD-15: loaded by the edit form and sent back; a stale one is a `409`. */
  version: number;
}

export interface TaxonomyInput {
  name: string;
  display_order?: number | null;
}

export async function listCategories(
  token: string | null,
  sort: SortState | null = null,
): Promise<Category[]> {
  const body = await api<{ data: Category[] }>(`/admin/categories${sortQuery(sort)}`, { token });
  return body.data;
}

/** R76.4 — the categories, in the order given. */
export async function reorderCategories(
  ids: readonly string[],
  token: string | null,
): Promise<string[]> {
  return reorderResource('categories', ids, token);
}

export async function createCategory(
  input: TaxonomyInput,
  token: string | null,
): Promise<Category> {
  const body = await api<{ data: Category }>('/admin/categories', {
    method: 'POST',
    token,
    body: input,
  });
  return body.data;
}

export async function updateCategory(
  id: string,
  version: number,
  input: TaxonomyInput,
  token: string | null,
): Promise<Category> {
  const body = await api<{ data: Category }>(`/admin/categories/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
  return body.data;
}

export async function deleteCategory(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/categories/${id}`, { method: 'DELETE', token });
}

/* ── Subjects (writes only — the read lives in `reference-data.ts`) ───────── */

export async function createSubject(
  input: TaxonomyInput,
  token: string | null,
): Promise<SubjectRef> {
  const body = await api<{ data: SubjectRef }>('/admin/subjects', {
    method: 'POST',
    token,
    body: input,
  });
  return body.data;
}

export async function updateSubject(
  id: string,
  version: number,
  input: TaxonomyInput,
  token: string | null,
): Promise<SubjectRef> {
  const body = await api<{ data: SubjectRef }>(`/admin/subjects/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
  return body.data;
}

export async function deleteSubject(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/subjects/${id}`, { method: 'DELETE', token });
}

/* ── Levels ───────────────────────────────────────────────────────────────── */

export type GenderRestriction = 'any' | 'girls_only' | 'boys_only';

export interface Level {
  /**
   * §4.9's default content visibility for this Level, through its Category
   * (§15.1). §14.1's upload screen preselects it, and it rides the Level
   * because that is the list the screen loads — a default the screen cannot
   * read is a default it cannot honour.
   */
  default_visibility?: 'public' | 'private' | 'hidden';
  id: string;
  name: string;
  category_id: string;
  /** A label for grouping, never an identifier — `category_id` is that. */
  category_name: string;
  /** §4.4b / Revision 27 — who the Level admits, as data rather than as a name. */
  gender_restriction: GenderRestriction;
  display_order: number | null;
  group_count: number;
  subject_count: number;
  /** Live enrolments. Non-zero means deletion will be refused, and the screen
   *  can say so before the administrator tries. */
  enrollment_count: number;
  version: number;
}

/**
 * ~~`branch_id` is **required and is not stored on the Level** (TD-4.6b)~~
 * **Removed by Revision 66.** A Level belongs to a Category and to no Branch,
 * and creating one no longer creates a group, so there is nothing here for a
 * branch to describe — the server now **refuses** the field rather than
 * ignoring it. A branch is chosen when a Level is actually subdivided, on the
 * group. The original note follows because it explains what the field was for:
 * `branch_id` said
 * where المجموعة 1 goes. A Level is Category-scoped and branch-independent —
 * it may hold groups at several branches later.
 */
export interface CreateLevelInput {
  name: string;
  category_id: string;
  gender_restriction: GenderRestriction;
  display_order?: number | null;
}

/** `category_id` is absent deliberately: a Level does not move between
 *  Categories, and the server refuses the field outright rather than ignoring
 *  it — so a client cannot believe a move succeeded. */
export interface UpdateLevelInput {
  name?: string;
  gender_restriction?: GenderRestriction;
  display_order?: number | null;
}

export async function listLevels(
  token: string | null,
  categoryId?: string,
  sort: SortState | null = null,
  /**
   * **The Levels this beneficiary may enter** — R27's sex restriction and
   * BR-21's uniqueness, both resolved server-side. The dependency runs
   * beneficiary → Levels, because the business question is *where may SHE be
   * enrolled*, not *whom does this Level permit*.
   */
  eligibleForStudent?: string,
): Promise<Level[]> {
  const query = sortQuery(sort, {
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(eligibleForStudent ? { eligible_for_student: eligibleForStudent } : {}),
  });
  const body = await api<{ data: Level[] }>(`/admin/levels${query}`, { token });
  return body.data;
}

/**
 * R76.4 — **one Category's** Levels, in the order given.
 *
 * The Category is required, not inferred: §2.2 scopes `Level.display_order` to
 * its parent, so a sequence that did not name one would be a sequence about no
 * particular collection.
 */
export async function reorderLevels(
  categoryId: string,
  ids: readonly string[],
  token: string | null,
): Promise<string[]> {
  return reorderResource('levels', ids, token, categoryId);
}

/** Answers with the Level **and** the المجموعة 1 created with it, so the screen
 *  can say where the new Level's first group went. */
export async function createLevel(
  input: CreateLevelInput,
  token: string | null,
): Promise<Level> {
  const body = await api<{
    data: Level;
  }>('/admin/levels', { method: 'POST', token, body: input });
  return body.data;
}

export async function updateLevel(
  id: string,
  version: number,
  input: UpdateLevelInput,
  token: string | null,
): Promise<Level> {
  const body = await api<{ data: Level }>(`/admin/levels/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
  return body.data;
}

export async function deleteLevel(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/levels/${id}`, { method: 'DELETE', token });
}

/* ── Which Subjects a Level teaches (§4.4b) ──────────────────────────────── */

/**
 * The join that gates Teaching Groups.
 *
 * Without an assignment here, `createTeachingGroup` refuses with
 * `SUBJECT_NOT_IN_LEVEL` — which is exactly what the platform did for every
 * request while the table had no write path at all.
 */
export async function listLevelSubjects(
  levelId: string,
  token: string | null,
): Promise<SubjectRef[]> {
  const body = await api<{ data: SubjectRef[] }>(`/admin/levels/${levelId}/subjects`, { token });
  return body.data;
}

/** `PUT`, because it names a pair rather than creating an entity. A previously
 *  removed assignment is revived rather than duplicated. */
export async function assignSubject(
  levelId: string,
  subjectId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/levels/${levelId}/subjects/${subjectId}`, { method: 'PUT', token });
}

/** Refused while Teaching Groups exist for the pair — those groups split a
 *  Subject the Level would no longer teach. */
export async function unassignSubject(
  levelId: string,
  subjectId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/levels/${levelId}/subjects/${subjectId}`, { method: 'DELETE', token });
}

/**
 * `LevelSurah` — the **Quran-side curriculum join** (§4.5, §7, BR-11; M4c).
 *
 * R43 keeps it that way while the Quran is a Subject *for scheduling only*, so
 * this sits beside the Subject calls rather than in a Quran adapter: it is
 * curriculum structure, not progress. Super Admin writes; Admin reads.
 */
export interface LevelSurahRef {
  surah_id: number;
  name_arabic: string;
  name_transliterated: string;
  total_ayahs: number;
}

/** The seeded 114 (§4.5). Read, never hardcoded: a client-side copy of the
 *  names would be a second source of truth for reference data. */
export async function listQuranSurahs(token: string | null): Promise<LevelSurahRef[]> {
  return (await api<{ data: LevelSurahRef[] }>('/admin/quran-surahs', { token })).data;
}

export async function listLevelSurahs(
  levelId: string,
  token: string | null,
): Promise<LevelSurahRef[]> {
  return (await api<{ data: LevelSurahRef[] }>(`/admin/levels/${levelId}/surahs`, { token })).data;
}

export async function assignSurah(
  levelId: string,
  surahId: number,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/levels/${levelId}/surahs/${surahId}`, { method: 'PUT', token });
}

export async function unassignSurah(
  levelId: string,
  surahId: number,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/levels/${levelId}/surahs/${surahId}`, { method: 'DELETE', token });
}

/** BR-11 for a Level's enrolled مستفيدات. `complete: null` = no syllabus yet. */
export interface LevelCompletionRow {
  student_id: string;
  student_name: string;
  complete: boolean | null;
  configured_surahs: number;
  completed_surahs: number;
  final_exam_configured: boolean;
  surahs: { surah_id: number; name_arabic: string; coverage_percent: number }[];
}

export async function fetchLevelCompletion(
  levelId: string,
  token: string | null,
): Promise<LevelCompletionRow[]> {
  return (
    await api<{ data: LevelCompletionRow[] }>(`/admin/levels/${levelId}/completion`, { token })
  ).data;
}
