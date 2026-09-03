[Documentation](../README.md) › [Development](README.md) › **Personal data map**

# Personal data map — what a deletion request reaches

**This page extends `SRS-PROPOSAL-R111.md` §3; it does not replace or restate
it.** R111 classified all the relationships a `User` carried when it was written,
**enumerated from the live database**, and that classification is the base for
**Option A**. This page records two things R111 could not: the relationships
added since, and the **Option B** column the Owner introduced on 2026-09-03.

Where R111 §3 and this page appear to disagree, R111 §3 is the base and the
delta below is the amendment.

---

## Measured, not remembered

Re-enumerated from the live schema on **2026-09-03**: **42 foreign keys
reference `user.id`**, against R111's 35.

```
34 of R111's 35 survive  (student_social_profile.student_id was removed by R120)
 8 added since           (listed below)
──
42
```

Re-run the enumeration rather than trusting this number before any destructive
work:

```sql
SELECT tc.table_name, kcu.column_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'user' AND ccu.column_name = 'id'
ORDER BY 1, 2;
```

## The eight added since R111, classified for Option A

| relationship | added by | Option A | why |
|---|---|---|---|
| `attendance.student_id` | R123 | **PRESERVE** | the register is the institution's record of who was there |
| `attendance.marked_by` | R123 | **PRESERVE** | *«who marked this»* is the accountability half; a register with no marker is not evidence |
| `exam.student_id` | R125 | **PRESERVE** | the individual target of an assessment — a fact on somebody else's row |
| `framing_preference.user_id` | R115 | **DELETE** | R88.2 planning data that grants nothing, exactly like `teacher_availability` |
| `legal_consent_text.created_by_id` | R119 | **PRESERVE** | authorship of immutable legal wording; the text outlives its author |
| `legal_consent_text.activated_by_id` | R119 | **PRESERVE** | *«who put this wording in force»* is the accountability record for every consent given against it |
| `notification.subject_user_id` | R116 | **PRESERVE** | the message sits in **somebody else's** inbox. R111 deletes `user_id` because the person no longer has an inbox; this one is another person's record, and the tombstone renders it correctly as «حساب محذوف» |
| `platform_owner.owner_user_id` | R115 | **BLOCK** | R115 already forbids deleting the current owner; ownership is transferred first |

`notification.subject_user_id` is the one judgment call here, and it is made by
applying the Owner's own rule — *do not guess when deletion would destroy another
person's legitimate record* — rather than by inventing a policy. If the Owner
prefers it deleted, that is a narrowing decision and not a defect.

## The two requests, and what separates them

The Owner's decision of 2026-09-03 splits one word into two:

| | **Option A — close my account** | **Option B — delete all my deletable data** |
|---|---|---|
| **What it means** | remove what exists to operate the online account; keep the minimal educational archive for the remaining retention period | remove personal **and** educational data that the platform is permitted and able to remove |
| **Authentication** (`user_identity`, `refresh_*`, `rate_limit_counter`, login email) | removed | removed |
| **Planning data** (`teacher_availability`, capabilities, `framing_preference`) | removed | removed |
| **Profile/account fields** | de-identified to «حساب محذوف» | de-identified |
| **`referenceCode`** | **KEPT** — see below | **removed** |
| **Educational archive** (`enrollment`, `grade`, `student_exam_submission` + answers, `attendance`, `quran_progress_log`, `student_surah_progress`, `student_teaching_group`) | **KEPT** for the retention period | **removed** |
| **Consent & safeguarding evidence** | kept under its own rule | kept under its own rule |
| **Audit trail** | kept under its own rule | kept under its own rule — and it carries **no educational content** to begin with |
| **Approval** | the person, or a Super Admin | **Super Admin only** |

### `referenceCode` — the contradiction the Owner resolved

R122 promised a future attestation; R111 cleared every field that could match a
returning person to her preserved record, **including `referenceCode`**. The two
were irreconcilable and the Owner has now decided:

* **Under Option A the reference code SURVIVES**, as part of the protected
  minimal educational archive, for the remainder of the retention period. It
  exists to reconnect a former beneficiary with her own record.
* **It is NOT anonymous.** It is personal/pseudonymous data and is protected as
  such. The archive is not anonymous merely because the login identity is gone.
* **Under Option B it is removed** with the identifiable educational archive.
* **It must never be used as a back door** to reconstruct educational history
  that Option B was approved to delete.

