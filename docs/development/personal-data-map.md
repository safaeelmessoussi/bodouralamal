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

### The restore-suppression design (2026-09-04) — and most of it already exists

A restore rolls the live database back to an earlier moment. Any deletion applied
**after** that moment is undone by the restore, silently. The minimum coherent
mechanism is therefore a **durable ledger of deletions that carries no deleted
content**, so the deletions can be re-applied afterwards without the ledger
itself becoming a copy of what was deleted.

**The platform already keeps that ledger, and it was not built for this.**

| what was deleted | the durable record | what it carries |
|---|---|---|
| an account (Option A) | `AuditLog` `user.deidentify` | target id, and the **field names** cleared — never their values |
| a family link | `AuditLog` `familylink.reject` / `.revoke` | both party ids and a reason |
| an approved full deletion (Option B) | `FullDeletionRequest` (`approved`) + `AuditLog` | subject id, decider, instant |

Each names **which row** and **when**, and none holds the erased data — which is
exactly the property that makes them safe to keep and sufficient to replay. Audit
rows also survive on their own retention clock rather than the subject's, so they
outlive the thing they describe.

**The procedure, stated so it can be executed rather than invented under
pressure:** after any restore, re-apply every deletion whose recorded instant is
later than the restore point, in the order the ledger records them, before the
system is returned to service. `deIdentifyAccount` is already idempotent by
construction, so re-applying one that survived the restore is harmless.

**What is genuinely missing is small and operational**: a runbook step that makes
this replay part of the restore procedure rather than a thing somebody remembers,
and a check that the replay ran. **No provider-specific pruning is designed
here** — backups may hold historical bytes until they expire, and that limit is
stated rather than engineered around.

## The consent wording has fallen behind the decisions (2026-09-04)

**Inventory, gap analysis and a DRAFT. Nothing here is applied.** The active
wording is evidence: R119 makes it immutable once in force, and only the Owner
authors and activates a version (SRS §2.3, R119 (8)). This section exists so the
Owner can act on a prepared draft rather than a discovered surprise.

### What is in force

| `version_label` | Status | In force since |
| --- | --- | --- |
| `dev-unapproved-v1` | `superseded` | 2026-09-02 |
| `نص-الموافقة-القانوني-إصدار-2026-09-02` | `active` | 2026-09-02 |

**One active row, and the database enforces it** — the partial unique index over
`status = 'active'`. Everything below concerns that row.

### The four gaps, and why each one is a gap

The active wording predates R130, R131 and R132. Three of the four are not merely
missing information — they are statements the platform's behaviour has since
overtaken.

* **Retention periods.** The text says the periods *«سيتم تحديدها … بعد استكمال
  إجراءات المطابقة»* — will be determined later. **They have been determined**:
  ten years for identifiable educational history, twelve months for a rejected
  application. A notice that defers a decision already taken understates what the
  reader is agreeing to.
* **Date of birth.** R130 makes a full date of birth required for every
  beneficiary. The text lists *«معلومات الهوية والتواصل»* generically; a newly
  mandatory identifier that decides a **rights transition** is named, not implied.
* **Closure and deletion.** The rights paragraph offers the 09-08 trio — access,
  rectification, opposition. The platform now offers two further requests, and a
  notice that omits a right the product implements is the wrong way round.
* **The adult transition.** The text says a minor is processed *through* the
  guardian and stops there. R132 ends that authority on an approved claim, and a
  guardian reading this notice is consenting to something that will later be
  taken out of their hands.

### The draft paragraphs

**For the Owner to author, adapt and activate — not for me to install.** Each one
states behaviour the platform actually has; none states a CNDP requirement, and
the retention paragraph attributes the ten years to the association, which is
whose decision it is (see *Retention — the association's own policy* above).

**Replacing the retention paragraph:**

> تحتفظ الجمعية بالمعطيات التعليمية التي تسمح بالتعرف على الشخص المعني لمدة عشر
> (10) سنوات ابتداءً من آخر نشاط تعليمي مسجل له في المنصة، وهي مدة اعتمدتها
> الجمعية بناءً على أغراضها الخاصة: ضمان استمرارية المسار التعليمي، والاستجابة
> لطلبات المستفيدات والمستفيدين السابقين، وتسليم الشهادات التعليمية أو التحقق
> منها. أما طلبات التسجيل التي لم تُقبل، فيتم الاحتفاظ بها لمدة اثني عشر (12)
> شهراً ابتداءً من تاريخ قرار الرفض. ويبقى الاحتفاظ ببعض المعطيات لمدة أطول
> ممكناً عندما يفرضه التزام قانوني أو تنظيمي أو متطلبات إثبات العمليات.

**Added to the data-categories paragraph:**

> تشمل معطيات الهوية المطلوبة لكل مستفيدة أو مستفيد تاريخ الازدياد الكامل،
> ويُستعمل لتحديد بلوغ سن الرشد وما يترتب عنه على مستوى تدبير الحساب، ولا يُستعمل
> لقبول أو رفض إدراج المستفيدة أو المستفيد في فئة أو مستوى معيّن.

**Added to the rights paragraph:**

> إضافة إلى ذلك، تتيح المنصة تقديم طلبين متمايزين: إغلاق الحساب على المنصة، حيث
> تُحذف عناصر الهوية وتنتهي إمكانية الولوج مع الاحتفاظ بالحد الأدنى من الأرشيف
> التعليمي؛ أو حذف المعطيات التعليمية بشكل كامل، ويُبَتّ في هذا الطلب الثاني من
> طرف إدارة الجمعية قبل تنفيذه. ولا يشمل الحذف ما يفرض الاحتفاظ به التزام قانوني
> أو تنظيمي، ولا أدلة الموافقة، ولا السجلات الأمنية الضرورية، وهي تخضع لمدد
> احتفاظ خاصة بها.
>
> ولا يمكن للجمعية أن تَعِد بمحو فوري من النسخ الاحتياطية، إذ تُحفظ هذه النسخ
> لمدة محدودة ثم تنتهي صلاحيتها؛ وتضمن الجمعية ألا يُعاد إدراج المعطيات المحذوفة
> عند أي عملية استرجاع.

**Added to the paragraph on minors:**

> وعند بلوغ المستفيدة أو المستفيد سن الثامنة عشرة، يمكنه أن يطلب تدبير حسابه
> بنفسه، ويصبح ذلك نافذاً بعد مصادقة إدارة الجمعية. وابتداءً من تلك اللحظة تنتهي
> صلاحية ولي الأمر في تدبير هذا الحساب ولا تُستعاد. ولا يتم هذا الانتقال بصورة
> تلقائية بمجرد بلوغ هذا السن.

### What activating it costs

**Nothing is restamped.** R119 (6) is the rule: existing `ConsentRecord` rows keep
the version they were written against, because they record what those people
actually read. A new version applies to consents given **after** it takes effect,
and the old wording stays readable forever as the evidence for the ones before.
**Nobody is re-asked**, and no screen should imply they were.

## Status

**This page is a MAP, and it is now partly implemented.** What has changed since
it was written:

* **Option A exists and is R131's behaviour, not R111's** — it **preserves**
  `referenceCode`, per the Owner's decision.
* **Option B's request and review control plane exists**; its **execution does
  not**, and will not until the classification above settles every row.
* **The retention clocks are computed** — ten-year and twelve-month — and both
  are **read-only reports**. Nothing on this page deletes anything today.
* **The consent wording is drafted, not applied.**
