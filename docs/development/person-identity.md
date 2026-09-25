[Documentation](../README.md) › [Development](README.md) › **Person identity**

# Person identity — the QR, and what it is not

Cites [`docs/SRS.md`](../SRS.md) §4.3, BR-5 and Revisions 62, 79, 96; the SRS wins.

## Three identifiers, three jobs

| Value | Shape | Who has one | For |
|---|---|---|---|
| `User.id` | random UUIDv4 | everyone | the row; every FK; never printed |
| `User.referenceCode` (R62; every beneficiary since R170 §7) | `BA-7K4M2` | every live beneficiary, adults included, minted by the row's own trigger; staff none | spoken — telephone, paper; found by «المستخدمون»'s search as said |
| `User.qrRef` (R96) | random UUID | everyone, `NOT NULL UNIQUE` | scanned — the QR payload |

- None authorises anything (R62.5 for the second, restated by R96 for the third).
- Not `User.id`: a card must be rotatable (the id is referenced by every FK; rotating `qr_ref` is one `UPDATE`), and the row's identity and the card value must be able to diverge (§20 rule 22).
- Not `referenceCode`: five characters from a 31-symbol alphabet without `0/O`, `1/I/L` (read aloud, hand-copied; 31⁵ ≈ 28.6 million); by R62 a beneficiaries' code.
- Closed defect (R170 §7, Owner 2026-09-21 «every beneficiary gets one»): `allocateReferenceCode` had one call site (`child-application.service.ts`), so self-registered adults, admin-created accounts and seeds had none. Now trigger `user_beneficiary_reference_code_fill` mints the shape whenever a live row becomes a beneficiary without one; CHECK `user_beneficiary_reference_code_check` holds the rule (a de-identified row is exempt — R133 clears its code); the migration back-filled existing beneficiaries; `lib/reference-code.ts` keeps the application-side generator for the one path minting ahead of insert; `spokenReferenceCode` turns «7k4m2» / «ba7k4m2» into the stored form for search.

## Every person

- `user_qr_ref` is `NOT NULL UNIQUE`, no conditional, no partial index; population = every `User`.
- Minors are `User` rows with no `UserIdentity` (§4.3/BR-5), reached through an approved `FamilyLink`; no dependent exists without a `User`.
- Default is the database's `gen_random_uuid()`, not Prisma's: the integration suite inserts a row in SQL without naming the column and reads back a reference.

## Whose identity a surface shows

| Surface | Subject | Serves |
|---|---|---|
| `/profile` | JWT `sub` | the account holder — a parent gets her own |
| beneficiary account view | `childContext` (§4.3) | the acting student — under child context, the child |

- Never silently exchanged; each square is captioned with whose it is.

### A guardian reaches her child's screens (fixed 2026-08-20)

- R96 shipped with a `parent`-only account unable to open any beneficiary-portal screen: `role-home.ts` sent her to `/dashboard/student`, `canAccess` gated every beneficiary module on `roles: ['student']` → «ليست لديك صلاحية لعرض هذه الصفحة».
- Fix in the shared gate: `PortalModule` gains `childContext`; `canAccess(module, roles, { actingForChild })` admits when `module.roles ∩ roles ≠ ∅` OR (`module.childContext && actingForChild && roles includes 'parent'`).
- She gains no student role; no module's `roles` widened; `actingForChild` defaults `false` (existing callers unchanged); the predicate names the `parent` role itself (rule AE); `childContext` is REQUIRED on `StudentModule`.
- Authorization did not move: the approved `FamilyLink` is verified against `X-Active-Child-ID` on every request (§4.3); forged child and revoked link → 404; `ActiveChildProvider` reconciles the stored id against `/me`'s links, so a revoked link leaves the context `null` on next load.

## It identifies; it never authenticates

- Payload `bodour:user:v1:<uuid>`: no name, email, phone, sex, Branch, Level, enrolment, role.
- The harness offers the reference as bearer and as refresh token with every cookie cleared; both refused (the first version left the session cookie set and `/auth/refresh` answered `200` from the cookie — a credential test must leave no credential lying around).

## Anticipated, deliberately absent

- Reception lookup, attendance/check-in, quick beneficiary search, staff identification, linking physical documents: none implemented; whatever is built on a scan authorises itself.

## The name parts, and the rows without them

- R40 split the Arabic name into الاسم الشخصي + الاسم العائلي, kept `name_arabic` as the server-composed whole, and refused a whitespace backfill (a guessed part would be indistinguishable from a typed one) — the refusal stands.
- Pre-R40 accounts and composed-only write paths (seeds, most fixtures) carry NULL `first_name_arabic` / `last_name_arabic`; `تعديل بيانات المستخدم` requires both, so `حفظ` failed silently.
- `splitComposedName` ([`lib/person-name.ts`](../../backend/src/lib/person-name.ts)) derives parts at READ time in `userDto` and the directory projection: splits at the first space («عبد الله» is one given name), returns `null` never `''`; it never writes — the guess is offered to a human who corrects it before it becomes a fact (TD-6b inherits confirmed parts). The form now refuses out loud (rule AH).
- Pinned by `lib/person-name.test.ts` and an HTTP test asserting the stored row is still NULL after the deriving read.

### Sorting by either part, without backfilling

- Ordering must be a Prisma `orderBy` (`lib/sorting.ts`: the database sorts, TD-10 paginates) and Prisma cannot order by an expression, so the derivation is repeated in SQL as `GENERATED ALWAYS … STORED` columns `first_name_sort` / `last_name_sort`, indexed under `ar-x-icu`.
- Not a second truth: Postgres rejects writes to them; never projected into a DTO; not contract fields (`sort_by=first_name_sort` refused like any name outside the allow-list, asserted).
- Nothing backfilled; stored parts stay NULL until an administrator confirms them.

## The guards

| Guard | Pins |
|---|---|
| [`lib/qr-identity.test.ts`](../../backend/src/lib/qr-identity.test.ts) | versioned `user:` scheme · no PII or role · round-trip, foreign payloads refused · parsing yields a reference never a user · deterministic, per-person |
| [`services/qr-identity.integration.test.ts`](../../backend/src/services/qr-identity.integration.test.ts) | ten populations each get one · not the primary key · raw SQL INSERT gets one · table-wide invariant · stable across role add/remove, several roles, enrolment, beneficiary status, FamilyLink, soft delete and restore · which surface serves whom · no credential derivable |
| [`lib/guardian-portal.test.ts`](../../frontend/src/lib/guardian-portal.test.ts) | gate matches `role-home` · parent with no child selected refused · no student role, no `roles` widened · teacher/admin acting for a child refused · omitted context = today's behaviour · every beneficiary module declares `childContext` |
| [`scripts/dev/browser/verify-guardian-child.mjs`](../../scripts/dev/browser/verify-guardian-child.mjs) | parent-only account: own QR, two children each with own `user_qr_ref` and caption, back to her own; forged child and revoked link refused |
| [`scripts/dev/browser/verify-user-qr.mjs`](../../scripts/dev/browser/verify-user-qr.mjs) | four identities, own square, four payloads, «identifies only» wording, child context serving the child, the child seeing the same identity, reference refused as credential with cookies cleared |
