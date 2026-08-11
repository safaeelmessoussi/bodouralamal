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
