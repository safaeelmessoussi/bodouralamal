[Documentation](../README.md) › [Overview](README.md) › **Glossary**

# Glossary

## Domain vocabulary

| Term | Arabic | Meaning |
|---|---|---|
| Association | الجمعية | جمعية بذور الأمل, the operating nonprofit |
| Branch | فرع | Physical location running sessions; has an operational start date before which its calendar is greyed out |
| Category | الفئة | Generic stage: Adult (الكبار), Teen (اليافعون), Child (الطفل); sex is never in a category name, it lives on the level |
| Level | مستوى بالجمعية | Academic tier within a category; numbering not uniform across categories (never assume a level 0) |
| Academic year | السنة الدراسية | Calendar span labelled `YYYY-YYYY`; not a pedagogical level; may hold two Levels for one student, and one Level may span years |
| Academic period | الفصل الدراسي | Semester in a year, numbered from 1, start + inclusive end date; an enrolment belongs to exactly one; period dates (never `deleted_at`) decide currency |
| Studies year / progression year | سنة الدراسة | Is the Level: Category orders Levels by `display_order`; no separate entity |
| Group | مجموعة | Cohort within a level with fixed weekly time, room, instructor(s); the scheduling unit |
| Event | حدث | One-off or exception calendar item (holiday, activity, exam) layered over group schedules |
| Round | الدورة | Grading period, roughly a semester; manual sorting label, not a restriction |
| Instructor | مؤطِّرة | Teacher, scoped to assigned groups |
| Quran domain | القرآن الكريم | Curriculum domain, not a Subject row; atomic Subjects أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن, تفسير القرآن; extensible |
| Subject | مادة | Extensible atomic schedulable curriculum item; only حفظ القرآن carries the marker authorising memorisation entry (R107–R108) |
| Committee | لجنة | Cross-cutting tag; postponed; tables not pre-created |
| Follow-up | — | Admin noticing dropping engagement and checking in; not automated |
| Global / no branch | بدون فرع | Content/events on no branch, shown across all; Admins only |

## Platform vocabulary

| Term | Meaning |
|---|---|
| Consent record | Auditable row per grant/revocation with exact text version; never a boolean |
| Active child context | Linked minor a parent acts for, asserted per request via `X-Active-Child-ID`, verified server-side |
| Basis points (bp) | Grading unit; 10,000 bp = 100 %, 3,333 bp = 33.33 %; integer only |
| Pre-provisioned account | Staff-created against a Google address; binds on first login |
| Soft delete | Row marked deleted with a full JSON snapshot kept 90 days |
| Trash | Snapshot store for restoration; distinct from the audit log (accountability) |
| Reference data | Branches, rooms, levels, categories, subjects, academic year, settings, Hijri calendar; Super Admin writes only |
| Operational data | Users, approvals, groups, enrolments, progress, exams, content, events; Admin within branch scope |
| Occurrence | One rendered instance of a weekly slot or event from the calendar |
| Public display name | Optional chosen name (e.g. kunya) instead of legal name; always resolved by the backend |

## Identifier scheme

| Form | Means | Where |
|---|---|---|
| `§4.3` | SRS section | [`SRS.md`](../SRS.md) |
| `BR-x` | Business rule, technology-independent invariant | SRS §12 · [index](../reference/business-rules.md) |
| `TD-x` | Technical design constraint | SRS §13 · [index](../reference/technical-design.md) |
| `R31` | Specification revision with rationale | SRS §0 · [decision log](../reference/decision-log.md) |
| `J1`…`J8` | End-to-end journey | SRS §17 · [journeys](user-journeys.md) |
| `M0`…`M8` | Delivery milestone | [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) |
| `R-1`…`R-10` | Open risk | SRS §11 · [risks](scope-and-roadmap.md#open-risks) |
| `T1`…`T12` | Token-lifecycle acceptance criterion | SRS §18 |

- Precedence: a business rule wins over any conflicting section, and the conflict must be reported.

## Technical terms used in a specific way here

| Term | Here |
|---|---|
| Wall-clock time | No timezone; 17:00 is 17:00 locally; all group/event times (Morocco suspends DST in Ramadan) |
| Optimistic locking | Edit sends the loaded version; stale → `409 VERSION_CONFLICT`, never silent overwrite |
| Freshness assertion | Re-read account status from the database on high-risk requests |
| Expand–migrate–contract | Add alongside, backfill and switch, drop in a later migration |
| Existence leak | Revealing whether a record exists; prevented by `404` for missing and out-of-scope alike |
| Self-healing cache | Aggregate stamped with the newest input; readers repair mismatches in place |
| Composite document | One response bundling bounded reference lists; not a list endpoint, no pagination |

## Arabic in the platform

- Entity names are Arabic data in a single `name` column (no `name_ar`/`name_fr`).
- Columns natively collated `ar-x-icu`; default collation sorts by codepoint, wrongly.
- Chrome Arabic-only at launch; every string through an i18n key; hardcoded text prohibited.
- Search normalizes query and stored value identically: strips diacritics and tatweel, folds أإآ→ا, ة→ه, ى→ي, Latin accents.

> [Internationalization](../architecture/internationalization.md)

**Related:** [Business rules](../reference/business-rules.md), [Technical design](../reference/technical-design.md), [Decision log](../reference/decision-log.md)
