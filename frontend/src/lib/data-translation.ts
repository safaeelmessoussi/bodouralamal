/**
 * **SRS Revision 224 §4 — the stored texts in the reader's language.**
 *
 * The public pages (the only ones that translate, `translatesHere`) load one
 * dictionary — Arabic text → translation, from `GET /translations` — and every
 * response they read passes through {@link translateDeep}. A text is matched:
 *
 * 1. whole («وميض الأمل»);
 * 2. as a pattern («سورة {surah}», «الحلقة {n}»), its parts translated in turn;
 * 3. by its parts, at the separators the server composes titles with
 *    (« — », «، », « · »);
 * 4. word by word for the few listed words (weekdays, months).
 *
 * A Surah's name is looked up as `surah:<name>` first wherever the context is
 * a Surah (a `surah…` field, the `{surah}`/`{list}` of a pattern): «النساء» is
 * a Category and a Surah, «الجمعة» a weekday and a Surah.
 *
 * What matches nothing stays Arabic — a person's name is never in the
 * dictionary, so it is never changed. Ids, URLs and Latin text pass untouched.
 */
let exact = new Map<string, string>();
let patterns: { re: RegExp; slots: string[]; text: string }[] = [];
let words = new Map<string, string>();

const ARABIC = /[؀-ۿ]/;
const SEPARATORS: [string, string][] = [
  [' — ', ' — '],
  [' · ', ' · '],
  ['، ', ', '],
];

export function setDataDictionary(dictionary: Record<string, string> | null): void {
  exact = new Map();
  patterns = [];
  words = new Map();
  for (const [source, text] of Object.entries(dictionary ?? {})) {
    if (source.startsWith('word:')) {
      words.set(source.slice(5), text);
    } else if (source.includes('{')) {
      const slots: string[] = [];
      const escaped = source.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, name: string) => {
        slots.push(name);
        return '(.+?)';
      });
      patterns.push({ re: new RegExp(`^${escaped}$`), slots, text });
    } else {
      exact.set(source, text);
    }
  }
  // The longest pattern first: «كل مستويات {category}» before a shorter one it contains.
  patterns.sort((a, b) => b.re.source.length - a.re.source.length);
}

export function hasDataDictionary(): boolean {
  return exact.size > 0 || patterns.length > 0;
}

export function translateText(text: string, depth = 0, surah = false): string {
  if (!ARABIC.test(text) || depth > 6) return text;
  const trimmed = text.trim();
  const whole = (surah ? exact.get(`surah:${trimmed}`) : undefined) ?? exact.get(trimmed);
  if (whole !== undefined) return text.replace(trimmed, whole);
  for (const pattern of patterns) {
    const match = pattern.re.exec(trimmed);
    if (!match) continue;
    let out = pattern.text;
    pattern.slots.forEach((slot, i) => {
      out = out.replace(`{${slot}}`, translateText(match[i + 1] ?? '', depth + 1, slot === 'surah' || slot === 'list'));
    });
    return out;
  }
  for (const [sep, joined] of SEPARATORS) {
    if (trimmed.includes(sep)) {
      return trimmed
        .split(sep)
        .map((part) => translateText(part, depth + 1, surah))
        .join(joined);
    }
  }
  return trimmed
    .split(/(\s+)/)
    .map((word) => words.get(word) ?? word)
    .join('');
}

/** Keys whose values are identifiers, addresses or codes — never words. */
const UNTOUCHED = /(^id$|_id$|_ids$|^url$|_url$|mime_type|^kind$|^status$|^visibility$|^origin$|^date$|_at$|_on$|_time$|^locale$)/;

export function translateDeep<T>(value: T, key = ''): T {
  if (!hasDataDictionary() || UNTOUCHED.test(key)) return value;
  if (typeof value === 'string') return translateText(value, 0, /surah/i.test(key)) as T;
  if (Array.isArray(value)) return value.map((item) => translateDeep(item, key)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = translateDeep(v, k);
    return out as T;
  }
  return value;
}
