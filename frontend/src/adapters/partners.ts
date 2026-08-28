import { api } from '../lib/api.js';

/**
 * Partners (NEW N).
 *
 * **The public shape carries a name and nothing else** — no logo, no URL, no
 * description, no contact. That is the entity, not a trimmed view of it: the
 * association supplied names, and the platform holds what it was given.
 */
export interface PublicPartner {
  id: string;
  name: string;
  /** What the partner is, in the association's words. `null` is ordinary. */
  description: string | null;
}

/** `GET /partners` — public, unauthenticated, and the landing section's only
 *  source. A partner added in the back office appears with no frontend change. */
export async function fetchPartners(): Promise<PublicPartner[]> {
  return (await api<{ data: PublicPartner[] }>('/partners')).data;
}

export interface Partner extends PublicPartner {
  display_order: number | null;
  /** Withheld from the public site without the record being withdrawn — a
   *  different question from deletion, and a different column. */
  is_visible: boolean;
  /** TD-15: loaded with the row, sent back on edit; a stale one is a `409`. */
  version: number;
}

export interface PartnerInput {
  name: string;
  description?: string | null;
  display_order?: number | null;
  is_visible?: boolean;
}

export async function listPartners(token: string | null): Promise<Partner[]> {
  return (await api<{ data: Partner[] }>('/admin/partners', { token })).data;
}

export async function createPartner(input: PartnerInput, token: string | null): Promise<Partner> {
  return (await api<{ data: Partner }>('/admin/partners', { method: 'POST', token, body: input }))
    .data;
}

export async function updatePartner(
  id: string,
  version: number,
  input: PartnerInput,
  token: string | null,
): Promise<Partner> {
  return (
    await api<{ data: Partner }>(`/admin/partners/${id}`, {
      method: 'PATCH',
      token,
      body: { version, ...input },
    })
  ).data;
}

export async function deletePartner(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/partners/${id}`, { method: 'DELETE', token });
}
