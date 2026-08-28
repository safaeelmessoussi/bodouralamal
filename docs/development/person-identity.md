[Documentation](../README.md) › [Development](README.md) › **Person identity**

# Person identity — the QR, and what it is not

**One page for the identifiers that name a human being.** It cites
[`docs/SRS.md`](../SRS.md) §4.3, BR-5 and Revisions 62, 79 and 96 rather than
restating them; where a rule below has an SRS home, the SRS wins.

---

## Three identifiers, three jobs

| Value | Shape | Who has one | What it is for |
|---|---|---|---|
| `User.id` | random UUIDv4 | everyone | **the row**. Referenced by every FK; never printed |
| `User.referenceCode` (R62) | `BA-7K4M2` | children via child-application only | **spoken** — said down a telephone, written on paper |
| `User.qrRef` (R96) | random UUID | **everyone**, `NOT NULL UNIQUE` | **scanned** — the QR payload |

**None of the three authorises anything.** R62.5 established the rule for the
second and R96 restates it for the third rather than cross-referencing it,
because a second opaque identifier is exactly the thing that quietly acquires
different powers.

## Why the QR is not `User.id`

`User.id` is already random and would have needed no migration. Two reasons it
is still the wrong value to print:

* **Rotation.** A card that must be reissued — lost, copied, compromised —
  cannot be, because the id is referenced by every foreign key. Rotating
  `qr_ref` is one `UPDATE`.
* **Two concepts, one name** (§20 rule 22). *The row's identity* and *the value
  on a physical card* must be able to diverge.

## Why the QR is not `referenceCode`

Right doctrine, wrong value. `referenceCode` is five characters from a
31-symbol alphabet with `0/O` and `1/I/L` removed, because it is **read aloud
and hand-copied** — 31⁵ ≈ 28.6 million, ample for that and small as a scannable
payload. It is also, by R62, a students' code.

> **Recorded defect, not fixed here.** `referenceCode` is documented as
> *"Students only"* and is in fact narrower still: `allocateReferenceCode` has
> exactly **one** call site, `child-application.service.ts`. Self-registered
> adult beneficiaries, admin-created accounts, staff pre-provisioning, the Super
> Admin bootstrap and every seed set none. R96 leaves R62 untouched; whether
> every beneficiary should carry a spoken code is a separate Owner decision.

## Every person, and the invariant that needs no thinking

`user_qr_ref` is `NOT NULL UNIQUE` with **no conditional and no partial index**.
The population is *every `User`* — and that is simpler to hold than
"beneficiaries, plus children, plus anybody who later becomes staff".

**Children and teenagers already are `User` rows.** §4.3/BR-5: *"Minor students
are User rows with NO UserIdentity records — they are login-less and reached only
through an approved FamilyLink."* Login capability lives in a separate table, so
being unable to log in never made somebody less of a person here. **No dependent
exists without a `User`**, which is what made one-QR-per-person possible without
inventing an identity for anything.

**The default is the database's** (`gen_random_uuid()`), not Prisma's. Every
creation path gets one whether or not it goes through the ORM — including a raw
`INSERT` and every path nobody has written yet. That is asserted directly: the
integration suite inserts a row in SQL *without naming the column* and reads back
a reference.

## Whose identity a surface shows

| Surface | Subject | Serves |
|---|---|---|
| `/profile` | JWT `sub` | the **account holder** — a parent gets her own |
| beneficiary account view | `childContext` (§4.3) | the **acting student** — under child context, the **child** |

**Never silently exchanged.** A card printed for the wrong person is worse than
no card, so each square is captioned with whose it is — in a family of three
children, three unlabelled squares are indistinguishable.

### A guardian reaches her child's screens (fixed 2026-08-20)

R96 shipped with this recorded as a defect: a `parent`-only account **could not
open any beneficiary-portal screen**, so the child's QR was served correctly and
had nowhere to be read. **The gap was never about the QR.**

`role-home.ts` sends a parent to `/dashboard/student` and has always recorded
why — *"a parent therefore lands where their child's data is … and the active
role decides whether it renders their own record or their child's"*. Meanwhile
`canAccess` gated every beneficiary module on `roles: ['student']`, so a
guardian selecting a child was navigated **straight into** «ليست لديك صلاحية
لعرض هذه الصفحة». The intent was written down; only the gate disagreed — and
every beneficiary page already resolved its subject through the active-child
mechanism, so the screens themselves were ready.

**The fix is in the shared gate, not in a QR route.** `PortalModule` gains
`childContext`, and `canAccess` admits a caller when *either* she holds one of
the module's roles *or* the module's subject is the acting person **and** she is
a `parent` actively acting for a linked child:

```
canAccess(module, roles, { actingForChild })
  → module.roles ∩ roles ≠ ∅
  → OR (module.childContext && actingForChild && roles includes 'parent')
```

* **She gains no student role**, and every module's `roles` array is untouched.
* **`actingForChild` defaults to `false`**, so every existing caller keeps
  exactly today's behaviour; nothing is broadened by omission.
* **The predicate names the `parent` role itself** rather than trusting each
  caller to compute the flag correctly — rule AE's lesson, applied here.
* **`childContext` is REQUIRED on `StudentModule`**, so a new beneficiary module
  cannot be added without answering *whose record does this show*. A screen that
  read the account holder would otherwise silently show a guardian **her own**
  data while the banner named her child.

**Authorization did not move.** The authority is still the approved `FamilyLink`
the server verifies against `X-Active-Child-ID` on every request (§4.3). A
forged unrelated child and a revoked link are both refused **404** by the rules
that already existed, and `ActiveChildProvider` reconciles the stored id against
the links `/me` returns — so a revoked link leaves the context `null` on the
next load and access ends with it.

