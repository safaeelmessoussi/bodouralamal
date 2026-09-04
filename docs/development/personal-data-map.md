[Documentation](../README.md) › [Development](README.md) › **Personal data map**

# Personal data map — what a deletion request reaches

**This page extends `SRS-PROPOSAL-R111.md` §3; it does not replace or restate
it.** R111 classified all the relationships a `User` carried when it was written,
**enumerated from the live database**, and that classification is the base.

**Read the columns below as historical** (Revision 133). They were written when
deletion had two modes — Option A preserved the educational archive, Option B
destroyed it — and the *«Option A»* column records what the preserving mode kept.
There is **one** deletion now, and it does what the Option B column describes.
The table is kept because the per-relationship reasoning in it is still the
reasoning that decides what is hers and what is shared; only the two-mode framing
is gone.

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

## The eight added since R111, classified for permanent deletion

| relationship | added by | *(historical)* Option A | why |
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

## ONE deletion, and what it removes (Revision 133)

**There is one request: «حذف الحساب».** R131's Option A / Option B distinction is
withdrawn, along with `FullDeletionRequest`, its request/review routes and its
screens. A person deletes her account; access stops at once; a Super Admin may
restore it for seven days or destroy it earlier; otherwise it is permanently
deleted at the boundary.

### What permanent deletion removes

Everything whose **only purpose is that person** — her authentication identity,
sessions and tokens, her profile, name, birth date, `reference_code`, her copied
identity on a `ChildApplication`, her enrolments, grades, attendance, Quran
progress, assessment submissions and answers, her group membership, and every
`Trash` snapshot able to restore any of it.

`erasure.ts` is where that boundary is defined, and it is the **only** place. Every
statement in it is keyed on `student_id` or on an id belonging to the subject.

### What it must never remove

**Shared institutional data is never deleted because one person referenced it.**

| Deleted | Preserved |
| --- | --- |
| her `Grade` | the `Exam` several beneficiaries sat |
| her `Attendance` row | the `Session` itself |
| her submission and answers | the assessment definition |
| her `Enrollment` | the `Level`, `Branch` and `AcademicPeriod` |
| her copied `ChildApplication` identity | her guardian's applications about other children |
| — | teacher-authored `EducationalContent` and every other person's records |

**The `User` row itself survives, de-identified.** Forty-seven foreign keys point
at it, several from other people's records and from consent and audit evidence;
removing the row would delete their data to delete hers.

### What must not be promised

**Do not promise "zero rows anywhere".** Narrowly necessary evidence survives:
the deletion's own audit trail and consent/legal evidence under its own rule.

**And do not promise erasure from backups.** A live deletion does not modify an
existing backup; an older encrypted generation may hold a previous copy until
rotation expires it. That limit is stated to the person before she confirms,
never engineered around.

### The attestation consequence, stated plainly

R122 once committed the association to answering *«كنت أدرس عندكم وأريد شهادة
تثبت المستوى الذي وصلت إليه»* years later, and R131 kept an archive so it could.
**R133 withdraws that promise for anyone who deletes her account**: the history
is gone, an attestation based on it may be impossible, and the confirmation says
so before she agrees. A beneficiary who has *not* deleted her account keeps her
record for as long as the account exists.

## Retention — the association's own policy *(HISTORICAL)*

**Everything in this section is superseded** by the subsection below. It is kept
because it records what the ten-year policy was, what it was for, and — the part
that still matters — that it was **never externally required**. A future reader
asking *«why did the ten years go, and may they come back?»* needs that, and it
is nowhere else.

> **Default: identifiable educational history is retained for TEN YEARS after the
> beneficiary's last educational activity.** Bodour Al Amal's own purpose-based
> retention policy, adopted 2026-09-03. **Not** prescribed, reviewed or approved
> by the CNDP, and no document may describe it as such. Its purposes: historical
> educational continuity, answering former-beneficiary requests, and issuing or
> verifying educational attestations.
>
> *«Last educational activity»* was **derived** from canonical durable facts — an
> enrolment's period end, an attendance date, an exam date, a submission, a
> Quran log — never from a maintained `last_activity_at` column, because a clock
> nobody updates consistently deletes the wrong records.

### The ten-year clock is WITHDRAWN (Revision 133)

It ran for one day. §4.10a gave it three stated purposes — **educational
continuity, former-beneficiary requests and attestations** — and R133 withdraws
two of them outright: there is no attestation promise after deletion and no
return path to serve a former beneficiary's request. The third is served by the
account's own lifetime, which is the simpler rule the Owner asked for:

> **Beneficiary data lives while the account lives. Permanent account deletion
> removes it.**

**It was never externally required.** §4.10a says so in terms — *«the
association's own purpose-based policy … not prescribed, reviewed or approved by
the CNDP»* — so removing it costs no obligation, and no document may say
otherwise.

Removed with it: the service, its dry run, the daily job, its worker slot in
readiness, its tests and its tombstone-reading exemption. What survives is
`erasure.ts`, the primitive that decides **what counts as her own data** — now
reached by permanent account deletion, which is its only caller.

