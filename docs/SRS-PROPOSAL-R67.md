[Documentation](README.md) › **SRS proposal — Revision 67**

# Draft SRS Revision 67 — a child's branch and stage are the CHILD's

**Status: authorised by the Document Owner (2026-08-12)** — *"المقر المطلوب and
الفئة must be per child, not shared by the whole registration request. This
applies to both the initial registration form and حسابي → تسجيل ابن/ابنة. A
single request must support different children requesting different categories
and different branches."*

---

## 67.1 — The storage is already right; three places are not

**`child_application` has carried `requested_category_id` since R62 and
`requested_branch_id` since R64.2, per row.** Approval already decides one child
at a time and already reads that child's own values. **No migration.**

Three places treat them as request-level and are the whole defect:

| Place | What it does today |
|---|---|
| `parentChildRegistrationSchema` | one `branch_id` and one `category_id` for the entire request |
| `registration.service.ts` | copies both onto every child application |
| `/profile/register-child` | collects one of each per submission |

So a parent registering one child for **الطفل at تاركة** and another for
**اليافعون at أمرشيش** cannot express it, though the rows could hold it. R62's
*"one stage for the family, chosen once"* and R64.2's *"the family's chosen
branch is copied onto each application"* are the clauses that said so, and both
are amended here.

## 67.2 — Each child carries its own

`childCore` gains **`requested_branch_id`** and **`requested_category_id`**, both
**required**. Required rather than optional because they were always required —
the family-level fields were, and moving a mandatory question does not make it
answerable by silence. An approver reading a request must know, for **each**
child, what was asked for; §4.1 step 1 preselects a Level from the Category, and
Revision 39 makes the branch what the queue filters on.

**They remain requests, never placements** (Revision 39's rule, unchanged):
nothing reads either to choose, validate or refuse. The approver may place any
child anywhere, which R66.5 made expressible in both shapes.

## 67.3 — The parent's own branch is DERIVED, not asked twice

Revision 39 puts `intended_branch_id` on the applicant's `User` row — *"the
branch the applicant asked for"*. On the parent+child path the applicant is a
**parent**, not a student: they enrol in nothing, and the branch they are
associated with is wherever their children go.

Asking them separately would put a **request-level branch back on the very form
this revision removes it from**, and produce two answers that must agree or
confuse. So on the parent+child path `intended_branch_id` is **taken from the
first child's requested branch** and the form asks once, per child.

**Nothing downstream changes.** The column keeps its meaning and its type, the
§14.2 queue filter still reads it for the registration item, and a family whose
children are spread across branches is filed under the first — which is a
reasonable answer to *where did this parent apply*, and the only one that does
not invent a value.

**The adult path is untouched.** `branch_id` and `category_id` stay top-level
there, because the applicant **is** the student and the fields describe them.

## 67.4 — What does not change

* **The model, the schema and the approval flow.** No migration, no new entity.
* **`POST /child-applications` already accepted both per child** (R64) — the
  personal page simply never collected them per child. Its contract is unchanged.
* **One shape, both flows.** The shared `ChildFields` component gains the two
  controls, so `/register` and `/profile/register-child` cannot diverge again —
  which is the failure R64 and R65 were each written to repair.
* **BR-1, R62.3b, R62.7** — the per-child media release and schooling stage are
  unchanged; this revision simply puts two more genuinely per-child fields
  beside them.

## 67.5 — Audit against the live architecture

| Claim | Status |
|---|---|
| `child_application.requested_category_id` exists per row | **[CODE]** `schema.prisma` (R62) |
| `child_application.requested_branch_id` exists per row | **[CODE]** `schema.prisma` (R64) |
| `decideChildApplication` reads that child's own values | **[CODE]** `child-application.service.ts` |
| The registration service copies the family values onto every child | **[CODE]** `registration.service.ts` |
| `POST /child-applications` already accepts both per child | **[CODE]** `child-application.controller.ts` |
| The queue filters registrations by `intended_branch_id` | **[CODE]** `approval.service.ts`; **[SRS]** §14.2, R39 |
| The child section is one shared component | **[CODE]** `components/registration/children.tsx` (R65) |

**No migration. No authorization change. No new endpoint.**
