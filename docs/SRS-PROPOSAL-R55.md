[Documentation](README.md) › **SRS proposal — Revision 55**

# Draft SRS Revision 55 — dependent selection, split taxonomy nodes, and the recurrence bound

> **Status: APPLIED to `docs/SRS.md` on 2026-08-06**, on the Document Owner's instructions.
> Four separate changes travel together because three of them are §14 sitemap/table amendments
> and the fourth is the contract they revealed.
>
> Retained for the rationale — particularly **the curriculum inconsistency found while
> implementing**, which is a defect the specification did not cause and could not have caught.

---

## 1. The defect that motivated all of it

The Owner reported that uploading content returned `SUBJECT_NOT_AT_LEVEL` and asked for the root
cause rather than a workaround. It was not one bug but three, in a row:

**(a) The interface offered combinations the domain does not contain.** Every selector on every
screen was independent — all 21 Levels, all 3 Subjects, any pair — while a Subject reaches a
Level only through `LevelSubject` (§4.4b, R43).

**(b) One rule, enforced on two surfaces out of three, under two names.**

| Surface | Before |
|---|---|
| `teaching-group.service.ts` | refused, `SUBJECT_NOT_IN_LEVEL` |
| `content.service.ts` | refused, `SUBJECT_NOT_AT_LEVEL` — *a second spelling of one rule* |
| **`course-schedule.service.ts`** | **did not check at all** |

**(c) The live database proved it.** Three Course Schedules existed while `level_subject` held
**zero rows** — classes delivering Subjects their Levels officially do not teach, and to which
no content could then be attached. The platform was internally inconsistent, and the screen that
enforced the rule looked like the broken one.

**This is a defect, not an SRS gap.** §4.4b defines `LevelSubject` as what a Level teaches and
never says the rule is optional for scheduling. Fixed by extracting `policies/curriculum.ts` —
one assertion, all three surfaces, the older reason code (`SUBJECT_NOT_IN_LEVEL`) kept because
clients render it.

## 2. Every selector is dependent (§14.4)

> **New normative paragraph.** A selector offers only values valid for the current selection;
> changing one refreshes those below it; a selection no longer offered is **cleared, not kept**.
> The interface must not be able to express a combination the server will refuse.

The last clause is the point. A stale id left in state is exactly what reaches the server as an
impossible pair, so clearing is what makes the guarantee real rather than aspirational.

**Implemented as one module** (`hooks/use-scope-options.ts`), because six screens ask
overlapping versions of the same question and six copies of *"when the Level changes, reload the
Subjects and clear the stale one"* is the duplication that drifts — the copy that forgets to
clear still passes its own tests.

**Academic Year is deliberately not chained.** The platform's years are global (§4.10);
inventing a dependency to make the set look uniform would be a lie about the model.

## 3. `الفئات` and `المواد` are two navigation nodes

§14.1 listed one node, *Categories & Subjects → `/admin/taxonomy`*. It becomes two:
`/admin/categories` and `/admin/subjects`.

**The implementation stays single.** A Category and a Subject are the same *kind* of record — a
name, an optional order, Super-Admin-writable, refused deletion while referenced — so the entity
is a parameter and the screen is written once. Separating the navigation must not separate the
code.

## 4. The Users table gains `email`

§14.2 lists this table's columns as *Arabic name, Nickname, Role(s), Branch scope, Status,
Phone*. Two changes:

* **`email` is added** — the identifier an administrator recognises a person by, and the one
  they are handed when somebody reports a problem. Sourced as TD-10 already specifies for
  search: the bound `UserIdentity.email`, or `pre_provisioned_email` for an account not yet
  claimed (R15). `null` for a minor student is **a fact, not a gap** (§4.3).
* **`Branch scope` was already required by §14.2 and was missing.** Restored; the data was on
  every row already.

**Not a display identity.** §20 rule 21 governs the name shown to the *public*; this is an
administrative identifier on a staff-only screen (TD-2), and `check-display-identity.sh`
continues to pass unchanged.

## 5. `effective_until` reaches the contract

R50 added the column and **no contract exposed it**: it could only be set as a side effect of
*splitting* a schedule, so a class that runs for one term had no way to say so — while an Event,
the other half of the same scheduling module, has carried a recurrence end since it shipped.

`anchor_date` was already on the create contract and the **form never asked for it**, so a
`biweekly_alternating` class could not say which fortnight was *on* — §7's own words: *"without
an anchor, 'week on' is undefined and the two halves of the alternation are indistinguishable."*

Both now appear in the shared recurrence editor, in the same place and with the same words as
the Events form.

## Exact wording applied

### §0

> **Revision 55 (Document Owner decisions — dependent selection, split taxonomy nodes, Users
> columns, recurrence bounds, 2026-08-06):** **(1) Every selector in the platform is dependent**
> (§14.4): it offers only values valid for the current selection, changing one refreshes those
> below it, and a selection no longer offered is **cleared rather than kept** — the interface
> must not be able to express a combination the server will refuse. Academic Year is exempt
> because the platform's years are global (§4.10). **(2) §14.1's single *Categories & Subjects*
> node becomes two**, `/admin/categories` and `/admin/subjects`; the implementation stays single.
> **(3) §14.2's Users table gains `email`** — the bound identity address or the pre-provisioned
> one (R15), `null` for a login-less minor — and its already-specified **Branch scope** column,
> which was missing. **(4) `effective_until` (R50) and `anchor_date` join the course-schedule
> write contract**: the column existed and could only be set by splitting a schedule, so a class
> running for one term could not be described as such, while an Event has always had a
> recurrence end. **Recorded as a defect fixed rather than a decision taken:** `LevelSubject`
> (§4.4b) was enforced by teaching-group splits and content but **not by scheduling**, under two
> different reason codes — the live database held schedules whose Levels taught nothing. One
> policy now governs all three, raising `SUBJECT_NOT_IN_LEVEL`.

### TD-3.12 — two optional fields on `POST /admin/course-schedules`

> ```
> anchor_date      (optional) — starts the series; for biweekly_alternating it fixes WHICH
>                               fortnight is "on" (§7)
> effective_until  (optional) — R50's bound, on the contract since R55. Null is open-ended
> ```

### §14.1 / §14.2

> Replace *Categories & Subjects → `/admin/taxonomy`* with the two nodes above, and add `Email`
> to the Users table's column list.