## Before any destructive automation *(the list, and how it closed)*

This list was the Owner's precondition for writing any purge, because **a partial
purge that claims data is gone while obvious copies remain is worse than no purge
at all**. Every item is now answered, and the answers are what the erasure
boundary is made of:

| the copy that had to be found | how it is handled |
| --- | --- |
| `ChildApplication`'s copied identity — names, sex, birth date, held independently of the `User` | the whole row is destroyed with the account |
| `Trash` snapshots — a JSON copy written precisely so the row can come back | every snapshot naming a destroyed row goes in the same transaction |
| audit detail | minimised to fields and ids by TD-8/TD-14, and asserted, not assumed |
| consent evidence | kept under its own rule, and it carries no name, birth date or contact |
| `NormalizedEmailLock` | still holds a raw lowercased address with no owner — **the one item still open**, and blocked on `EMAIL_LOCK_KEY` |
| backups | stated honestly rather than engineered around; see below |
| the twelve-month application rule | built, and it touches the same rows |

**The lesson worth keeping**: the copies that mattered were never in the obvious
place. Two of them — the application's copied identity and the restorable
snapshot — would each have made a "complete" deletion a lie, and neither is on
the `User` row.

### R59.4 — the window, measured before it was enforced (2026-09-04)

**A third read-only clock, beside the ten-year and twelve-month ones.**
`Trash.purge_after` records the end of BR-15's ninety-day window, and the job
named as its enforcement — `content.quarantine-purge` — **was never built**;
`startJobRunner` deliberately does not schedule it, with the reason in the code.
That is R59.4, and it remains an open Owner question. Nothing here changes it.

`trash-purge-report.service.ts` answers *«what would it actually delete»* and
nothing else. Two properties are worth knowing before that question is answered:

* **The storage half is the consequential one, and it is reported separately.**
  Purging a `Trash` row removes a tombstone whose live record is already gone.
  Purging the **object** a content snapshot points at destroys the only copy
  outside backups — MinIO has no undelete. These are two authorisations, not one
  total, and the Owner may reasonably grant one without the other.
* **`target_entity` is the classifier, and the snapshot JSON is not read.** A
  snapshot's shape follows whatever the row looked like when it was deleted, so
  digging storage keys out of it would make the report depend on the historical
  shape of every model. The entity name is written at delete time and is stable.

**R59.4 is now answered** (Owner, 2026-09-04): expired entries are purged
automatically, without a Super Admin approving each one. Enforcement is
`purgeExpiredEntries` in `trash.service.ts`, scheduled daily —
**not** in this module, which stayed read-only and is now the diagnostic beside
the executor. It reuses the manual purge's own body, so what an expiry destroys
and what a Super Admin destroys cannot drift apart, and it **fails closed per
entry**: a record something still references, an entity with no purge plan, or a
tombstone whose record was restored is left alone and counted, never destroyed by
improvisation and never allowed to abort the sweep.

**`content.quarantine-purge` is still not scheduled, and that is correct.** R59.4
authorised expiring the Trash *entry*; the entry's purge enqueues the object
retirement with an **exact coordinate**, read from the authoritative row rather
than dug out of snapshot JSON. A schedule on that queue would give it no
coordinate to act on. The object deletion is therefore durable and retrying, and
an already-missing object is a successful DELETE under S3 semantics — so the
failure the Owner named, *«DB says gone, object silently remains forever»*, has
no path.

**The report is still guarded against growing an executor.** A test asserts it
exports no destructive verb, proved by adding one and watching it fail. That
matters more now, not less: with a real destructive path in existence, a second
unaudited one is the thing somebody would call by mistake.

## Option B is withdrawn — SUPERSEDED (Revision 133)

Option B was *«delete all my deletable data»*: a Super-Admin-reviewed request
that destroyed the educational record, beside Option A which closed the account
and kept it. **R133 makes ordinary permanent account deletion do exactly what
Option B did**, so the distinction has no subject and the request queue has
nothing to decide between.

Removed: `FullDeletionRequest` and its table, four routes, the OpenAPI entries
and TD-3 registrations, the profile request block, the adapter, the Arabic copy,
and the `pending_full_deletion_request` account purpose. What survives is
`erasure.ts` — Option B's own destruction primitive, now reached by the single
deletion path.

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

### Restore suppression is WITHDRAWN (Revision 133)

A design existed for one day: a durable ledger of deletions carrying no deleted
content, replayed after any restore so the restored system would not resurrect
people who had left. **The Owner removed it**, along with the runbook step that
carried it.

It was a subsystem whose only purpose was to compensate for a restore that should
be rare, and it added a ledger, a procedure and a place to be wrong. What replaces
it is a sentence the association can actually keep:

> **A restored backup represents the state at the instant it was taken.** It does
> not remember later deletions, and nothing claims it does.

The privacy limit that follows is stated rather than engineered around — a live
deletion never modifies an existing backup, so deleted data may remain in an
older encrypted generation until rotation expires it, which is **at most two
months** given one backup a month and two generations kept. **The person is told
this on the confirmation, before she deletes anything.**

