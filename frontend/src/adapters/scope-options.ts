import { api } from '../lib/api.js';

/**
 * **`GET /me/scope-options` — the caller's own filter/compose vocabulary**
 * (NEW D).
 *
 * ## What this replaces, and why it is one read
 *
 * `useScopeOptions` used to assemble its vocabulary from four admin endpoints.
 * Three of them — `/admin/levels`, `/admin/subjects`, `/admin/academic-years` —
 * answer **403** for a مؤطِّرة by design (R30: *"reference data is an
 * administrative concern"*), so مكتبة المحتوى opened with a half-dead filter row
 * and no explanation. A fourth, `/admin/levels/{id}/subjects`, refused her too
 * the moment she chose a Level.
 *
 * **The fix is R93.4's, not a permission grant**: ask the smaller question. The
 * admin reads are untouched and still refuse her; this one answers *what may I
 * filter and compose by*, and the server decides that per caller.
 *
 * Each Level carries its own `subject_ids`, so the Level → Subject narrowing is
 * a lookup rather than a request — which is what removes the fourth `403`
 * rather than relocating it.
 */
export interface ScopeOptionsPayload {
  categories: { id: string; name: string }[];
  levels: {
    id: string;
    name: string;
    category_id: string;
    category_name: string;
    default_visibility: 'public' | 'private' | 'hidden';
    /**
     * **R123 — may a beneficiary of this Level's Category record her own
     * presence?** Carried on the Level exactly as `default_visibility` is, so
     * the scheduling form can decline to OFFER `self_or_staff` where the server
     * would always refuse it. Structural — no client compares Category names.
     */
    self_attendance_allowed: boolean;
    subject_ids: string[];
  }[];
  subjects: { id: string; name: string }[];
  academic_years: { id: string; label: string; is_current: boolean }[];
  branches: { id: string; name: string }[];
}

export async function fetchScopeOptions(token: string | null): Promise<ScopeOptionsPayload> {
  return (await api<{ data: ScopeOptionsPayload }>('/me/scope-options', { token })).data;
}
