[Documentation](../README.md) › [Architecture](README.md) › **Internationalization**

# Internationalization

RTL-first and Arabic everywhere, except the three public pages, which read in seven languages (SRS Revision 209).

## Two different things called "language"

| | Interface chrome | Entity names |
|---|---|---|
| Examples | Buttons, labels, errors, empty states | Branch, category, level, subject names |
| Source | i18n catalogs (`ar` the source; six translations for the public pages) | Data entered by staff |
| Language | Arabic; the public pages in the reader's chosen language | Arabic always, in every interface language |

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

- Hardcoded user-facing text prohibited.
- API errors carry `message_key` plus a localized fallback `message`; clients render the key.

## The public pages in seven languages (R209)

- الرئيسية, الجدول الزمني, المحتوى التعليمي (`/`, `/calendar`, `/resources`) read in Arabic, English, French, Spanish, German, Standard Moroccan Amazigh in Tifinagh (`zgh`) and Tachelhit in Latin letters (`shi-Latn`); every other page is Arabic whatever was chosen.
- The header's language menu (those pages only) keeps the choice on the device (`bodour.locale`); a link may carry it (`?lang=en`); Arabic is the default.
- The language is settled before the application loads (`main.tsx` → `lib/locale.ts` → `app.tsx`), so a label computed at import time is already translated; a change reloads the page.
- Translations: `frontend/src/i18n/locales/<locale>.json`, flat keys of `ar.ts`'s public namespaces; a missing key reads in Arabic. «نظرة شاملة»'s text: `components/history/locales/<locale>.json`, keyed by where a string sits; fetched only on `/resources`.
- Stays Arabic in every language: names staff enter (levels, branches, subjects, classes, events), server messages, and the Qur'an's verses (﴿…﴾).
- Drafted by the agent; the Owner reviews, a native speaker reviews the two Amazigh catalogues before they are trusted.
- `i18n/locales.test.ts`: same keys in every language, placeholders and lists intact, verses unchanged, no Arabic left outside quotations.

## RTL

- `lang="ar" dir="rtl"` in the document (correct first paint); on a public page read in another language, `lib/locale.ts` sets `lang` and `dir="ltr"` before the first render.
- Logical properties and flex/grid `gap`, no directional margins; an LTR locale is a `dir` change. What is physical by nature (a clip-path, an arrow glyph, a slide-in) carries a `[dir='ltr']` variant.
- Tifinagh: Noto Sans Tifinagh, self-hosted, `unicode-range` U+2D30–2D7F only.
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
