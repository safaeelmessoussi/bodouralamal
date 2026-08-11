import { api } from '../lib/api.js';
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
  /** TD-15: loaded by the edit form and sent back; a stale one is a `409`. */
  version: number;
}

export interface TaxonomyInput {
  name: string;
  display_order?: number | null;
}

export async function listCategories(token: string | null): Promise<Category[]> {
  const body = await api<{ data: Category[] }>('/admin/categories', { token });
  return body.data;
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
): Promise<Level[]> {
  const query = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : '';
  const body = await api<{ data: Level[] }>(`/admin/levels${query}`, { token });
  return body.data;
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
