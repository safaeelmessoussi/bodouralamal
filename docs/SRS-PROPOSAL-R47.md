[Documentation](README.md) › **SRS proposal — Revision 47**

# Draft SRS Revision 47 — curriculum taxonomy CRUD in TD-3

> **Status: PROPOSED. Not in force.** `docs/SRS.md` is immutable to implementing
> agents; this is drafted wording for the **Document Owner** to apply, amend or reject.
> **Delete it once decided.**
>
> **The endpoints are already implemented and shipped** (2026-08-05) on the Owner's
> instruction to complete the Admin portal — *"only add backend endpoints if a genuine
> capability is missing"*. This proposal records the wording; the code is not waiting on it.

---

## The audit that preceded it

The Owner's instruction was explicit: **do not assume each remaining admin module needs new
endpoints; audit the existing backend and reuse first.** That audit is what this revision
rests on, and it is worth recording because most of it came back *reuse*:

| Module | Existing contract | Verdict |
|---|---|---|
| Branches & Rooms | All eight routes exist and are tested | **Reuse.** Frontend only |
| Subject Organisation (تنظيم المادة) | `GET/POST .../teaching-groups`, `PATCH/DELETE /admin/teaching-groups/{id}`, members | **Reuse.** Frontend only |
| Level ↔ Subject assignment | `GET/PUT/DELETE /admin/levels/{levelId}/subjects[/{subjectId}]` (R46) | **Reuse.** Frontend only |
| Subject **list** | `GET /admin/subjects` (R46) | **Reuse** — extended by one field rather than duplicated |
| Categories | Nothing. `/calendar/bootstrap` returns them publicly, cached, without `version` | **New** |
| Subject **writes** | Nothing | **New** |
| Levels | `createLevel` **existed in the service layer** (TD-4.6b) with no route at all; nothing could list, edit or delete | **New routes; the create transaction was already specified** |

The Level case is the clearest: `level.service.ts` implemented TD-4.6b's transaction and its
own docstring said *"Not built here: the `/admin/levels` endpoints — the route arrives with
TD-3's registry work."* This is that work.

## Why these are documented rather than invented

The **Revision 21 pattern**: §5.6 names the back-office screens *"Levels"* and *"Categories &
Subjects"*, §14.1 lists مستويات and الفئات والمواد as navigation nodes, and §14.2 defines the
screen standard every list screen implements. A screen the SRS mandates cannot be built
without the endpoints its own standard requires. That is exactly the reasoning that admitted
the Branch and Room routes, which TD-3 also never enumerated.

## What was added

```
GET    /admin/categories        → [{ id, name, display_order, level_count, version }]   Admin+
POST   /admin/categories                                                                Super Admin
PATCH  /admin/categories/{id}                                                           Super Admin
DELETE /admin/categories/{id}                                                           Super Admin

POST   /admin/subjects                                                                  Super Admin
PATCH  /admin/subjects/{id}                                                             Super Admin
DELETE /admin/subjects/{id}                                                             Super Admin

GET    /admin/levels[?category_id=]                                                     Admin+
POST   /admin/levels                                                                    Super Admin
PATCH  /admin/levels/{id}                                                               Super Admin
DELETE /admin/levels/{id}                                                               Super Admin
```

**TD-2 unchanged.** Revision 26 already says Admins *read* reference data and Super Admins
write it; Revision 30 already excludes Teachers. These follow both.

### One extension to an existing contract, not a second list

`GET /admin/subjects` now carries **`version`**. When Subject gained create/edit/delete, the
الفئات والمواد screen needed the TD-15 version to send back on an edit. Publishing it on the
existing selector let that screen reuse the endpoint; the alternative was a parallel `GET` over
the same table with a wider projection — **two reads of one concept, kept in step by hand**.

This is a **narrowing of R46's wording**, which said the selector carries no `version` because
"the endpoint has no write". That premise no longer holds, and §0 should record the change
rather than leave two sentences disagreeing.

### Alternatives rejected

| Rejected | Why |
|---|---|
| **Widen `/calendar/bootstrap`** for Categories and Levels | Its contract is *the public calendar screen's* reference data, cached, and an editor needs `version` and usage counts a public payload must not carry. The same reasoning R46 recorded |
| **A `category_id` field on `PATCH /admin/levels/{id}`** | Moving a Level between Categories re-files every enrolled student into a different educational stage, and §2.2 scopes `display_order` *within* the Category, so the ordering would stop meaning anything. The field is **refused**, not dropped: dropping it silently would let a client receive `200` and believe the move succeeded |
| **Blocking Level deletion on its Administrative Groups** | TD-4.6b guarantees every Level owns at least one, so the guard would make deletion **unreachable by construction** |
| **Cascading a Category's Levels** | A Level carries enrolments, groups and schedules. Cascading would delete a live curriculum from a control labelled *delete category* |

