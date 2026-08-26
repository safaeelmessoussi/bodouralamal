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
 * The whole profile, capabilities included: the page shows what the
 * administration has recorded she can teach, read-only, beside the ranges she
 * edits. Availability presented with no sight of what it is availability *for*
 * is a question asked out of context.
 */
export async function fetchMyTeachingProfile(token: string | null): Promise<TeachingProfile> {
  return (await api<{ data: TeachingProfile }>('/me/teaching-profile', { token })).data;
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
export async function saveMyAvailability(
  availability: readonly AvailabilityRange[],
  token: string | null,
): Promise<TeachingProfile> {
  const body = await api<{ data: TeachingProfile }>('/me/teaching-profile/availability', {
    method: 'PUT',
    token,
    body: { availability },
  });
  return body.data;
}
