[Documentation](../README.md) › [Overview](README.md) › **User journeys**

# User journeys

Eight normative integration paths, each automated end-to-end. SRS §17 (J1–J8) · tests §19.2.

## J1 — New parent registers, reaches the family dashboard

1. `/register` → "Continue with Google" → email verified, no match → unified parent + child form (email read-only).
2. Submit ≥1 children (R62); one transaction: parent, ChildApplication per child, parent consents, identity, single-use token record.
3. Pending screen; zero data access.
4. Admin `/admin/approvals`: one queue item, decided per child; one transaction per child: child `User`, reference code, consents (submission's values), approved link, parent role on first approval, audit row.
5. Parent told via the association's channels; logs in → `/dashboard/student` → child context; each child-scoped request carries `X-Active-Child-ID`, middleware re-verifies the approved link.
- No child `User`/`FamilyLink`/`ConsentRecord` before approval; a rejected child leaves no row; the parent's application is decided separately.

## J2 — A second child joins an existing parent

1. Switcher → «＋ تسجيل طفل» → `POST /child-applications` → Pending.
2. Before approval: `404`, not `403` or "pending" ([no existence leaks](../architecture/security.md#no-existence-leaks)).
3. Approval creates child User, reference code, consents, Approved FamilyLink in one transaction → child in the ولي الأمر group.
- Linking an existing child is staff-only from user management (R23); parents have no search over minors.
- Duplicates: server proposes candidates (name + reference code + linked family), admin chooses link or create (R62); no natural key, so no name matching; uniqueness on the pair, two approved links = two authorizations.

## J3 — Exam lifecycle

1. `/teacher/exams` → author (immutable question UUIDs) → publish.
2. Adult takes directly; minor via verified child context; `save_and_resume` = repeated PATCHes, `single_submission` = one submit.
3. Submit → MCQs auto-score into a DRAFT grade; no-shows 0, flagged absent, at first draft save.
4. Teacher marks free text → publish → audit row → per-exam grade visible (no averages; template engine post-MVP).

## J4 — Consent revocation ripples through storage

1. Revocation (parent, or staff in person) → ConsentRecord change + `consent.reevaluate` job in one transaction.
2. Job recomputes the group's state → affected recordings warned (R170 §3); nothing moves.
3. Stale public link → `/content-unavailable`.
4. Admin may release a resource with a written justification, audited.

## J5 — Teacher publishes a class recording

1. Phone recorder → `/teacher/content` → initiate upload (branch scope validated; teacher "global" refused).
2. Single-shot signed PUT with progress/retry; failure restarts from zero (Risk R-9).
3. Complete: server reads only the first 512 bytes back and checks magic bytes; file never streams through the API.
4. EducationalContent on an immutable hash-segmented key; category-default visibility; staff consent warning (R170 §3); shows in `/resources`.

## J6 — Weekly schedule plus an exception

1. `/admin/groups` → Group (wall-clock time; room/time conflict detection).
2. Enrol: capacity under a row lock; every roster change enqueues consent re-evaluation.
3. `/admin/calendar` → holiday Event: visibility tier; scope join rows written at creation.
4. Student calendar shows slot + event with Hijri overlay where published; hidden events invisible.

## J7 — Suspension takes effect

1. Suspend → same transaction revokes every live refresh token (else a 30-day credential survives).
2. Next refresh refused; access token dies at expiry (≤ 1 hour); high-risk endpoints re-read the account per request and refuse sooner.
3. Next login → "Account deactivated" → audit `auth.login_denied`.

## J8 — A corrected Quran log ripples

1. `/teacher/students/{id}/quran` → edit or soft-delete a range.
2. Same request recomputes merged coverage synchronously; response and dashboard carry the new percentage.
3. Audit `quranlog.update` / `quranlog.delete`.
4. Coverage < 100 % withdraws level completion immediately (BR-11).

## What the journeys have in common

Atomic or nothing · verified per request, not per session · silence over guessing (no Hijri label, `404`) · side effects enqueued in the mutation's transaction.

**Next:** [Scope and roadmap](scope-and-roadmap.md) · **Related:** [Business processes](business-processes.md), [Testing](../development/testing.md)