## The one genuinely new rule: how a Level is deleted

TD-5 says deletion is prohibited while references exist, but TD-4.6b creates a reference —
المجموعة 1 — as part of the Level's own creation. The two rules meet here and the SRS does not
say what happens.

**Proposed:** a Level's Administrative Groups are **removed with it, not counted against it**,
after the guards have established that none of them holds an enrolment, a schedule or a grade.
What remains is the empty scaffolding the Level's creation put there, and the audit row names
the cascaded ids because those groups disappeared as a consequence of this decision.

This is the exact inverse of TD-4.6b and belongs beside it.

## Exact wording to apply

### 1. New entry in §0

> **Revision 47 (Document Owner decision — curriculum taxonomy CRUD is part of TD-3,
> 2026-08-05):** the §5.6 *"Levels"* and *"Categories & Subjects"* screens and the §14.1
> مستويات and الفئات والمواد nodes could not be built: TD-3 documented **no way to create,
> edit, delete or even list a Category or a Level**, and Subject had a selector but no writes.
> `level.service.ts` had implemented TD-4.6b's create transaction with no route to reach it.
> **Eleven operations join TD-3** — full CRUD for Categories and Levels, and create/edit/delete
> for Subjects — under the **Revision 21 pattern**: a screen the SRS mandates is itself the
> documentation for the endpoints its §14.2 screen standard requires. **TD-2 Revision 26 is
> unchanged and governs them**: Admins read, Super Admins write, Teachers are excluded
> (Revision 30).
>
> **Three normative consequences.** **(1)** `GET /admin/subjects` now carries `version`,
> narrowing Revision 46's statement that it carries none — that premise rested on the endpoint
> having no write, which is no longer true. One list serves the selector and the editor; a
> second read over the same table would be a copy kept in step by hand. **(2)** A Level's
> `category_id` is **immutable after creation** and `PATCH /admin/levels/{id}` **refuses** the
> field rather than ignoring it, because a move would silently re-file every enrolled student
> into a different educational stage and §2.2 scopes `display_order` within the Category.
> **(3)** Deleting a Level **soft-deletes its Administrative Groups with it** — the inverse of
> TD-4.6b. Since that revision guarantees every Level owns at least one group, a guard counting
> groups would make deletion unreachable by construction; the enrolment, Teaching Group,
> schedule, exam, content, Subject-assignment, grade and event guards run first, so the groups
> taken are provably empty, and the TD-8 row names their ids. **Deleting a Category never
> cascades its Levels**, for the opposite reason: a Level carries people's records.

### 2. TD-3 — new subsection after the reference-data selectors

> **TD-3.14 Curriculum taxonomy (Revision 47).** Categories, Subjects and Levels are the
> vocabulary every other educational endpoint names. Admin and above read; Super Admin writes
> (TD-2 R26); Teachers are excluded (R30). Lists are **unpaginated** — the sets are bounded by
> the curriculum, and a taxonomy screen with a hidden second page cannot answer *"does this
> already exist"*, which is the question it is opened to answer.
>
> * `GET /admin/categories` — with `level_count`, which says whether deletion is possible at
>   all without a request per row.
> * `POST` / `PATCH` / `DELETE /admin/categories[/{id}]` — TD-15 on the edit; TD-5 on the
>   delete, refused while Levels or Event scopes reference it.
> * `POST` / `PATCH` / `DELETE /admin/subjects[/{id}]` — TD-5 delete refused while Level
>   assignments, Teaching Groups, Course Schedules, Exams or Library content reference it.
> * `GET /admin/levels[?category_id=]` — ordered **by Category first**, since §7 scopes a
>   Level's `display_order` within its Category. Carries `group_count`, `subject_count` and
>   `enrollment_count`. No `branch_id`: a Level is Category-scoped and branch-independent
>   (§4.4b).
> * `POST /admin/levels` — **TD-4.6b**: the Level and its first Administrative Group commit
>   together. `branch_id` is **required and is not stored on the Level**; it says where
>   المجموعة 1 sits. The response reports the created group.
> * `PATCH /admin/levels/{id}` — `name`, `gender_restriction` and `display_order` only.
>   `category_id` is refused. Tightening `gender_restriction` **does not evict anyone already
>   enrolled**: the restriction gates admission (§4.4b), and retroactive removal is not a
>   decision this endpoint may take silently.
> * `DELETE /admin/levels/{id}` — TD-5, cascading its own empty groups as described in §0.

### 3. §5.6 — no change needed

The screens are already named there. This revision supplies the endpoints they always implied.

---

## What this proposal does **not** ask for

Nothing here blocks implementation, and nothing here is a new capability the Owner has not
already directed. If the Owner prefers different paths, different verbs, or judges any of the
three normative consequences wrong, the code changes to match — that is a small edit in one
service each, and the tests naming these behaviours are the list of what would move.
