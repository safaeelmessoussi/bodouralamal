[Documentation](../README.md) › [Overview](README.md) › **User journeys**

# User journeys

Eight complete paths through the system. They are **normative integration paths**: the
end-to-end test suite automates every one, so a journey that breaks is a failing build
rather than a discovery in production.

Each journey names the screens it crosses, the states it moves through, and the side
effects it must produce.

> Source: SRS §17 (J1–J8) · Tests: §19.2

---

## J1 — New parent registers, reaches the family dashboard

The most-travelled path in the system, and the one with the most moving parts.

```
Visitor
  └─ /register → "Continue with Google" → Google verifies the email
       └─ no match anywhere → unified parent + child form (email read-only)
            └─ submit — ONE OR MORE children on one form (R62)
                 ONE TRANSACTION: parent · one ChildApplication per child ·
                                  the parent's consents · parent identity ·
                                  single-use token record
                 └─ Pending status screen — zero data access
Admin
  └─ /admin/approvals → the family is ONE queue item, decided PER CHILD (R62)
       ONE TRANSACTION PER CHILD: the child's User · reference code · its
       consents (with the SUBMISSION's values) · link approved · the parent
       role on the first approval · audit row
       └─ the parent is told through the association's existing channels
Parent
  └─ logs in → /dashboard/student → the child is visible
       └─ switches to the child's context
            └─ every subsequent child-scoped request carries X-Active-Child-ID,
               and the middleware re-verifies the approved link each time
```

**What this journey proves:** atomicity of registration, that `Pending` really means zero
access, per-child approval atomicity, and that child context is verified per request rather
than trusted from the session.

**No child account exists between submission and approval (R62).** The child `User`, its
`FamilyLink` and its `ConsentRecord`s are created *at approval*, one child at a time —
which is what lets an administrator approve one sibling and reject another. A rejected
child leaves no `User` row at all, so a partial approval cannot expose one: the safety
property is structural rather than enforced. The parent's own application is decided
explicitly and separately, and is never inferred from the children's outcomes.

---

## J2 — A second child joins an existing parent

```
Parent (already signed in) → account switcher → «＋ تسجيل طفل»
   → POST /child-applications → ChildApplication (Pending)
   ↓
   No visibility of any kind before approval — BR-4. There is no child User
   yet, so there is nothing for X-Active-Child-ID to name; once approval
   creates one, an un-approved link still answers 404.
   ↓
Admin approves the application → the child's User, its reference code, its
consents and an Approved FamilyLink are created in one transaction
   → the child appears in the account switcher's ولي الأمر group
```

