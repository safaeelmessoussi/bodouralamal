[Documentation](README.md) › **SRS Proposal — Revision 111**

# SRS Proposal — Revision 111

**A person may delete their account. Deleting a login does not delete the
institution's record of what happened.**

**Status:** **PROPOSED — awaiting the Document Owner. DESIGN ONLY; no schema, no
migration and no code accompanies this document.** TASKS.md item 13 is explicit
that the thirty-five relationships are classified *before* anything is built,
and OD-06 is explicit that there is **no blanket retention decision** to lean on.

---

## 1 · What was measured, not assumed

Thirty-five foreign keys reference `"user"`. They were enumerated from the live
database rather than from the schema file, because a `RESTRICT` that exists only
in Prisma's model would not be the thing that refuses at runtime:

```sql
SELECT tc.table_name, kcu.column_name, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu USING (constraint_name)
  JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
  JOIN information_schema.referential_constraints rc USING (constraint_name)
 WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'user';
```

Thirty-two are `RESTRICT`, one is `NO ACTION` (`exam_staff.user_id`) and three
are `CASCADE` (`rate_limit_counter`, `refresh_session`, `refresh_token`). **The
three cascades are exactly the three rows that carry no institutional meaning**,
which is a good sign: the schema already encodes the distinction this proposal
makes normative.

## 2 · The finding that decides the design

Of the thirty-five, **twenty-six must survive the account** — grades, Quran
progress, enrolment, consent, safeguarding applications, guardianship, staffing
history and audit. Only nine may go.

A row cannot be deleted while twenty-six live references point at it, and
`CASCADE` is forbidden in terms. Nulling twenty-six columns would destroy the
very link that makes the surviving record meaningful: *«a grade with no student»*
is not a preserved record, it is a corrupted one.

> **Therefore: account deletion is the DE-IDENTIFICATION of a `user` row that
> continues to exist, not the removal of that row.**

This is the whole proposal. Everything below follows from it, and it is why the
five categories the Owner named collapse onto **the columns of `user` itself**
plus a small set of satellite tables — rather than onto thirty-five separate
deletion decisions.

The vocabulary this document uses:

| | meaning |
|---|---|
| **DELETE** | the row is removed; it carries no institutional meaning |
| **ANONYMIZE** | the row stays; the identifying columns on `user` are cleared |
| **PRESERVE** | the row stays and keeps pointing at the tombstone, unchanged |
| **BLOCK** | deletion is refused, with the reason, until a person acts |

## 3 · The classification, all thirty-five

### 3.1 · DELETE — credentials and planning data (9)

| relationship | why |
|---|---|
| `refresh_session.user_id` | live sessions. Already `CASCADE`, and **R102's revocation mechanism is reused**: the account is unreachable the instant deletion is requested, not three days later |
| `refresh_token.user_id` | as above |
| `rate_limit_counter.user_id` | infrastructure counter; no meaning outside the hour it covers |
| `user_identity.user_id` | the Google binding. **Deleting it is what makes OD-07 work**: after purge a genuinely new registration is possible, because nothing still claims the identity |
| `notification.user_id` | messages addressed to a person who no longer has an inbox. Not evidence — the *events* they announce are recorded elsewhere and survive |
| `user_branch_role.user_id` | a role assignment is a live grant, not a history. It must not survive an account, and TD-2 already treats its absence as *reaches nothing* |
| `teacher_availability.user_id` | **R88.2: planning data that grants nothing.** It informs an assignment that has not been made |
| `teacher_subject_capability.user_id` | as above — *«I can teach Quran»* is a statement about the future |
| `teacher_category_capability.user_id` | as above |
| `student_social_profile.student_id` | the beneficiary's own personal detail; no institutional purpose survives her |

### 3.2 · PRESERVE — the institutional record (22)

These keep pointing at the tombstone and are **not** rewritten. Grouped by what
would be lost:

**Educational record.** `enrollment.student_id` · `grade.student_id` ·
`student_exam_submission.student_id` · `student_surah_progress.student_id` ·
`quran_progress_log.student_id` · `quran_progress_log.logged_by` ·
`student_teaching_group.student_id`

*Deleting these would delete the institution's record of what it taught and what
was achieved.* `logged_by` is preserved for the same reason as the entry itself:
a progress record whose author vanished is not verifiable.

**Safeguarding and consent — preserved and NOT anonymized beyond the tombstone.**
`consent_record.student_id` · `consent_record.granted_by_user_id` ·
`consent_record.revoked_by_user_id` · `child_application.child_user_id` ·
`child_application.parent_id` · `child_application.decided_by` ·
`child_application.matched_existing_user_id` · `family_link.parent_id` ·
`family_link.student_id`

