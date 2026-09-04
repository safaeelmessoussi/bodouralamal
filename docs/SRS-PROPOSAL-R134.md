[Documentation](README.md) › **SRS Proposal — Revision 134**

# SRS Proposal — Revision 134

**Publishing an online assessment tells the people it concerns — and the paper
it is written on is a resource that stays.**

**Status: AWAITING RATIFICATION.** The Document Owner instructed on 2026-09-04
that the `assessment_published` notification be ratified rather than left as an
unratified implementation gap, and that the exam/assessment product model be made
coherent. The behaviour below is **implemented, migrated, tested and
browser-verified**; `SRS.md` is immutable to the implementer, so the normative
clauses are drafted here in the ratification style for the Owner to apply as
SRS Revision 134.

---

## 1 · The gap this closes

R116 clause 5 wired the **physical** Exam lifecycle to the in-app inbox:
creation writes `exam_teacher_assigned` to assigned staff and `exam_scheduled`
to the sitting's grade-sheet audience. R124 then built the **online** assessment
on the same `Exam` row with a lifecycle of its own — `draft → published →
closed` — and **publication notified nobody at all**. It moved the status and
wrote its audit row.

Publication is the only transition that makes a paper reachable, so the effect
was that an assessment became available and no مستفيدة and no مؤطِّرة was told.
2,246 integration tests were green throughout, because each asked whether its own
step worked and none asked whether publication *reaches* anybody.

R116 is **not** amended: its clause 5 describes a physical sitting and remains
exactly as ratified. This adds the online lifecycle's own fact.

## 2 · The clauses proposed

**(1) `NotificationType` gains `assessment_published`**, using the existing
`exam_id` target, the existing CHECK requiring exactly one target, and the
existing `(user_id, exam_id, type)` idempotency coordinate. No new table, no
tier, no preference, no channel; §10.1's framework stays postponed. **No email,
SMS or push** — this is the in-app inbox and nothing else.

**(2) `exam_scheduled` is NOT reused, deliberately.** It is defined against the
sitting's authoritative grade-sheet audience — a named Administrative Group, or
the whole Level at the Exam's branch — while an assessment resolves one of
R125's five target arms and carries **no branch at all**
(`exam_online_has_no_room_check` forbids one). One value with two audience rules
is the drift this specification repeatedly warns about. Its rendered wording also
names a clock time an online paper does not have.

**(3) The student audience is the canonical eligibility predicate, not a second
reading of it.** Recipients are resolved through `examAudienceWhere` — the same
predicate that decides whether a مستفيدة may open the paper and that
`GET /me/assessments` filters on — evaluated **on the assessment's own date**
(R122). R77.3's rule applies: a notification list that disagrees with its own
audience makes both unusable.

**(4) One notice per person, structurally.** The recipient query selects `User`
rows, so a مستفيدة enrolled in the addressed Level **and** another Level is one
row and therefore one notice. This is a property of the predicate, not a
de-duplication step that a later change could omit.

**(5) The staff audience is the authoring authority, asked rather than
restated.** Recipients are narrowed to the people staffing a live schedule that
teaches the assessment's Level, **effective on the assessment's own date**
(R91), and each candidate is then confirmed by calling
`assertExamInTeacherScope` itself. A مؤطِّرة the assertion refuses is not told a
paper exists that she cannot open (§20 rule 17). No third grammar of *which
papers are hers* is introduced.

**(6) Delivery joins the publishing transaction** (R116 clause 7): no committed
publication loses its notification obligation, and no row announces a rolled-back
one. The actor is never a recipient (R78.3), and inactive or deleted accounts are
removed under locked `User` rows exactly as every other type does.

**(7) The audit row carries counts and no names** (TD-8, TD-14):
`notified_students` and `notified_staff` beside the existing question count and
target kind.

**(8) Publishing to an empty audience is PERMITTED and must be stated.** A paper
whose target currently resolves to nobody is not refused — publishing for a Level
and then admitting its students is legitimate, and R122 resolves the audience on
the paper's own date. But the author must know before she acts: the builder shows
the count, warns when it is zero, and the publish confirmation names the number
rather than saying *«sيصبح متاحاً للمستفيدات المعنيات»* whether that is thirty
people or none.

## 3 · The paper is a resource that stays

**(9) An online assessment is discoverable for its whole life.** `GET
/assessments` lists the papers a staff caller may work with. Before this there
was no list at all: `POST /assessments` created a paper, every other route
addressed one by id, and an author who navigated away had **no route back to
it**. Draft, published and closed papers all appear; publication, closure and the
end of an academic period change a paper's **state**, never its existence.

**(10) Its scope is the sitting list's, reused.** A Super Admin sees every paper;
a branch-scoped Admin sees the papers whose **Level** reaches her branches, since
a paper carries no branch of its own; a مؤطِّرة sees the papers her §4.4c
staffing reaches, through the same `examScopeWhereForTeacher` that scopes
`GET /exams`. **Staff only** — a beneficiary has `GET /me/assessments`, and
enumerating the library is a different question, refused outright.

**(11) Reuse is a COPY, and the copy is what preserves history.** `POST
/assessments/{id}/copy` produces a new **draft** carrying the title (suffixed
«(نسخة)»), the instructions, the maximum, the Level, the Subject, the target arm,
and every question with its options and order. It carries **no
`StudentExamSubmission`, no `StudentExamAnswer`, no `Grade`, no `Notification`
and no attendance**. Its date is **today**, so it resolves the audience of the
term it is used in rather than inheriting the original's.

**(12) Historical integrity follows from the copy, with no versioning scheme.**
One `Exam(mode = 'online')` row is both the paper and the one occasion it was
used. A paper reused in December is therefore a **different row**, and editing it
cannot reach September's questions, answers or marks — there is nothing shared to
mutate. R124's freeze guards the other direction: a paper that holds any
submission cannot be edited at all. A template/sitting split was considered and
rejected: it requires a new entity and a migration for every table keyed on
`exam_id` (`Grade`, `StudentExamSubmission`, `Notification`, `Attendance`), and
delivers the same property.

**(13) Physical and online are one domain with two deliveries, and the interface
must stop saying otherwise.** §14's scheduling screen described online exams as
*«قريباً … ولم تُبنَ بعد»* after R124 had shipped them. The truthful statement is
that an online paper is not *arranged* there — that screen books a room, a clock
window and supervisors — and is written in «بناء الاختبارات». `POST /exams` still
refuses `mode: online` with `ONLINE_NOT_AVAILABLE`, and that refusal is unchanged;
it was never about the capability being absent.

## 4 · Deliberately unchanged

R116's physical clauses; R124's freeze, lifecycle and absence of any staff
reopen/reset/resubmit action; R125's five target arms and their scope rules;
R127's save-and-resume policy; R122's date-based audience resolution; the
`grade_published` notice and BR-8's rule that entering a mark is not returning
it; R133's deletion lifecycle, which governs papers like every other record —
there is **no special retention for assessments**, and reuse never resurrects a
deleted paper.

---

**Related:** [`SRS.md`](SRS.md) §4.6, §4.8 · [Decision log](reference/decision-log.md) ·
[Testing](development/testing.md)
