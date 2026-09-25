[Documentation](../README.md) › [Development](README.md) › **Personal data map**

# Personal data map — what a deletion request reaches

- Extends SRS Revision 111 §3 (the base classification of every relationship a `User` carried, enumerated from the live database); where they seem to disagree, R111 §3 is the base and this page the amendment.
- The «Option A» column is historical (R133): there is ONE deletion now and it does what Option B described; the per-relationship reasoning still decides what is hers and what is shared.

## Measured, not remembered

- Re-enumerated 2026-09-03: 42 foreign keys reference `user.id` (R111 counted 35): 34 of R111's 35 survive (`student_social_profile.student_id` removed by R120) + 8 added since.
- Re-run before any destructive work:

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

## The eight added since R111, classified for permanent deletion

| relationship | added by | *(historical)* Option A | why |
|---|---|---|---|
| `attendance.student_id` | R123 | PRESERVE | the register is the institution's record of who was there |
| `attendance.marked_by` | R123 | PRESERVE | «who marked this» is the accountability half |
| `exam.student_id` | R125 | PRESERVE | the individual target of an assessment, a fact on somebody else's row |
| `framing_preference.user_id` | R115 | DELETE | R88.2 planning data granting nothing, like `teacher_availability` |
| `legal_consent_text.created_by_id` | R119 | PRESERVE | authorship of immutable legal wording |
| `legal_consent_text.activated_by_id` | R119 | PRESERVE | «who put this wording in force» backs every consent given against it |
| `notification.subject_user_id` | R116 | PRESERVE | sits in somebody else's inbox (R111 deletes `user_id` because the subject has no inbox); tombstone renders «حساب محذوف». The one judgment call, by the Owner's rule «do not guess when deletion would destroy another person's record»; deleting it would be a narrowing decision, not a defect |
| `platform_owner.owner_user_id` | R115 | BLOCK | R115 forbids deleting the current owner; transfer ownership first |

## ONE deletion (Revision 133)

- One request, «حذف الحساب»: R131's Option A / B distinction, `FullDeletionRequest`, its request/review routes and screens are withdrawn. Access stops at once; DELETE → seven-day Trash → restore by a Super Admin (or earlier destruction) or permanent deletion; one window for every entity, accounts included. No Option A/B, no account-return queue, no ten-year archive, no deletion replay (history in `CHANGES.log`).
- Permanent deletion removes everything whose only purpose is that person: authentication identity, sessions and tokens, profile, name, birth date, `reference_code`, copied identity on a `ChildApplication`, enrolments, grades, attendance, Quran progress, assessment submissions and answers, group membership, family links, and every `Trash` snapshot able to restore any of it.
- `erasure.ts` is the only place the boundary is defined; every statement is keyed on `student_id` or an id belonging to the subject.
- Shared institutional data is never deleted because one person referenced it:

| Deleted | Preserved |
|---|---|
| her `Grade` | the `Exam` several beneficiaries sat |
| her `Attendance` row | the `Session` |
| her submission and answers | the assessment definition |
| her `Enrollment` | the `Level`, `Branch`, `AcademicPeriod` |
| her copied `ChildApplication` identity | her guardian's applications about other children |
| — | teacher-authored `EducationalContent` and every other person's records |

- The `User` row survives, de-identified: forty-seven foreign keys point at it, several from other people's records and from consent/audit evidence.
- Never promise «zero rows anywhere»: the deletion's own audit trail and consent/legal evidence survive under their own rule.
- Never promise erasure from backups: a live deletion does not modify an existing backup; stated before she confirms, never engineered around.
- Attestation: R122's promise to attest a former beneficiary's Level is withdrawn by R133 for anyone who deletes her account (history gone, attestation possibly impossible; the confirmation says so); a beneficiary who keeps her account keeps her record.

## Retention *(HISTORICAL)*