This supersedes the earlier instruction not to preserve it. **Not yet
implemented** — `deIdentifyAccount` still clears it, and changing that is part of
the Option A work, not of this map.

### What Option B must NOT destroy

Deletion is a request about **her** data, and some rows are two people's at once.

* **A teacher-authored educational resource does not disappear** because a
  beneficiary who read it asks for deletion. `EducationalContent` carries no
  `user` foreign key at all, so this is structurally safe rather than a rule
  somebody must remember.
* **`quran_progress_log.logged_by` and `attendance.marked_by`** name the staff
  member, not the beneficiary. When the *entry itself* is deleted under Option B
  they go with it — that is inherent to deleting the entry — but neither is ever
  a reason to touch another person's row.
* **A Grade is authored by a teacher about a beneficiary.** Option B deletes it,
  because it is her educational record; the teacher's authorship goes with the
  row it lives on. This is a consequence of the request, not an oversight.
* **Audit and consent rows are not a hiding place.** They survive under their own
  retention rules, and TD-8 already records **fields and ids, never values**, so
  no educational content is retained under the pretext of audit.

### What must not be promised

**Do not promise "zero rows anywhere".** Narrowly necessary evidence survives:
the deletion request itself, its completion, required security/audit facts, and
consent/legal evidence under its own rule. A page that promises more than the
system does is worse than one that explains the limit.

## Retention — the association's own policy

**Default: identifiable educational history is retained for TEN YEARS after the
beneficiary's last educational activity.**

This is **Bodour Al Amal's own purpose-based retention policy**, adopted by the
Owner on 2026-09-03. It is **not** a duration prescribed, reviewed or approved by
the CNDP, and no document may describe it as such. Its purposes are historical
educational continuity, answering former-beneficiary requests, and issuing or
verifying educational attestations.

### "Last educational activity", defined from canonical facts

**Derived, never a maintained timestamp.** A dedicated `last_activity_at` column
would be a fact nobody updates consistently, and a retention clock driven by a
stale column deletes the wrong records. The boundary is the **latest** of the
canonical educational facts the platform already records:

| fact | coordinate |
|---|---|
| enrolment | its `AcademicPeriod`'s end date (R122), falling back to `enrolled_at` where a legacy row has no period |
| attendance | `attendance.occurrence_date` (R123) |
| grade | the `exam.date` it is against (R81/R124) |
| assessment submission | `student_exam_submission.submitted_at`, else `started_at` |
| Quran progression | `quran_progress_log`'s own date |

**Quran progress is educational history for product purposes.** That is a
statement about *how the platform treats it* and **not** a claim about its legal
classification, which stays explicitly open in this inventory.

## Before any destructive automation

**No purge job is to be written until the following are reconciled**, because a
partial purge that claims data is gone while obvious copies remain is worse than
no purge at all:

1. **`ChildApplication` copied identity fields.** The application holds the
   child's names, sex and (R130) birth date independently of the `User`. A
   deletion that clears the `User` and leaves the application intact has deleted
   nothing.
2. **Trash snapshots.** A snapshot is a JSON copy of a row, written precisely so
   the row can come back. Deleting the row and keeping the snapshot is a copy.
3. **Audit detail.** Already minimised to fields and ids (TD-8, TD-14) — verify,
   do not assume.
4. **Consent evidence**, which has its own retention rule and its own purpose.
5. **`NormalizedEmailLock`**, which retains the raw lowercased address with no
   owner — see the separate design record.
6. **Backups.** See below.
7. **The 12-month application-retention rule**, whose purge touches the same
   `ChildApplication` rows.

## Backups — what may honestly be claimed

A deletion request removes data from the **live operational system**. Encrypted,
finite-lifetime backups may still contain an older copy until they expire, and
**no document or screen may promise immediate byte-level erasure from backups
that have already been written**, because that is not true.

Two obligations follow:

* **A restore must not silently resurrect deleted personal data.** A restore
  that reinstates a row somebody asked to have removed re-creates the very state
  the request ended.
* **The mechanism must be the smallest reliable one.** Prefer reusing an existing
  reconciliation ledger over inventing a subsystem.

Neither is implemented. Auditing the existing restic design and choosing the
mechanism is operational work, recorded in [`TASKS.md`](../TASKS.md).

## Status

**This page is a MAP, not an implementation.** Nothing here deletes anything
today. Option A remains R111's behaviour exactly — including clearing
`referenceCode`, which the Owner's decision will change — and Option B does not
exist. The map is the precondition the Owner set for destructive work, not the
work itself.
