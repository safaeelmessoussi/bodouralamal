[Documentation](README.md) › **SRS Proposal — Revision 78**

# SRS Proposal — Revision 78

**Three reversals the Owner has asked for, each contradicting a clause that gave
its reasons.**

**Status:** **APPLIED** to `docs/SRS.md` on 2026-08-18, on the Document Owner's
explicit approval of all three decisions (*"I approve doing ALL currently open
items … including applying R78"*), and with the narrowed reading of R77.3
confirmed rather than a blanket reversal. This document is retained as the
decision record.

Raised because a 2026-08-18 instruction asks for three capabilities that the SRS
does not merely omit — it **refuses them in terms**, each with a stated reason.
Implementing any of them quietly would be a violation rather than an omission,
and the instruction itself says to stop on exactly this.

---

## 1 · What is being asked, and what stands against it

| Asked for | The clause in the way |
|---|---|
| Drag-and-drop ordering of **حلقات المواد** (`TeachingGroup`) | **R76.7** — five entities are orderable and *"`TeachingGroup` is **deliberately excluded**: it carries the column and no interface has ever set it, so ordering circles is not a decision anybody takes today, and adding the gesture would invent a workflow rather than expose one."* |
| Notifying a **teacher/assistant** that they have been assigned | **R77.3** — *"**Only enrolled students are notified** — not staff, who take the decision."* And **R77.2** — the type enum has exactly two values, and *"a third value is an SRS revision, not a code change."* |
| Notifying students that an occurrence was **rescheduled** | **R77.2**, same clause: a third enum value is an SRS revision. |

## 2 · What has actually changed since each clause was written

**This is the part that matters**, because a revision that merely repeats the
request adds nothing.

**R76.7's premise has expired.** Its reason was evidential, not principled:
*no interface has ever set it*, therefore ordering circles *is not a decision
anybody takes today*. The Owner asking for the gesture **is** the missing
evidence — the workflow exists, it simply had no surface. R76.7 does not say
ordering circles would be wrong; it says nobody was doing it. That is now false.

**R77.3's reason does not cover the case.** It excludes staff because they
*"take the decision"* — true of the cancelling administrator, and the whole
point of an **assignment** notification is that the person notified did *not*
take it. An admin assigns Safa; Safa learns of it. R77.3 rules out telling
somebody about their own act, and this is the opposite situation.

**R77.2 is a procedural gate, not an objection.** It asks that new event types
arrive through a revision. This is that revision.

## 3 · The proposed revision

> **Revision 78 (Document Owner decision — ordering circles, and two more
> notification events, 2026-08-18):** **(1) `TeachingGroup` becomes the sixth
> manually orderable entity**, on the R76.4 contract unchanged:
> `PATCH /admin/teaching-groups/order` with `{ within, ids }`, where `within` is
> the `(level, subject)` pairing the circles split — **scoped to a parent for the
> same §2.2 reason `Level` and `AdministrativeGroup` are**, since a circle's
> position means nothing beside a circle of another Subject. R76.7's exclusion is
> **superseded and the reason recorded**: it rested on no interface existing, and
> one is now asked for. **(2) `NotificationType` gains `session_assigned`.** It
> is written when a person is **added** to a Session's or schedule's staffing —
> teacher or assistant — and **never on a re-save that changes nothing**, which
> the existing `(user, session, type)` unique index already makes structural
> rather than a check. **(3) R77.3 is narrowed, not reversed.** The rule becomes:
> *the audience of an event is notified, and a person is never notified of their
> own act.* Students remain the audience for `session_cancelled` and
> `session_restored`; staff are the audience for `session_assigned`; and the
> actor who performed the change is excluded from the recipients of that change,
> which is what R77.3 was reaching for. **(4) `NotificationType` gains
> `session_rescheduled`**, written when an occurrence's date or time is changed
> — carrying enough to say **which** occurrence and **its new date and time**,
> because a notice that says only *a class moved* is one nobody can act on.
> Recipients are the resolved audience, exactly as R77.3 defines it for a
> cancellation. **(5) Nothing else about R77 changes.** One entity, no
> preference, no tier, no channel; §10.1's framework stays postponed; reads stay
> the caller's own; and both new events reconcile like the existing pair —
> withdrawn when unread and no longer true, corrected when already read.

## 4 · What this costs

| | |
|---|---|
| **Schema change** | **Two enum values.** No table, no column. |
| **New entities** | **None.** |
| **New endpoints** | **One** — `PATCH /admin/teaching-groups/order`, on the existing R76.4 shape. |
| **TD-2 rows** | **None** — both inherit existing authority. |
| **Reversibility** | Additive throughout; the enum values can be retired without touching stored rows of the other types. |

## 5 · What was approved

1. Whether **R76.7's exclusion is superseded** — the reason has expired, but it
   is the Owner's clause and the Owner's call.
2. Whether **R77.3 is narrowed as in (3)** — *never notified of your own act* —
   rather than simply reversed to "staff may be notified".
3. The two enum values, and that `session_rescheduled` carries the **new** date
   and time rather than only the fact of a change.

## 6 · The alternative that was rejected

**Treating a reschedule as a cancellation plus a new occurrence.** It needs no
new type and reuses everything. It is rejected because it tells a student the
class is **off** and then, separately, that a different class exists — which is
two false statements in place of one true one, and a reader who acts on the
first will not attend the second.
