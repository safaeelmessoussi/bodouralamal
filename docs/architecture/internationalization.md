[Documentation](../README.md) › [Architecture](README.md) › **Internationalization**

# Internationalization

Arabic-only at launch, RTL-first; French/English machinery in place and unused.

## Two different things called "language"

| | Interface chrome | Entity names |
|---|---|---|
| Examples | Buttons, labels, errors, empty states | Branch, category, level, subject names |
| Source | i18n catalogs (`ar` ships; `fr`/`en` post-MVP) | Data entered by staff |
| Language | Arabic at launch, translatable | Arabic always, in every interface language |

## One `name` column, natively collated

- Branch, Category, Level, Subject carry a single Arabic `name`; no `name_ar`/`name_fr` (removes bilingual drift).
- Column collated `ar-x-icu` at the database, so sorting is correct in every query with no per-query `COLLATE`; `C`/`en_US` sort by codepoint.
- Registered in the first hand-written migration: `CREATE COLLATION IF NOT EXISTS "ar-x-icu" (provider = icu, locale = 'ar', deterministic = true);`
- Never add a per-query `COLLATE` workaround; fix the column.

> [`BR-19`](../reference/business-rules.md#br-19) · [Database](database.md#arabic-collation)

## Display ordering

- Branches, categories, levels, subjects carry optional integer `display_order`; every list sorts by it ascending, fallback alphabetical on collated `name`.
- Scope: branches and categories application-wide, levels within their category, subjects application-wide.
- Editable by Super Admins only (reference data).

## Every string is a key

- Hardcoded user-facing text prohibited; FR/EN catalogs are a pure content task (populate, re-enable the switcher).
- API errors carry `message_key` plus a localized fallback `message`; clients render the key.

## RTL

- `lang="ar" dir="rtl"` on the document, not toggled by script (correct first paint).
- Logical properties and flex/grid `gap`, no directional margins; an LTR locale is a `dir` change.
- Layouts tested at 360 px minimum width.

## Search normalization

Identical normalization on query and stored value:

| Class | Normalization |
|---|---|
| Diacritics | Strip tashkeel and tatweel |
| Alef variants | أ إ آ → ا |
| Ta marbuta | ة → ه |
| Alef maqsura | ى → ي |
| Latin (French names) | Lowercase, fold accents (é → e) |
| Phone | Strip spaces and `+` |

- Substring match (`سعاد` matches `أم سعاد`); minimum query length 2; case-insensitive.
- Each searchable column has a generated, indexed normalized shadow column queried with `ILIKE '%…%'`; never normalize per row at query time.
- No fuzzy matching in the MVP (no trigram, Levenshtein or search engine); misspellings are a data-entry problem; revisiting is an explicit decision.

## Dates

- Gregorian drives all computation; Hijri is a decorative overlay reproducing the Ministry's announcements, never computed.
- Arabic month names, Moroccan Gregorian set: يناير، فبراير، مارس، أبريل، ماي، يونيو، يوليوز، غشت، شتنبر، أكتوبر، نونبر، دجنبر.
- Week starts Monday everywhere.

> [Calendar and Hijri](calendar-and-hijri.md)

## Names of people

- Arabic name, optional French name, nickname (internal search convenience), optional public display name (e.g. a kunya) while the legal name stays for records.
- The backend decides what is shown publicly, never a client ([why](security.md#on-public-surfaces)).

## Sex is a property of a person, not of a curriculum

- Restriction lives on `Level.gender_restriction` paired with `User.sex` (R27); a restriction must never be encoded in a name.
- R27's sex-neutral category rename did not stand: the association's names المرأة, اليافعات, الطفل are authoritative (R121, 2026-09-02); `gender_restriction` unchanged.
- A (stage, sex) combination exists when a level admits it; opening Teen + Male is Super Admin data entry; clients must not hardcode combinations.

**Next:** [Performance and scale](performance-and-scale.md) · **Related:** [Design system](design-system.md), [Database](database.md#search)
