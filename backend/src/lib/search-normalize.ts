/**
 * Search normalization (SRS TD-10, Revision 9).
 *
 * TD-10 requires normalization to be **applied identically to the query and to
 * the stored value**. The stored side is a generated shadow column populated by
 * the `normalize_search_text` / `normalize_phone` functions in the TD-6a
 * migration, so these are deliberate mirrors of that SQL.
 *
 * They are mirrors rather than a call into the database because §16.2 permits
 * application raw SQL only for row locks and pg-boss inserts — invoking the
 * function over `$queryRaw` would exceed that exception. The duplication is
 * therefore intentional, and the risk it carries (the two drifting apart, which
 * would silently break every search) is closed by a parity test that runs both
 * implementations over the same corpus and asserts identical output.
 *
 * TD-10 also requires the shadow column to be matched with `ILIKE '%…%'`;
 * normalization is never applied per row at query time.
 */

/**
 * Tashkeel U+064B–U+0652, superscript alef U+0670, and tatweel U+0640 — stripped
 * before any letter folding, exactly as the SQL does.
 */
const ARABIC_DIACRITICS = /[ً-ْٰـ]/g;

/**
 * The `translate()` pairs from the migration, in the same order: alef variants
 * and `ٱ` fold to `ا`, `ة`→`ه`, `ى`→`ي`, then French accent folding.
 */
const FOLD_FROM = 'أإآٱةىéèêëàâäîïôöûüùç';
const FOLD_TO = 'ااااهيeeeeaaaiioouuuc';

const FOLD_MAP = new Map<string, string>();
for (let i = 0; i < FOLD_FROM.length; i += 1) {
  FOLD_MAP.set(FOLD_FROM[i]!, FOLD_TO[i]!);
}

/**
 * Mirrors `normalize_search_text(text)`.
 *
 * Order matters and matches the SQL: lowercase first, so an uppercase accented
 * letter folds through its lowercase form, then strip diacritics, then fold
 * letters, then collapse whitespace and trim.
 */
export function normalizeSearchText(input: string): string {
  const lowered = input.toLowerCase();
  const stripped = lowered.replace(ARABIC_DIACRITICS, '');
  let folded = '';
  for (const char of stripped) {
    folded += FOLD_MAP.get(char) ?? char;
  }
  return folded.replace(/\s+/g, ' ').trim();
}

/** Mirrors `normalize_phone(text)`: strips whitespace and `+` before matching. */
export function normalizePhone(input: string): string {
  return input.replace(/[\s+]/g, '');
}

/** TD-10: minimum query length is 2 characters. */
export const MIN_QUERY_LENGTH = 2;