**The `404` is the point.** Not `403`, not "pending" — `404`, indistinguishable from a
child that does not exist. See [Security](../architecture/security.md#no-existence-leaks).

Note that **linking an *existing* child is a staff operation**, not self-service. Parents
have no search over existing children, because there is no way for a parent to know a
child's identifier and building a lookup over minors' records would need an anti-enumeration
design nobody had specified. Parents may register a **new** child freely; attaching a second
parent to an existing child is done by staff from the user-management screen (Revision 23).

**A duplicate is resolved by the administrator, never by the platform (R62).** When a
second parent registers a child who may already exist, the server *proposes* candidates —
each shown as name + reference code + the family already linked to it — and the
administrator chooses *link this account* or *create a new one*. There is no natural key for
a child (no national identifier, no date of birth), so matching on names would eventually
attach a child to the wrong family: a safeguarding failure no audit row undoes. This is also
the mechanism by which a second parent legitimately joins an existing child, since
uniqueness is on the *pair* and two approved links are two independent authorizations.

---

## J3 — Exam lifecycle

```
Teacher → /teacher/exams → author the exam (questions get immutable UUIDs)
   └─ publish the exam
        └─ Adult student takes it directly
           Minor takes it through the parent's verified child context
              save_and_resume → repeated PATCHes
              single_submission → one final submit, no resume
        └─ submit → MCQs auto-score into a DRAFT grade
                    (no-shows get 0, flagged absent, at first draft save)
   └─ Teacher marks the free-text answers
   └─ Publish  →  audit row
        └─ students and parents now see the per-exam grade
           (no averages in the MVP — the template engine is post-MVP)
```

---

## J4 — Consent revocation ripples through storage

The journey that demonstrates why consent is an invariant rather than a check.

```
Parent revokes media consent (or staff records the revocation in person)
  └─ ConsentRecord state change + re-evaluation job enqueued — one transaction
       └─ consent.reevaluate recomputes the whole group's consent state
            └─ every affected recording is forced private
                 └─ bucket-migration jobs move the objects
                      └─ a visitor following a stale public link
                         lands on /content-unavailable
Admin may still release a specific resource — with a mandatory written
justification, recorded in the audit log.
```

---

## J5 — Teacher publishes a class recording

```
Teacher records on their phone's own voice-recorder app
  └─ /teacher/content → select the file
       └─ initiate upload
            branch scope validated here — a teacher passing "global" is refused
       └─ single-shot signed PUT, with progress and a retry affordance
            a failure restarts from zero — accepted trade-off, Risk R-9
       └─ complete
            the server fetches only the first 512 bytes back from storage
            and checks the magic bytes — the file is never streamed through the API
       └─ EducationalContent created against an immutable hash-segmented key
       └─ visibility takes the category default, unless the consent gate forces private
       └─ appears in the /resources tree
```

---

## J6 — Weekly schedule plus an exception

```
Admin → /admin/groups → create a Group
          wall-clock time · room/time conflict detection
   └─ enrol students
        capacity enforced under a row lock
        every roster change enqueues consent re-evaluation
   └─ /admin/calendar → create a holiday Event
        visibility tier chosen · scope join rows written explicitly at creation
   └─ Student calendar shows the group's weekly slot and the event,
      with the Hijri overlay where the month has been published.
      Hidden events are invisible to students entirely.
```

---

## J7 — Suspension takes effect

```
Admin suspends a user
  └─ IN THE SAME TRANSACTION: every live refresh token is revoked
       └─ the next refresh is refused immediately
       └─ the current access token dies at expiry (≤ 1 hour)
       └─ high-risk endpoints refuse it before that, because they
          re-read the account from the database on every request
  └─ next login attempt → "Account deactivated" → audit auth.login_denied
```

**Why suspension revokes inside its own transaction:** a suspension that commits without
revoking leaves a 30-day credential alive. For a safeguarding-sensitive platform, "takes
effect at the next token expiry" is not good enough for the refresh token, only for the
short-lived access token.

---

## J8 — A corrected Quran log ripples

```
Teacher → /teacher/students/{id}/quran → spots a mis-logged range
  └─ edits it (or soft-deletes it)
       └─ the SAME REQUEST synchronously recomputes the Surah's merged coverage
            └─ the response carries the corrected percentage
                 └─ the student's dashboard reflects it immediately
       └─ audit: quranlog.update / quranlog.delete
       └─ if the correction drops coverage below 100 %,
          level completion is withdrawn immediately (BR-11)
```

That last line is why the recalculation is synchronous. A deferred job would leave a window
in which a student appears to have completed a level they have not.

---

## What the journeys have in common

Reading them together, four patterns recur — and they are the platform's actual character:

1. **Atomic or nothing.** Registration, approval, suspension, rotation. Where two facts
   must be true together, they commit together.
2. **Verified per request, not per session.** Child context, account status on high-risk
   endpoints. Statelessness ends where safeguarding begins.
3. **Silence over guessing.** An unrecorded Hijri month renders no label. An out-of-scope
   record returns `404`. The system does not fabricate.
4. **Side effects are enqueued transactionally.** A job is a row inserted through the same
   transaction as the mutation that triggered it — a committed mutation with a lost job is
   a prohibited state.

---

**Next:** [Scope and roadmap](scope-and-roadmap.md) · **Related:**
[Business processes](business-processes.md), [Testing](../development/testing.md)
