[Documentation](README.md) › **SRS Proposal — Revision 110**

# SRS Proposal — Revision 110

**The scheduling-type catalogue is seeded reference data an administrator
manages, and an activity records which type it is.**

**Status:** **PROPOSED — awaiting the Document Owner.** The catalogue's contents
are already ratified (Owner, 2026-08-26: the five rows with their order and
`حضور إجباري` column; OD-03 on عطلة). What is proposed here is the **normative
wording**, because `docs/SRS.md` is the Document Owner's to edit.

The implementation shipped with this proposal (NEW H). **It implements the
ratified decisions, not this text** — if the Owner's wording differs, the code
changes.

---

## 1 · This is R56's own clause, not a contradiction of it

R56 declined `Event.type`, and the reasoning was sound at the time:

> *§4.4(6) makes a cancellation an edit to a **Session** row rather than a
> parallel Event mechanism and BR-17 keeps non-teaching activity out of the
> timetable, so a holiday suppresses no class and the category would **drive no
> rule, job or report**.*

It then named the condition for reversing itself, in terms:

> *It may be added when filtering or reporting by category becomes a real
> requirement.*

**`attendance_required` is that requirement.** OD-03 makes it drive the form —
*"attendance-specific controls are not presented when the chosen type does not
require attendance … which is why it is a stored column and not display text."*
A type now drives a rule, so R56's condition is met and **no supersession is
proposed for it**. Its other half stands untouched: **a holiday still cancels no
class.**

What R56 could not have anticipated is the second half of the problem. Its type
selector offered **three** options because the frontend registry had three
entries — and those three are the *entities*. An administrator does not think
*«I am creating an Event»*; she thinks *«I am scheduling a حفل»*, and حفل, محاضرة
and عطلة were indistinguishable, because the only place the difference lived was
whatever she typed in the title.

## 2 · The proposed revision

> **Revision 110 (Document Owner decision — the scheduling-type catalogue is
> managed reference data, 2026-08-26):**
>
> **(1) `SchedulingType` is a reference entity** (§7) carrying `name`,
> `structural_kind`, `attendance_required`, `display_order` and TD-15's
> `version`, soft-deleted under TD-5. It is **seeded, not hardcoded**: the seed
> establishes the initial state and is never a whitelist, so a subsequent run
> preserves every rename, reorder, re-flag and addition the Owner has made.
>
> **(2) The initial catalogue is five rows:**
>
> | # | اسم النشاط | حضور إجباري | `structural_kind` |
> |---|---|---|---|
> | 1 | حصة دراسية | نعم | `class` |
> | 2 | اختبار | نعم | `exam` |
> | 3 | محاضرة | لا | `activity` |
> | 4 | حفل | لا | `activity` |
> | 5 | عطلة | لا | `activity` |
>
> **(3) Five types, THREE entities — and no fifth scheduling model.** R56's
> routing is stored rather than re-decided: `class` → `RecurringCourseSchedule`,
> `activity` → `Event`, `exam` → `Exam`. **`structural_kind` is data on the row
> and is never inferred from the Arabic name** — §4.4b already requires rules to
> be *"checked generically … rather than hardcoded against a level name"*, and a
> catalogue whose behaviour depended on its label could never be renamed. It is
> **fixed after creation**: changing it would re-point every activity recorded
> against the row at a model that cannot represent them, exactly as §4.4 freezes
> a course schedule's subject and target.
>
> **(4) `attendance_required` is structural data, and it drives the form**
> (OD-03). Attendance-specific controls are presented **only** where it is true.
> It is not derivable from the name — اختبار takes attendance and محاضرة does
> not, and nothing about either word says so.
>
> **(5) `Event.scheduling_type_id`** records which type an activity is.
> **Nullable in the schema and required at the write boundary**, which is §7's
> standing division (R35): R56 told administrators to write عطلة in the title, so
> every activity created before this revision records its type nowhere a query
> can reach, and inferring one from that title is the name-matching §4.4b
> forbids. The foreign key is `ON DELETE RESTRICT` and deletion of a type is
> refused while any activity names it: a retired type must stay resolvable by the
> activities that used it, or tidying the catalogue destroys the record of what
> an activity WAS.
>
> **(6) عطلة is an ordinary schedulable activity** (OD-03) with
> `attendance_required = false`, shown on the calendar like any other. **It is
> not a suppression mechanism**: BR-17 keeps non-teaching activity out of the
> timetable and §4.4(6) makes a cancellation an edit to a Session row, so a
> holiday cancels no class. R56's finding is preserved, not reversed.
>
> **(7) Authorization.** **Reading is any staff member who may schedule** —
> Admin, Super Admin and a مؤطِّرة (R93/R94), because a picker that refused her
> would be a form she cannot open. **Writing is Super Admin only** (OD-01's final
> sub-decision: scheduling types stay undelegated until an Owner decision says
> otherwise), which is also what keeps R105's الإدارة heading a fact about
> permission. §14.1 gains one node, **أنواع الجدولة**, inside الإدارة — an
> addition the Owner asked for, not a reshuffle of the R105 order.

## 3 · What is NOT proposed

* **No fifth scheduling entity.** The three that route differently are the three
  that mean something (R56), and that finding is preserved.
* **No change to §4.4(6) or BR-17.** A holiday still cancels no class.
* **No attendance feature.** Attendance remains post-MVP (§4.4). This revision
  records *which types take it* and gives the form the seam to present it; the
  controls themselves arrive with the feature.
* **No `Event.type` free-text field.** The type is a foreign key to managed
  reference data, not a string an administrator retypes.

---

**Related:** [Calendar and Hijri](architecture/calendar-and-hijri.md),
[SRS Proposal R56](SRS-PROPOSAL-R56.md), [`SRS.md`](SRS.md) §4.4, §7, §14.1
