/**
 * The public display name of a person — SRS Revision 36.1.
 *
 * **The single place this question is answered.** `public_display_name` when
 * set, otherwise the full name. It is a function rather than an inline `??` at
 * each call site because the two branches are not equivalent: choosing wrongly
 * publishes a legal name where the person asked for a kunya, and a rule with
 * more than one implementation is one that eventually disagrees with itself.
 *
 * Clients never receive the inputs — only this result (TD-3.4).
 */
export function publicDisplayName(person: {
  publicDisplayName: string | null;
  nameArabic: string;
}): string {
  const chosen = person.publicDisplayName?.trim();
  return chosen ? chosen : person.nameArabic;
}
