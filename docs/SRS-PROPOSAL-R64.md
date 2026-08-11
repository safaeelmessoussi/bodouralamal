# SRS Proposal — Revision 64

**Status: authorised by the Document Owner (2026-08-11), who specified the
product behaviour and instructed that the implementation be audited and decided
here** — *"Remove ＋ تسجيل طفل from the role switcher entirely. Adding/registering
children should be done from the adult student's dashboard through a dedicated
page/flow. The initial registration flow … and the later 'add child' flow should
use the same appropriate child-registration fields and business rules … The
child-registration flow must include all fields actually required by the
institute's registration process, including المقر المطلوب, الفئة."*

---

## 64.1 — What the audit found

Three defects, one root cause: **R62 built the second child-registration path
without reconciling it against the first.**

| | `POST /registrations` (public) | `POST /child-applications` (signed in) |
|---|---|---|
| Branch requested | **yes** — on the parent's `User` row | **no field exists anywhere** |
| Category requested | **yes** — `requested_category_id` per child | accepted by the API, **never collected** by the UI |
| Where it lives | a form at `/register` | a dropdown item in the header |

So a parent adding a second child supplied strictly less than the same parent
supplied for their first, and an approver received a request naming no branch
and no stage — the two things §4.1 step 1 and Revision 39 exist to give them.

**`ChildApplication` has no branch column at all.** Revision 39 put
`intended_branch_id` on the applicant's `User` row and states it is *"written on
the applicant only, never copied onto the child"* — correct when a registration
always created a parent row, and a dead end when the parent already exists.

## 64.2 — `ChildApplication.requested_branch_id`

Added, nullable, `ON DELETE RESTRICT`, and **written by both submission paths**:
the public form copies the family's chosen branch onto each application, and the
new page collects it. Nullable because applications submitted before this
revision have no answer, and *not stated* is a real state (Revision 39's own
reading of a null branch).

**Revision 39 is not contradicted, it is completed.** `User.intended_branch_id`
remains *the applicant's own* request and is unchanged; this records *the
child's*, which previously had nowhere to go. A family that asks for one branch
now says so once per child, which is also what lets an approver place two
siblings at different branches — a case the single parent-level column could not
express.

**Consequences that fall out, all intended:**

* the §14.2 queue item for a `child-application` reports `branch { id, name }`
  instead of the `null` it has always sent, and the **branch filter reaches it**;
* `PlacementDialog`'s §4.1-step-1 preselection works for these items, because
  the request finally carries a Category.

**It is a request, never a placement** — identically to Revision 39. Nothing
reads it to choose, validate or refuse anything.

## 64.3 — `/dashboard/student/register-child` joins §14.1

The «＋ تسجيل طفل» action leaves the role switcher.

**A switcher lists the contexts you may work in; registering is a task.** The
action sat inside the `ولي الأمر` group, so an account with the role and no
approved children opened a menu containing one item that was not a context at
all — and the dialog it opened could only ever carry a subset of the fields the
public form collects, which is how the divergence in 64.1 was introduced.

The node is a child of `/dashboard/student`, alongside the `/grades`, `/quran`
and `/calendar` nodes §14.1 already lists there. It is reached from the
dashboard, and it is available to **any adult account** — a parent adding a
second child and an adult student registering one are the same act, which is why
`POST /child-applications` already accepts both (R62).

## 64.4 — `ولي الأمر` appears only once a child is approved

Stated because the switcher previously showed it always.

R62.9 grants the `parent` role **on the first approved child**, so an account
holding the role with no approved child is a state that cannot occur — except
transiently, if every link is later revoked. In that case the group would be an
empty menu, and **an entry that opens onto nothing is the same defect as a
button that renders a blank page** (§14.4).

## 64.5 — A child-registration request is never decided as a bundle

**Recorded because the queue offered it and the server answered `404`.**

