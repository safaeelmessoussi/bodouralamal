import { api } from '../lib/api.js';

/**
 * The versioned Privacy Policy and Terms of Use (R138 §12/§13).
 *
 * **The same pattern `settings.ts`'s `ConsentTextVersion` already carries**,
 * with `kind` added: Privacy Policy and Terms of Use are two independent
 * documents, each with its own current version, rather than the one shared
 * wording `LegalConsentText` manages.
 */

export type LegalDocumentKind = 'privacy_policy' | 'terms_of_use';

export interface LegalDocumentVersion {
  id: string;
  kind: LegalDocumentKind;
  /** What the Super Admin assigns and a compliance reader acts on. Unique
   *  WITHIN its kind — Privacy Policy and Terms of Use may reuse a label. */
  version_label: string;
  /** The exact Arabic text — shown in full, never summarised. */
  body_arabic: string;
  status: 'draft' | 'active' | 'superseded';
  created_at: string;
  activated_at: string | null;
  superseded_at: string | null;
  version: number;
}

export async function listLegalDocuments(
  kind: LegalDocumentKind,
  token: string | null,
): Promise<LegalDocumentVersion[]> {
  const body = await api<{ data: LegalDocumentVersion[] }>(`/admin/legal-documents/${kind}`, {
    token,
  });
  return body.data;
}

export async function createLegalDocument(
  input: { kind: LegalDocumentKind; version_label: string; body_arabic: string },
  token: string | null,
): Promise<LegalDocumentVersion> {
  return api<LegalDocumentVersion>('/admin/legal-documents', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateLegalDocument(
  id: string,
  input: { version_label: string; body_arabic: string },
  version: number,
  token: string | null,
): Promise<LegalDocumentVersion> {
  return api<LegalDocumentVersion>(`/admin/legal-documents/${id}`, {
    method: 'PATCH',
    token,
    body: { ...input, version },
  });
}

/** Its own call, because activating is a decision and not a field. */
export async function activateLegalDocument(
  id: string,
  token: string | null,
): Promise<LegalDocumentVersion> {
  return api<LegalDocumentVersion>(`/admin/legal-documents/${id}/activate`, {
    method: 'POST',
    token,
  });
}

/**
 * `GET /legal-documents/{kind}` — anonymous, the version the public
 * `/privacy`/`/terms` page must show. Fails closed with `503` /
 * `LEGAL_DOCUMENT_NOT_CONFIGURED` when nobody has activated one yet.
 */
export async function fetchActiveLegalDocument(
  kind: LegalDocumentKind,
): Promise<{ id: string; version_label: string; body_arabic: string; activated_at: string | null }> {
  return api(`/legal-documents/${kind}`);
}
