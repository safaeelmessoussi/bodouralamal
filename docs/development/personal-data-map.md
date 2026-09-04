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
7. ~~**The 12-month application-retention rule**, whose purge touches the same
   `ChildApplication` rows.~~ **Built and enforced** (2026-09-04): rejected from
   `decided_at`, never-converted pending from `created_at`, the whole row deleted
   with its Trash snapshot in one transaction, scheduled daily.

### R59.4 — BR-15's ninety days, measured (2026-09-04)

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
  beneficiary, and Option A now clears it (Owner, 2026-09-04). The text lists *«معلومات الهوية والتواصل»* generically; a newly
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

**Updated 2026-09-04**, where the Owner's decisions of that day made the draft
factually stale rather than merely incomplete: the pending-application clock now
has a stated reference point, the birth date is now **erased at closure** and the
draft says so, and a returning former beneficiary now has a route the notice can
honestly mention. Everything else stands as written.

**Replacing the retention paragraph:**

> تحتفظ الجمعية بالمعطيات التعليمية التي تسمح بالتعرف على الشخص المعني لمدة عشر
> (10) سنوات ابتداءً من آخر نشاط تعليمي مسجل له في المنصة، وهي مدة اعتمدتها
> الجمعية بناءً على أغراضها الخاصة: ضمان استمرارية المسار التعليمي، والاستجابة
> لطلبات المستفيدات والمستفيدين السابقين، وتسليم الشهادات التعليمية أو التحقق
> منها. أما طلبات التسجيل التي لم تُقبل، فيتم الاحتفاظ بها لمدة اثني عشر (12)
> شهراً ابتداءً من تاريخ قرار الرفض، كما يُحتفظ بطلب التسجيل الذي لم يُبتّ فيه
> مدة اثني عشر (12) شهراً ابتداءً من تاريخ تقديمه. ويبقى الاحتفاظ ببعض المعطيات
> لمدة أطول ممكناً عندما يفرضه التزام قانوني أو تنظيمي أو متطلبات إثبات
> العمليات.

**Added to the data-categories paragraph:**

> تشمل معطيات الهوية المطلوبة لكل مستفيدة أو مستفيد تاريخ الازدياد الكامل،
> ويُستعمل لتحديد بلوغ سن الرشد وما يترتب عنه على مستوى تدبير الحساب، ولا يُستعمل
> لقبول أو رفض إدراج المستفيدة أو المستفيد في فئة أو مستوى معيّن. ويُحذف تاريخ
> الازدياد عند إغلاق الحساب، إذ لا يحتاجه الأرشيف التعليمي المحتفظ به.

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
>
> وإذا سبق لكِ إغلاق حسابك ورغبتِ في استعادته، يمكنكِ تقديم طلب بذلك؛ ولا يُفتح
> الحساب إلا بعد تحقّق الإدارة من هويتك، ولا يُنشأ حساب جديد.

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
* **Option B EXECUTES** (Owner, 2026-09-04). Approval destroys in the same call
  and returns `executed: true` only once it has committed — see below.
* **All three retention clocks now EXECUTE** — ten-year educational,
  twelve-month application, ninety-day Trash — each scheduled daily, each
  failing closed per subject, and the first two sharing Option B's own erasure
  primitive rather than reimplementing it.
* **The consent wording is drafted, not applied.**
