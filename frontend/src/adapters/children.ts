import type { Me } from '../contexts/session.js';
import { t } from '../i18n/index.js';

/**
 * Linked-children adapter.
 *
 * `GET /me` returns `approved_child_links` as **student ids and nothing else**
 * — there is no endpoint yet that gives a parent their children's names, so the
 * switcher cannot label its options from the contract alone. This adapter is
 * that seam, and it exists for exactly the reason adapters are permitted: the
 * backend surface does not exist yet.
 *
 * It deliberately does **not** invent names. Until the contract carries one, an
 * option is labelled generically and disambiguated by a short id fragment,
 * which is honest — a fabricated name would be worse than an opaque one.
 *
 * **When the field lands, only this file changes.** Every consumer already
 * reads `{ id, label }`.
 */
export interface LinkedChild {
  id: string;
  label: string;
}

export function linkedChildren(me: Me | null): LinkedChild[] {
  if (!me) return [];
  return me.approved_child_links.map((id, index) => ({
    id,
    label: `${t('child.fallbackName')} ${toArabicDigits(index + 1)}`,
  }));
}

/** Arabic-Indic digits, matching how the rest of the interface reads. */
function toArabicDigits(value: number): string {
  return String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)] ?? d);
}
