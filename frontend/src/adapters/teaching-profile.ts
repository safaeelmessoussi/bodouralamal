import { api } from '../lib/api.js';

/**
 * The teaching profile (R88) — **planning data, not permissions**.
 *
 * Read and written by the administration only. The shape is deliberately
 * symmetric: the server replaces the profile whole, so the client sends the
 * whole thing rather than a diff it would have to compute correctly.
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
