/**
 * How a person's name is composed from its collected parts (§7, Revisions 40–41).
 *
 * **The server does this, never a client** (§1.1). Two clients would disagree
 * about order and separator, and the wrong answer is a person's name rendered
 * backwards — a mistake nobody reviewing a list would spot, and one the person
 * themselves would find insulting.
 *
 * The same argument applies to two *server* sites, which is why this lives here
 * rather than beside its first caller: Revision 62 added three more places that
 * compose a child's name (the stored column at approval, and the approval
 * queue's two projections), and each had written the rule out again. One
 * statement, four callers.
 */

/**
 * A single space, personal name first, matching how Moroccan administrative
 * records read. Both parts are already trimmed and non-empty by the time they
 * reach here (Zod + a database CHECK), so the composition cannot produce a
 * leading or trailing space.
 */
export function composeArabicName(first: string, last: string): string {
  return `${first} ${last}`;
}

/**
 * `name_french` from its parts (§7, Revision 41), or `null` when the applicant
 * gave neither — the pair is optional, and an empty string would be a third
 * state meaning the same thing as absent.
 */
export function composeFrenchName(first?: string, last?: string): string | null {
  return first && last ? `${first} ${last}` : null;
}

/**
 * **The parts a stored name was composed from — derived when they were never
 * recorded** (2026-08-28).
 *
 * Revisions 40–41 introduced `first_name_*` / `last_name_*` and compose the
 * display name from them. Rows created before that, and every path that writes
 * only the composed column (§15.1's Super Admin, the development session, the
 * fixtures), carry a name and **no parts**. §5.6's edit form reads the parts, so
 * it opened blank on those people — and then refused to save, because both parts
 * are required.
 *
 * This derives them for reading, **without rewriting the stored row**. That is
 * the deliberate choice: splitting a name is a guess about where one person's
 * given name ends, and a migration would commit that guess for everybody at once
 * with nobody looking. Here the administrator sees the split in the form, and it
 * is only persisted if she saves — at which point it is her answer, not the
 * platform's.
 *
 * **The first token is the personal name and the remainder is the family name**,
 * matching the order `composeArabicName` writes. A single-token name has no
 * family part, and reports that rather than duplicating the token.
 */
export function splitComposedName(composed: string | null): {
  first: string | null;
  last: string | null;
} {
  const trimmed = (composed ?? '').trim();
  if (trimmed === '') return { first: null, last: null };
  const boundary = trimmed.indexOf(' ');
  if (boundary === -1) return { first: trimmed, last: null };
  return {
    first: trimmed.slice(0, boundary),
    last: trimmed.slice(boundary + 1).trim(),
  };
}
