import { api } from '../lib/api.js';

/**
 * Platform settings (§5.6, TD-3.11, Revision 42).
 *
 * **Super Admin only**, enforced server-side against live rows (TD-12) — the
 * `/admin/` prefix is not the permission boundary, so this adapter carries no
 * permission logic of its own.
 *
 * The screen renders whatever the server lists. `label_key` and `hint_key` are
 * **i18n keys chosen by the backend**, not copy: which settings are writable is
 * a server decision (an explicit allow-list), and a client holding its own list
 * would drift out of step with it the first time one was added.
 */

export interface Setting {
  key: string;
  label_key: string;
  hint_key: string;
  /** `null` when never configured — distinct from empty, which is refused. */
  value: string | null;
  /**
   * Which control to render (2026-08-17). The allow-list gained integer settings
   * — the grading scale — and the server publishes the kind rather than leaving
   * the client to infer it from the key, which would be a second copy of a
   * server-side decision.
   */
  kind: 'text' | 'integer';
  /** TD-15: sent back on save; a stale one is a `409`. */
  version: number;
}

export async function listSettings(token: string | null): Promise<Setting[]> {
  const body = await api<{ data: Setting[] }>('/admin/settings', { token });
  return body.data;
}

/** TD-15 optimistic locking: `version` is required and a stale one is refused
 *  rather than overwriting another Super Admin's change. */
export async function updateSetting(
  key: string,
  value: string,
  version: number,
  token: string | null,
): Promise<Setting> {
  return api<Setting>(`/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    token,
    body: { value, version },
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * The versioned legal consent wording (R119).
 *
 * Lives beside the settings adapter because it is what `إعدادات المنصة`
 * actually manages now: the setting it used to carry,
 * `legal.consent_text_version`, was a free-text string with no technical
 * relationship to the Arabic wording it claimed to version.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface ConsentTextVersion {
  id: string;
  /** What the Super Admin assigns and a compliance reader acts on. */
  version_label: string;
  /** The exact Arabic wording — shown in full, never summarised. */
  body_arabic: string;
  /**
   * SHA-256 of the wording. **Not shown to the administrator**: the Owner's
   * instruction is that nobody should have to manage a hash. It travels for a
   * support engineer comparing an export against the record.
   */
  body_digest: string;
  status: 'draft' | 'active' | 'superseded';
  created_at: string;
  activated_at: string | null;
  superseded_at: string | null;
  /** How many recorded consents name it — why a used wording cannot change. */
  consent_record_count: number;
  version: number;
}

export async function listConsentTexts(token: string | null): Promise<ConsentTextVersion[]> {
  const body = await api<{ data: ConsentTextVersion[] }>('/admin/legal-consent-texts', { token });
  return body.data;
}

export async function createConsentText(
  input: { version_label: string; body_arabic: string },
  token: string | null,
): Promise<ConsentTextVersion> {
  return api<ConsentTextVersion>('/admin/legal-consent-texts', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateConsentText(
  id: string,
  input: { version_label: string; body_arabic: string },
  version: number,
  token: string | null,
): Promise<ConsentTextVersion> {
  return api<ConsentTextVersion>(`/admin/legal-consent-texts/${id}`, {
    method: 'PATCH',
    token,
    body: { ...input, version },
  });
}

/** Its own call, because activating is a decision and not a field. */
export async function activateConsentText(
  id: string,
  token: string | null,
): Promise<ConsentTextVersion> {
  return api<ConsentTextVersion>(`/admin/legal-consent-texts/${id}/activate`, {
    method: 'POST',
    token,
  });
}
