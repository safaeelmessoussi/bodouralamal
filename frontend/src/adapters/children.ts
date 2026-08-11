import type { Me } from '../contexts/session.js';

/**
 * Linked-children adapter.
 *
 * **This file used to fabricate names.** `GET /me` returned `approved_child_links`
 * as bare student ids, so the switcher labelled its options «طفل مرتبط ١»,
 * «طفل مرتبط ٢» from the array index — a parent of three could not tell which
 * child they were about to act for, and the numbering shifted the moment a link
 * was revoked. The adapter existed to make that seam visible and to promise that
 * *when the field lands, only this file changes.*
 *
 * **R62 landed it.** The contract now carries `display_name`, and the promise is
 * kept: every consumer already reads `{ id, label }`, so nothing else moved.
 *
 * What remains is the shape translation itself, which is worth keeping — the
 * switcher's options are `{ id, label }` whatever the server calls its fields,
 * and the components stay ignorant of the wire format.
 */
export interface LinkedChild {
  id: string;
  label: string;
}

export function linkedChildren(me: Me | null): LinkedChild[] {
  if (!me) return [];
  return me.approved_child_links.map((link) => ({ id: link.id, label: link.display_name }));
}
