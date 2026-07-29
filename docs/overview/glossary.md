[Documentation](../README.md) › [Overview](README.md) › **Glossary**

# Glossary

## Domain vocabulary

| Term | Arabic | Meaning |
|---|---|---|
| **Association** | الجمعية | جمعية بذور الأمل, the operating nonprofit |
| **Branch** | فرع | A physical location running sessions. Carries an operational start date before which its calendar is greyed out |
| **Category** | الفئة | One of three **generic educational stages**: Adult (الكبار), Teen (اليافعون), Child (الطفل). **Sex is never encoded in a category name** — it lives on the level |
| **Level** | مستوى بالجمعية | An academic tier within a category. Numbering is **not uniform** across categories — no logic may assume every category has a level 0 |
| **Group** | مجموعة | A cohort within a level with its own fixed weekly time, room, and instructor(s). **The scheduling unit** |
| **Event** | حدث | A one-off or exception calendar item — holiday, activity, exam — layered on top of groups' fixed schedules |
| **Round** | الدورة | A grading period, roughly a semester. Manually selected, not calendar-bound; a sorting label, not a restriction |
| **Instructor** | مؤطِّرة | A teacher. Scoped to assigned groups |
| **Subject** | — | A non-Quran curriculum item (Tafsir, Fiqh, literacy). **The Quran is never a Subject** — memorization has its own tracking engine |
| **Committee** | لجنة | A cross-cutting organisational tag. Postponed to post-MVP; its tables are not pre-created |
| **Follow-up** | — | The informal process of an Admin noticing a student's dropping engagement and checking in. **Not an automated system action** |
| **Global / no branch** | بدون فرع | Content or events mapped to no specific branch, appearing across all of them. Restricted to Admins |

## Platform vocabulary

| Term | Meaning |
|---|---|
| **Consent record** | An auditable row capturing one consent grant or revocation, including the exact text version agreed to. Never a boolean column |
| **Active child context** | The linked minor a parent is currently acting for, asserted per request via the `X-Active-Child-ID` header and verified server-side |
| **Basis points (bp)** | The grading unit. 10,000 bp = 100 %; 3,333 bp = 33.33 %. All scoring is integer bp — no floats anywhere |
| **Pre-provisioned account** | An account created by staff against someone's Google address, before that person has ever logged in. The address binds to an identity on first login |
| **Soft delete** | Marking a row deleted rather than removing it, with a full JSON snapshot kept for 90 days |
| **Trash** | The snapshot store used for **restoration**. Distinct from the audit log, which is for **accountability** |
| **Reference data** | Branches, rooms, levels, categories, subjects, academic year, settings, the Hijri calendar. **Super Admin writes only** |
| **Operational data** | Users, approvals, groups, enrolments, progress, exams, content, events. **Admin-managed within branch scope** |
| **Occurrence** | One rendered instance of a group's weekly slot or an event, as returned by the calendar |
| **Public display name** | An optional name a person chooses to publish (a kunya, for instance) instead of their legal name. **Always resolved by the backend** |

## Identifier scheme

The specification is cross-referenced by stable identifiers. Code comments, commit
messages, and every document here cite them, so any behaviour traces back to the clause
requiring it.

| Form | Means | Where |
|---|---|---|
| `§4.3` | A numbered section of the SRS | [`SRS.md`](../SRS.md) |
| `BR-x` | **Business rule** — a domain invariant stated without reference to any technology | SRS §12 · [index](../reference/business-rules.md) |
| `TD-x` | **Technical design constraint** — state machines, permissions, contracts, transactions | SRS §13 · [index](../reference/technical-design.md) |
| `R31`, "Revision 31" | A numbered specification revision, with its rationale | SRS §0 · [decision log](../reference/decision-log.md) |
| `J1`…`J8` | An end-to-end user journey | SRS §17 · [journeys](user-journeys.md) |
| `M0`…`M8` | A delivery milestone | [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) |
| `R-1`…`R-10` | An open risk | SRS §11 · [risks](scope-and-roadmap.md#open-risks) |
| `T1`…`T12` | A token-lifecycle acceptance criterion | SRS §18 |

**Precedence.** Where any section appears to conflict with a business rule, **the business
rule wins, and the conflict must be reported** rather than silently resolved. Business rules
are stated technology-independently precisely so they survive any future re-platforming.

## Technical terms used in a specific way here

| Term | In this project |
|---|---|
| **Wall-clock time** | A time value with no timezone attached — 17:00 means 17:00 on the local clock, whatever the UTC offset is that week. Used for all group and event times, because Morocco suspends DST during Ramadan |
| **Optimistic locking** | Every edit sends back the version it loaded; the update is conditional on that version. A stale version gets `409 VERSION_CONFLICT`, never a silent overwrite |
| **Freshness assertion** | Re-reading the caller's account status from the database on a high-risk request rather than trusting an unexpired token |
| **Expand–migrate–contract** | The three-phase pattern required for any destructive schema change: add alongside, backfill and switch, drop in a **later** migration |
| **Existence leak** | Any response that reveals whether a record exists to someone not entitled to know. Prevented by returning `404` for both "missing" and "out of scope" |
| **Self-healing cache** | A cached aggregate that carries a stamp of the newest input it saw; readers detect a mismatch and repair the row in place before using it |
| **Composite document** | A single response bundling several bounded reference lists. Explicitly **not** a list endpoint, so pagination does not apply |

## Arabic in the platform

- **Entity names are Arabic data**, stored in a single `name` column — no `name_ar`/`name_fr`
  split, which is what removes bilingual drift.
- Those columns are **natively collated `ar-x-icu`** in the database, so sorting is correct
  by default. Default collation sorts Arabic by codepoint and produces orderings that look
  wrong to every user.
- **Interface chrome is Arabic-only at launch**, but every string flows through an i18n key
  from day one — hardcoded text is prohibited.
- Search **normalizes both the query and the stored value** identically: strips diacritics
  and tatweel, folds alef variants (أإآ→ا), ة→ه, ى→ي, and Latin accents.

> [Internationalization](../architecture/internationalization.md)

---

**Related:** [Business rules](../reference/business-rules.md),
[Technical design](../reference/technical-design.md), [Decision log](../reference/decision-log.md)