R62.2 narrowed TD-4.2 to one child, so `POST /admin/approvals/{id}/approve` has
no meaning for these items: their queue id is a `request_id`, which names no
`User` and no `FamilyLink`, and both lookups missed. An administrator therefore
received `NOT_FOUND` for an item the queue had just rendered.

* The server now refuses that id **by name** — `VALIDATION_FAILED` with
  `reason: DECIDE_PER_CHILD` — instead of answering "no such item" about an item
  that plainly exists.
* Each child is decided through `POST /admin/child-applications/{id}/decide`,
  which R62 already registered.

**And approving a child now requires a placement.** §4.1 (R43) is unchanged by
R62 — *"an approved account with no enrollment is a person the platform admitted
and then lost"* — but R62's per-child path made `administrative_group_id`
optional, so the family route obeyed §4.1 and the per-child route did not. The
rule is restored: `ENROLLMENT_REQUIRED`, exactly as the registration path
answers. Linking an **existing** account stays exempt, since that student is
already placed.

## 64.6 — نوع التسجيل and الفئة: both are needed; one was mislabelled

The audit was asked whether these overlap. They do not, but the form said they
did.

* **نوع التسجيل** is *who is registering whom* — it selects the payload shape
  (§4.1b step 4c defines exactly two) and nothing else.
* **الفئة** is *which educational stage the STUDENT is admitted to* — R43's
  Category, which §4.1 step 1 preselects a Level from.

The overlap the Owner saw was **a label**: the first option read
*«تسجيل شخصي (الكبار)»*, naming a Category inside the field that is not about
Categories, while الفئة then offered الطفل to the same self-registering adult.
The parenthetical is removed and both hints now say which question is being
asked.

**What is NOT changed, and why it needs an Owner decision — see 64.7.**

## 64.7 — [OWNER DECISION REQUIRED] Nothing marks the adult Category

§2.1 and §4.1b are explicit: *"Adult students (the Adult stage, الكبار) hold
their own Google-authenticated accounts. Minor students (Teens/Children) do not
have separate logins."* So an adult self-registering **is** in الكبار, and a
child application is **never** in الكبار.

The form cannot enforce either, because **no field distinguishes the adult
Category from the other two.** Revision 27 made the three Categories *generic,
renameable, seeded* rows; matching on the name «الكبار» would hardcode reference
data the association may rename, which Revision 27 explicitly anticipates.

This revision therefore **does not filter the Category list**, and the gap is
recorded rather than papered over. Closing it needs a decision:

* **(a)** a structural marker on `Category` (for example `holds_own_login`), set
  by the Super Admin, which the two forms filter on — the platform learns which
  stage is the adult one instead of guessing;
* **(b)** leave it to the approver, who may re-place any applicant anyway, and
  accept that a self-registering adult can *request* الطفل;
* **(c)** something else the Owner has in mind.

**(a) is the recommendation** — it is one nullable boolean, it makes an existing
normative rule enforceable, and it keeps the Categories renameable. It is **not**
an age gate: it turns on *who holds the login*, which is §4.3's structural
definition of a minor, and never on a birth date or a schooling stage.

## 64.8 — Audit against the live architecture

| Claim | Status |
|---|---|
| `ChildApplication` has no branch column | **[CODE]** `schema.prisma` |
| The queue sends `branch: null` for these items | **[CODE]** `approval.service.ts` |
| The public form writes `requested_category_id` per child; the dialog does not | **[CODE]** `registration.service.ts` vs `child-application-dialog.tsx` |
| `decide()` looks the id up as a `User` then a `FamilyLink`, and neither matches a `request_id` | **[CODE]** `approval.service.ts` |
| `decideChildApplication` made the placement optional | **[CODE]** `child-application.service.ts` |
| Adults hold logins, minors do not | **[SRS]** §2.1 role table, §4.1b |
| Categories are renameable generic stages | **[SRS]** Revision 27, §15.1 |
| Nothing distinguishes the adult Category structurally | **[CODE]** `Category` carries `name`, `display_order`, `version` and nothing else |