## It identifies; it never authenticates

The payload is `bodour:user:v1:<uuid>` and carries **no name, email, phone, sex,
Branch, Level, enrolment — and no role**. Roles change while the identity does
not, so a role in the payload would be a disclosure now and a lie later.

Proved rather than asserted: the harness offers the reference as a bearer token
and as a refresh token **with every cookie cleared**, and both are refused.

> The first version of that check ran with the child's session cookie still set,
> so `/auth/refresh` answered `200` — from the cookie, not the reference. It read
> as *the QR authenticates*. **A credential test that leaves a credential lying
> around proves nothing in either direction.**

## Anticipated, and deliberately absent

Reception lookup · attendance and check-in · quick beneficiary search · staff
identification · linking physical documents to a person. **None is implemented**,
and none of them changes the rule above: whatever is built on a scan authorises
itself.

## The name parts, and the rows that do not have them

Revision 40 split the Arabic name into **الاسم الشخصي + الاسم العائلي** and kept
`name_arabic` as the server-composed whole. It also refused a backfill, in
terms: *splitting an existing full name on whitespace would be a guess, and
afterwards nothing could distinguish a guessed part from a typed one.* That
refusal stands.

It left a consequence nobody had followed through. Every account created before
Revision 40 — and every path that still writes only the composed column, the
seeds and most test fixtures among them — carries `first_name_arabic` and
`last_name_arabic` as **NULL**. `تعديل بيانات المستخدم` requires both. So the
edit dialog opened with two required fields empty on those accounts, and `حفظ`
failed validation and **returned without saying anything**: a screen that looked
functional, could not be saved, and gave no reason.

Two fixes, and the split between them is the point:

- **`splitComposedName` derives the parts at READ time**
  ([`lib/person-name.ts`](../../backend/src/lib/person-name.ts)), in `userDto`
  and in the directory projection. It splits at the **first** space — «عبد
  الله» is one given name far more often than «الرحمن» is a family name — and
  returns `null`, never `''`, for what it cannot determine.
- **The form now refuses out loud.** A validation failure that returns silently
  is indistinguishable from a broken button (rule AH: an action's message
  belongs beside its controls).

**Why this does not reopen Revision 40's refusal.** The derivation never writes.
The row keeps its NULLs until an administrator saves the dialog, so the guess is
never persisted as though it were typed — it is *offered to a human who knows
the person's name, in a field she can correct before it becomes a fact*. That is
the one thing a migration could not do, and it is exactly why Revision 40 said
no to the migration and not to the split itself. A later contract phase (TD-6b)
inherits a table whose parts were all confirmed by somebody.

The derivation is pinned by `lib/person-name.test.ts` and by an HTTP test that
asserts the stored row is **still NULL** after the read that derived from it.

### Sorting by either part, without backfilling

The same NULL parts that broke the edit dialog also broke *ordering*. A table
sorted by `last_name_arabic` would group every pre-Revision-40 row under NULL —
which is not «sorted by family name», it is «sorted by whether anybody has
edited this person yet».

Ordering has to be a Prisma `orderBy` (`lib/sorting.ts` is emphatic that the
database sorts, because TD-10 paginates), and Prisma cannot order by an
expression. So the derivation is expressed **once more, in SQL**, as two
`GENERATED ALWAYS … STORED` columns — `first_name_sort` and `last_name_sort` —
indexed under `ar-x-icu`.

Three properties keep them from becoming a second source of truth:

- **Nothing can write them.** Postgres rejects any attempt, so they cannot drift
  from `first_name_arabic` / `last_name_arabic` / `name_arabic`.
- **They are never projected into a DTO.** What a reader sees still comes from
  `splitComposedName`, so the wire carries one answer to *what is her family
  name*.
- **They are not contract fields.** `sort_by=first_name_sort` is refused like
  any other name outside the allow-list — the column is an implementation
  detail, and a test asserts the refusal.

Revision 40's refusal is untouched: nothing is backfilled, and the stored parts
stay NULL until an administrator confirms them.

## The guards

| Guard | What it pins |
|---|---|
| [`lib/qr-identity.test.ts`](../../backend/src/lib/qr-identity.test.ts) | the versioned `user:` scheme · no PII and no role in the payload · round-trip and refusal of foreign payloads · parsing yields a reference, never a user · deterministic and per-person matrices |
| [`services/qr-identity.integration.test.ts`](../../backend/src/services/qr-identity.integration.test.ts) | ten populations each get one · not the primary key · **a raw SQL INSERT still gets one** · the table-wide invariant · stability across role add/remove, several roles at once, enrolment, beneficiary status, FamilyLink, soft delete and restore · which surface serves whom · no credential derivable |
| [`lib/guardian-portal.test.ts`](../../frontend/src/lib/guardian-portal.test.ts) | the gate matches `role-home`'s intent · a parent with no child selected is refused · no student role granted and no module's `roles` widened · a teacher or admin acting for a child is still refused · omitting the context is today's behaviour · every beneficiary module declares `childContext` |
| [`scripts/dev/browser/verify-guardian-child.mjs`](../../scripts/dev/browser/verify-guardian-child.mjs) | a parent-only account driven through the switcher: her own QR, then **two** children in turn, each showing that child's own `user_qr_ref` and caption, then back to her own — plus a forged unrelated child and a revoked link, both refused |
| [`scripts/dev/browser/verify-user-qr.mjs`](../../scripts/dev/browser/verify-user-qr.mjs) | four identities each seeing their own square on a real screen · four distinct payloads · the "identifies only" wording · child context serving the child · the child seeing the same identity herself · the reference refused as a credential with cookies cleared |
