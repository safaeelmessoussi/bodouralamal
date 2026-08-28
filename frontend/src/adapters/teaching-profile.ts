import { api } from '../lib/api.js';

/**
 * The teaching profile (R88) — **planning data, not permissions**.
 *
 * The shape is deliberately symmetric: the server replaces the profile whole,
 * so the client sends the whole thing rather than a diff it would have to
 * compute correctly.
 *
 * **Two authorities, two endpoints, and the difference is the point** (R106).
 * The administration reads and replaces a whole profile through
 * `/admin/users/{id}/teaching-profile`. A مؤطِّرة reads her own and replaces
 * **only her availability** — what she may TEACH stays the administration's
 * record of her (R88.2). The narrower call is a narrower path rather than the
 * same path with a smaller body, so the grant is legible at the boundary.
 */
export interface AvailabilityRange {
  weekday: string;
  start_time: string;
  end_time: string;
}

export interface TeachingProfile {
  userId: string;
  subjects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  availability: (AvailabilityRange & { id: string })[];
}

/**
 * Her own profile **plus the catalogue she chooses from** (2026-08-30).
 *
 * Only `/me/teaching-profile` and the two self-service writes answer this. The
 * options ride on the read she already makes because a مؤطِّرة cannot call
 * `/admin/subjects` — and widening that to make this screen work would be the
 * one fix that is never right (rule O). Rule AX besides: the form that decides
 * what is saved carries the options it saves from.
 */
export interface OwnTeachingProfile extends TeachingProfile {
  selectable_subjects: { id: string; name: string }[];
  selectable_categories: { id: string; name: string }[];
}

export interface TeachingProfileInput {
  subject_ids: string[];
  category_ids: string[];
  availability: AvailabilityRange[];
}

export async function fetchTeachingProfile(
  userId: string,
  token: string | null,
): Promise<TeachingProfile> {
  const body = await api<{ data: TeachingProfile }>(`/admin/users/${userId}/teaching-profile`, {
    token,
  });
  return body.data;
}

export async function saveTeachingProfile(
  userId: string,
  input: TeachingProfileInput,
  token: string | null,
): Promise<TeachingProfile> {
  const body = await api<{ data: TeachingProfile }>(`/admin/users/${userId}/teaching-profile`, {
    method: 'PUT',
    token,
    body: input,
  });
  return body.data;
}

/**
 * **Her own profile** (R106) — `GET /me/teaching-profile`.
 *
 * The whole profile, capabilities included — and since 2026-08-30 the
 * catalogue she may choose them from, because the Owner made those two fields
 * hers to edit. Availability presented with no sight of what it is
 * availability *for* would be a question asked out of context.
 */
export async function fetchMyTeachingProfile(token: string | null): Promise<OwnTeachingProfile> {
  return (await api<{ data: OwnTeachingProfile }>('/me/teaching-profile', { token })).data;
}

/**
 * **Her ranges, replaced whole** (R106) — `PUT /me/teaching-profile/availability`.
 *
 * Sends `availability` and nothing else. The server's schema is `.strict()`, so
 * adding `subject_ids` here would be refused rather than ignored — which is
 * deliberate on both sides: a silently dropped field beside a response echoing
 * the profile would look exactly like a successful rewrite of what she is
 * authorised to teach.
 */
/**
 * **Her declarations, replaced whole** (Owner, 2026-08-30) —
 * `PUT /me/teaching-profile/capabilities`.
 *
 * The counterpart of `saveMyAvailability`, and a separate call for the same
 * reason the routes are separate: each replaces exactly the half it names, so a
 * page holding a stale copy of the other half cannot erase it. The server's
 * schema is `.strict()`, so sending `availability` here is refused.
 *
 * **Planning metadata.** Declaring a Subject tells the administration what to
 * consider her for; teaching authority is an assignment and lives elsewhere.
 */
export async function saveMyCapabilities(
  subjectIds: readonly string[],
  categoryIds: readonly string[],
  token: string | null,
): Promise<OwnTeachingProfile> {
  const body = await api<{ data: OwnTeachingProfile }>('/me/teaching-profile/capabilities', {
    method: 'PUT',
    token,
    body: { subject_ids: subjectIds, category_ids: categoryIds },
  });
  return body.data;
}

export async function saveMyAvailability(
  availability: readonly AvailabilityRange[],
  token: string | null,
): Promise<OwnTeachingProfile> {
  const body = await api<{ data: OwnTeachingProfile }>('/me/teaching-profile/availability', {
    method: 'PUT',
    token,
    body: { availability },
  });
  return body.data;
}