- Ten-year policy (adopted 2026-09-03, ran one day): identifiable educational history retained TEN YEARS after the beneficiary's last educational activity; purposes: educational continuity, former-beneficiary requests, attestations; «last educational activity» derived from durable facts (enrolment period end, attendance date, exam date, submission, Quran log), never a maintained `last_activity_at` column.
- WITHDRAWN by R133: two purposes are gone (no attestation promise after deletion, no return path); the third is served by the account's lifetime. Rule: **beneficiary data lives while the account lives; permanent account deletion removes it.**
- It was never externally required (§4.10a: «the association's own purpose-based policy … not prescribed, reviewed or approved by the CNDP»); no document may say otherwise.
- Removed with it: the service, dry run, daily job, readiness worker slot, tests, tombstone-reading exemption. `erasure.ts` survives with permanent account deletion as its only caller.

## Before any destructive automation — the list, closed

Owner precondition: a partial purge that claims data is gone while copies remain is worse than none.

| copy to find | handling |
|---|---|
| `ChildApplication`'s copied identity (names, sex, birth date) | whole row destroyed with the account |
| `Trash` snapshots (JSON copy for restore) | every snapshot naming a destroyed row goes in the same transaction |
| audit detail | minimised to fields and ids by TD-8/TD-14, asserted |
| consent evidence | kept under its own rule; carries no name, birth date or contact |
| `NormalizedEmailLock` | raw lowercased address with no owner — the one item still open, blocked on `EMAIL_LOCK_KEY` |
| backups | stated, not engineered around |
| twelve-month application rule | built; touches the same rows |

- The copies that mattered (application identity, restorable snapshot) were not on the `User` row.
- R59.4: `Trash.purge_after` ends BR-15's ninety-day window; `purgeExpiredEntries` in `trash.service.ts` (daily job, Owner-authorised 2026-09-04) destroys expired tombstones; purging a content snapshot's object destroys the only copy. The «what would it delete» report module was removed 2026-09-25 (unused).

## Option B — SUPERSEDED (Revision 133)

- Option B («delete all my deletable data», Super-Admin-reviewed) is what ordinary permanent deletion now does. Removed: `FullDeletionRequest` and table, four routes, OpenAPI entries and TD-3 registrations, the profile request block, adapter, Arabic copy, `pending_full_deletion_request` account purpose. `erasure.ts` (its destruction primitive) survives.

## Backups

- Deletion removes data from the live system; encrypted finite-lifetime backups may hold an older copy until expiry; no document or screen may promise byte-level erasure from written backups.
- Restore suppression (a deletion ledger replayed after restore) existed one day and was removed by the Owner with its runbook step: **a restored backup represents the state at the instant it was taken** and nothing claims otherwise.
- Deleted data may remain in an older generation at most two months (one backup a month, two generations); the person is told on the confirmation.
- Not implemented: a restore that must not silently resurrect deleted data, with the smallest reliable mechanism (prefer an existing reconciliation ledger); operational work in [`TASKS.md`](../TASKS.md).

## The consent wording has fallen behind the decisions

Inventory and DRAFT only; nothing applied. Active wording is immutable evidence (R119); only the Owner authors and activates (SRS §2.3, R119 (8)).

| `version_label` | Status | In force since |
|---|---|---|
| `dev-unapproved-v1` | `superseded` | 2026-09-02 |
| `نص-الموافقة-القانوني-إصدار-2026-09-02` | `active` | 2026-09-02 |

- One active row, enforced by the partial unique index over `status = 'active'`.
- Out of date (predates R130, R132, R133): retention deferred («سيتم تحديدها … بعد استكمال إجراءات المطابقة») though decided (account lifetime; twelve months for applications); date of birth unnamed (R130 requires it, R133 deletes it); deletion absent (offers only access, rectification, opposition); backups unmentioned (up to two months in an older generation).

### The draft paragraphs

For the Owner to author, adapt and activate; each states real platform behaviour; none states a CNDP requirement; seven days and backup rotation are the association's own choices. Rewritten 2026-09-05 for R133.

Replacing the retention paragraph:

> تحتفظ الجمعية بالمعطيات التعليمية الخاصة بالمستفيدة ما دام حسابها قائماً. وعند حذف الحساب نهائياً تُحذف معه هذه المعطيات. أما طلبات التسجيل، فيتم الاحتفاظ بالطلب المرفوض مدة اثني عشر (12) شهراً ابتداءً من تاريخ قرار الرفض، وبالطلب الذي لم يُبتّ فيه مدة اثني عشر (12) شهراً ابتداءً من تاريخ تقديمه. ويبقى الاحتفاظ ببعض المعطيات لمدة أطول ممكناً عندما يفرضه التزام قانوني أو تنظيمي أو متطلبات إثبات العمليات. وهذه المدد سياسة اعتمدتها الجمعية لأغراضها الخاصة.

Added to the data-categories paragraph:

> تشمل معطيات الهوية المطلوبة لكل مستفيدة أو مستفيد تاريخ الازدياد الكامل، ويُستعمل لتحديد بلوغ سن الرشد وما يترتب عنه على مستوى تدبير الحساب، ولا يُستعمل لقبول أو رفض إدراج المستفيدة أو المستفيد في فئة أو مستوى معيّن. ويُحذف تاريخ الازدياد عند حذف الحساب.

Replacing the rights paragraph's deletion clause:

> يمكنكِ حذف حسابك. ينقطع الدخول فوراً، ويبقى الحساب قابلاً للاسترجاع عبر الإدارة مدة سبعة (7) أيام؛ وبعدها يُحذف نهائياً هو والمعطيات التعليمية الخاصة بكِ. وقد يتعذّر بعد ذلك إثبات المستوى الذي وصلتِ إليه أو إصدار شهادة لكِ. ولا يشمل الحذف ما يفرض الاحتفاظ به التزام قانوني أو تنظيمي، ولا أدلة الموافقة، ولا السجلات الأمنية الضرورية، وهي تخضع لمدد احتفاظ خاصة بها. كما لا يشمل ما لا يخصّك وحدك، كالحصص والاختبارات والمحتوى التعليمي وسجلات الأشخاص الآخرين.
>
> ولا يمكن للجمعية أن تَعِد بمحو فوري من النسخ الاحتياطية: تُؤخذ نسخة احتياطية مشفّرة كل شهر ويُحتفظ بنسختين على الأكثر، فقد تبقى نسخة سابقة من معطياتك داخل النسخة الأقدم إلى أن يحين دورها في الحذف.
>
> وإذا رغبتِ في العودة إلى الجمعية بعد الحذف النهائي، فذلك تسجيل جديد يُنشئ سجلاً جديداً؛ ولا يمكن استرجاع السجل المحذوف.

Added to the paragraph on minors:

> وعند بلوغ المستفيدة أو المستفيد سن الثامنة عشرة، يمكنه أن يطلب تدبير حسابه بنفسه، ويصبح ذلك نافذاً بعد مصادقة إدارة الجمعية. وابتداءً من تلك اللحظة تنتهي صلاحية ولي الأمر في تدبير هذا الحساب ولا تُستعاد. ولا يتم هذا الانتقال بصورة تلقائية بمجرد بلوغ هذا السن.

- Activating restamps nothing (R119 (6)): existing `ConsentRecord` rows keep their version; the new version applies to consents given after it; old wording stays readable; nobody is re-asked.
