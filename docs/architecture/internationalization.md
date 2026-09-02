[Documentation](../README.md) › [Architecture](README.md) › **Internationalization**

# Internationalization

Arabic-only at launch, RTL-first, with the machinery for French and English already in place
and unused.

## Two different things called "language"

Conflating them causes confusion, so the split is explicit:

| | **Interface chrome** | **Entity names** |
|---|---|---|
| Examples | Buttons, labels, error messages, empty states | Branch, category, level, subject names |
| Source | i18n catalogs (`ar` ships; `fr`/`en` post-MVP) | **Data**, entered by staff |
| Language | Arabic at launch, translatable later | **Arabic always**, in every interface language |

Entity names are **not translated**, in any interface language. A branch called *مقر أمرشيش*
is called that on the French interface too.

## One `name` column, natively collated

The structural entities — Branch, Category, Level, Subject — each carry a **single Arabic
`name` column**. No `name_ar`/`name_fr` split.

Two reasons:

**It removes bilingual drift.** With two columns, one of them is eventually stale, and
nothing tells you which.

**The column is natively collated `ar-x-icu` at the database level**, which means sorting is
correct **by default in every query**, with no per-query `COLLATE` clause anywhere.

That second point deserves emphasis. Default `C` or `en_US` collation sorts Arabic **by
codepoint** and produces orderings that look wrong to every user. The collation is
registered explicitly in the first hand-written migration rather than assumed present:

```sql
CREATE COLLATION IF NOT EXISTS "ar-x-icu" (provider = icu, locale = 'ar', deterministic = true);
```

> **Never add a per-query `COLLATE` workaround. Fix the column.**
> [`BR-19`](../reference/business-rules.md#br-19) · [Database](database.md#arabic-collation)

## Display ordering

Branches, categories, levels, and subjects carry an optional integer `display_order`.
Everywhere they are listed — dropdowns, directories, navigation, dashboards — they sort by
it ascending.

Where it is null or equal, the fallback is alphabetical on `name`, **which is correct
automatically** because the column is collated. Ordering scope: branches and categories
application-wide, levels within their parent category, subjects application-wide.

`display_order` is editable by **Super Admins only** — it is reference data.

## Every string is a key

Hardcoded user-facing text is **prohibited**, from day one, even though only the Arabic
catalog ships.

That discipline is what makes the French and English catalogs a **pure content task**
post-MVP: populate the catalogs, re-enable the language switcher, ship. No code change, no
audit for missed strings.

**API error messages resolve through keys too.** The error envelope carries a `message_key`
alongside a localized fallback `message`, so a client renders the key it knows rather than
displaying server-composed prose.

## RTL

`lang="ar" dir="rtl"` is set **on the document**, not toggled by script — the first paint is
correct, because a right-to-left layout that reflows after hydration reads as broken.

Layout uses logical properties and flex/grid with `gap` rather than directional margins, so
adding an LTR locale later is a `dir` change rather than a stylesheet fork. Layouts are
tested at **360 px** minimum width.

## Search normalization

Arabic text has several ways to write the same word. Search folds them, applying **identical
normalization to the query and to the stored value**:

| Class | Normalization |
|---|---|
| Diacritics | Strip tashkeel and tatweel |
| Alef variants | أ إ آ → ا |
| Ta marbuta | ة → ه |
| Alef maqsura | ى → ي |
| Latin (French names) | Lowercase, fold accents (é → e) |
| Phone | Strip spaces and `+` |

Matching is **substring**, not prefix-only and not whole-word — `سعاد` matches `أم سعاد`.
Minimum query length 2, case-insensitive.

**Implementation matters:** each searchable column is paired with a **generated normalized
shadow column**, indexed, and queried with `ILIKE '%…%'` against the shadow. Normalization is
**never** applied per row at query time — that would defeat every index.

**No fuzzy matching in the MVP.** No trigram similarity, no Levenshtein, no search engine.
The normalization rules collapse the dominant variant classes, which is what actually
absorbs paper-roster spelling variance; genuine misspellings are a data-entry correction
problem, not a search-engine problem. Revisiting this is an explicit decision, not an
implementer's initiative.

## Dates

Two calendars are displayed together. The Gregorian calendar drives all computation; the
Hijri side is a **decorative overlay reproducing the Ministry's official announcements**,
never computed.

Month names render in Arabic — including the Moroccan Gregorian month names (يناير، فبراير،
مارس، أبريل، ماي، يونيو، يوليوز، غشت، شتنبر، أكتوبر، نونبر، دجنبر), which differ from the
Levantine set and are what Moroccan users expect.

**Week starts Monday**, everywhere.

> [Calendar and Hijri](calendar-and-hijri.md)

## Names of people

Person records carry an Arabic name, an optional French name, a nickname (an internal search
convenience), and optionally a **public display name** — a name the person chooses to
publish, letting an instructor appear publicly as a kunya while the platform keeps her legal
name for the records that need it.

Which of those is shown publicly is **decided by the backend, never by a client**
([why](security.md#on-public-surfaces)).

## Sex is a property of a person, not of a curriculum

Worth recording here because it was originally an *i18n* problem masquerading as a data
model.

The categories were once named المرأة (adult women) and اليافعات (teen girls) — names that
encode sex. Every seeded level nonetheless carried `gender_restriction = any`, so **the
restriction existed only in the Arabic words**. A query asking whether a boy could enrol got
`any` and said yes.

Revision 27 fixed the half that mattered: **the restriction moved onto
`Level.gender_restriction`**, paired with `User.sex`, as data a query can read. That is the
rule that stands — **a restriction must never be encoded in a name**, because a name is not
something logic can consult.

The **rename** that travelled with it did not stand. R27's migration also renamed the
categories to sex-neutral forms, and this page recorded those as the product's names. The
Document Owner clarified on 2026-09-02 (**Revision 121**) that the association's own names are
**المرأة, اليافعات, الطفل**, and they are authoritative. The rename was a consequence of the
normalisation rather than a product decision; nothing about `gender_restriction` changes.

The property this bought: a (stage, sex) combination is available precisely when a level
exists for that stage admitting that sex. Opening Teen + Male later is **Super Admin data
entry** — no category rename, no schema change, no registration-flow redesign. **Clients must
not hardcode the available combinations**; they render what the reference data exposes.

---

**Next:** [Performance and scale](performance-and-scale.md) · **Related:**
[Design system](design-system.md), [Database](database.md#search)