## The consent wording has fallen behind the decisions

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

### What is out of date in the active wording

The active wording predates R130, R132 and R133. Four things it says or omits:

* **Retention periods.** It defers them — *«سيتم تحديدها … بعد استكمال إجراءات
  المطابقة»* — and they are decided: educational data lives while the account
  lives, twelve months for applications.
* **Date of birth.** R130 makes it required for every beneficiary and R133
  deletes it with the account; the text names neither.
* **Deletion.** It offers the 09-08 trio — access, rectification, opposition —
  and the platform now implements a deletion the notice does not mention, whose
  consequences (history gone, attestation possibly impossible) a person should
  read *before* she uses it.
* **Backups.** The notice is silent, and the honest limit is that a deleted
  person's data may remain in an older encrypted generation for up to two
  months.

### The draft paragraphs

**For the Owner to author, adapt and activate — not for me to install.** Each one
states behaviour the platform actually has; **none states a CNDP requirement**,
and none describes the seven days or the backup rotation as anything other than
the association's own choices.

**Rewritten 2026-09-05 for Revision 133.** The 2026-09-04 draft described a model
that no longer exists — two requests, a ten-year archive, and a route back to a
closed account — so those paragraphs are replaced rather than patched. What
replaces them is shorter, which is the point.

**Replacing the retention paragraph:**

> تحتفظ الجمعية بالمعطيات التعليمية الخاصة بالمستفيدة ما دام حسابها قائماً. وعند
> حذف الحساب نهائياً تُحذف معه هذه المعطيات. أما طلبات التسجيل، فيتم الاحتفاظ
> بالطلب المرفوض مدة اثني عشر (12) شهراً ابتداءً من تاريخ قرار الرفض، وبالطلب
> الذي لم يُبتّ فيه مدة اثني عشر (12) شهراً ابتداءً من تاريخ تقديمه. ويبقى
> الاحتفاظ ببعض المعطيات لمدة أطول ممكناً عندما يفرضه التزام قانوني أو تنظيمي أو
> متطلبات إثبات العمليات. وهذه المدد سياسة اعتمدتها الجمعية لأغراضها الخاصة.

**Added to the data-categories paragraph:**

> تشمل معطيات الهوية المطلوبة لكل مستفيدة أو مستفيد تاريخ الازدياد الكامل،
> ويُستعمل لتحديد بلوغ سن الرشد وما يترتب عنه على مستوى تدبير الحساب، ولا يُستعمل
> لقبول أو رفض إدراج المستفيدة أو المستفيد في فئة أو مستوى معيّن. ويُحذف تاريخ
> الازدياد عند حذف الحساب.

**Replacing the rights paragraph's deletion clause:**

> يمكنكِ حذف حسابك. ينقطع الدخول فوراً، ويبقى الحساب قابلاً للاسترجاع عبر
> الإدارة مدة سبعة (7) أيام؛ وبعدها يُحذف نهائياً هو والمعطيات التعليمية الخاصة
> بكِ. وقد يتعذّر بعد ذلك إثبات المستوى الذي وصلتِ إليه أو إصدار شهادة لكِ. ولا
> يشمل الحذف ما يفرض الاحتفاظ به التزام قانوني أو تنظيمي، ولا أدلة الموافقة، ولا
> السجلات الأمنية الضرورية، وهي تخضع لمدد احتفاظ خاصة بها. كما لا يشمل ما لا
> يخصّك وحدك، كالحصص والاختبارات والمحتوى التعليمي وسجلات الأشخاص الآخرين.
>
> ولا يمكن للجمعية أن تَعِد بمحو فوري من النسخ الاحتياطية: تُؤخذ نسخة احتياطية
> مشفّرة كل شهر ويُحتفظ بنسختين على الأكثر، فقد تبقى نسخة سابقة من معطياتك داخل
> النسخة الأقدم إلى أن يحين دورها في الحذف.
>
> وإذا رغبتِ في العودة إلى الجمعية بعد الحذف النهائي، فذلك تسجيل جديد يُنشئ سجلاً
> جديداً؛ ولا يمكن استرجاع السجل المحذوف.

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

**One deletion lifecycle, and this page describes it** (Revision 133):

* **DELETE → seven-day Trash → restore, or permanent deletion.** One window for
  every entity, accounts included.
* **Permanent account deletion destroys what is hers alone** — profile, birth
  date, `reference_code`, authentication, enrolments, grades, attendance, Quran
  progress, submissions, group membership, her copied application identity, her
  family links, and every snapshot able to restore them. `erasure.ts` is the one
  place that boundary is defined.
* **Shared institutional data survives**, always: the Session, the Exam, the
  Level, the Branch, teacher-authored content and every other person's records.
* **No Option A, no Option B, no account-return queue, no ten-year archive, no
  deletion replay.** Each was real and each is withdrawn; the history is in
  `CHANGES.log`, and nothing above is normative any more.
* **A future attestation is not guaranteed after deletion**, and the person is
  told so before she confirms.
* **Backups rotate monthly at two generations**, so deleted data may persist in
  the older one until it rotates out — stated, never engineered around.