*These answer «who consented to what, and who decided».* OD-06 is explicit that
safeguarding, consent and audit evidence are **not physically deleted merely
because an account is**. A consent record that cannot say who granted it is not
evidence of anything.

**Accountability.** `audit_log.actor_user_id` · `trash.deleted_by` ·
`user.deleted_by` · `session_recording.started_by` ·
`session_recording.stopped_by`

*An audit trail that loses its actor stops being an audit trail.*

**Delivery history.** `session_staff.user_id` (past occurrences) ·
`event_staff.user_id` (past) · `exam_staff.user_id` (past)

*R43.4 and R91 already require that staffing changes do not rewrite history:
past occurrences stay owned by whoever actually delivered them.* Account deletion
is a staffing change like any other and gets no exemption.

### 3.3 · BLOCK — live responsibility (4, overlapping 3.2)

**Deletion is refused, naming what must be reassigned first.**

| relationship | the refusal |
|---|---|
| `course_schedule_staff.user_id` | she is the teacher of a live recurring class. Deleting her leaves a class nobody teaches |
| `session_staff.user_id` **for future occurrences only** | past ones are preserved history (3.2); future ones are an unstaffed class |
| `event_staff.user_id` where `position = 'responsible'` | **the tension TASKS.md names.** R109's `hidden` tier resolves to *the responsible person + Super Admin*, so a deleted responsible principal would leave a hidden item **visible to nobody at all** — it would not merely lose an owner, it would disappear |
| `exam_staff.user_id` for a future exam | as above |

The same relationship therefore appears in two categories, split by **time**, and
that is deliberate: it is the one dimension that distinguishes *a record of what
happened* from *an unfilled obligation*.

## 4 · What the tombstone is

The `user` row survives with its structural columns intact and its identifying
columns cleared. Structural, and why each must stay:

- **`id`** — twenty-two relationships point at it
- **`sex`** — §4.4b's Level restrictions are evaluated against it; a preserved
  enrolment must still make sense
- **`account_status`** — a new terminal value (§6) is what makes the state
  legible everywhere `assertFreshActive` already fails closed
- **`created_at`** — the record's own age

Cleared: `name_arabic` (replaced by a non-identifying marker), `nickname`,
`email`, `phone`, `phone_secondary`, `date_of_birth`, and anything else §4.1
collects about the person rather than about the record.

**`normalized_email_lock` is released.** It exists to stop two accounts claiming
one address; holding it against a purged account would silently refuse a genuine
new registration, which OD-07 permits.

## 5 · The window, and why it must not touch the existing one

TASKS.md is explicit and this proposal does not disturb it:

- **Trash stays at `PURGE_WINDOW_DAYS = 90`.** Unchanged.
- **A self-deleted account is 3 days.** A *second, shorter window for one entity
  type*, not a change to the first.
- **Automatic quarantine destruction stays an open Owner decision (R59.4)** and
  is **not** authorised by anything here.

Because the two windows differ, **Trash must show which one a row is on.** A
Super Admin looking at a 3-day account and a 90-day record cannot be left to
infer the difference from the entity type.

The purge itself is a **pg-boss job modelled on `content.quarantine-purge`** —
durable, idempotent and retryable — because de-identification that half-ran is
worse than one that has not run: it must be safe to execute twice.

During the three days the account is recoverable, and **OD-07 governs**:
restoration restores *that* account. No new account may claim the identity while
the old one can still come back.

## 6 · What this proposal deliberately does not decide

- **The retention period for the preserved records themselves.** OD-06 says there
  is no established legal rule yet. This proposal keeps them; it does not claim
  they are kept forever.
- **Whether a مؤطِّرة may self-delete at all**, as distinct from a beneficiary. §3.3
  gives her operational responsibilities a beneficiary does not have, and the
  BLOCK category may in practice mean *an administrator does this, not she*.
- **The wording shown to the person.** It must say plainly that the educational
  and safeguarding record survives — an interface promising deletion while §4
  retains the record would be the one genuinely unacceptable outcome.

## 7 · Questions for the Document Owner

1. **Does a مؤطِّرة get self-service deletion, or only a beneficiary?** (§6.2)
2. **May an administrator delete on someone's behalf**, and does that use the
   same 3-day window or take effect at once?
3. **Is a marker such as «حساب محذوف» the right tombstone name**, given it will
   appear on a preserved grade or attendance row a مؤطِّرة can still read?
4. **Should BLOCK refuse, or offer to reassign in the same action?** Refusing is
   simpler and safer; offering is kinder to an administrator who will otherwise
   visit several screens.

---

*No implementation accompanies this document. Nothing in `docs/SRS.md` has been
edited — that is the Document Owner's.*
