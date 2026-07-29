[Documentation](../README.md) › [Overview](README.md) › **Purpose and context**

# Purpose and context

## The association

**جمعية بذور الأمل** — *Bodour Al-Amal*, "Seeds of Hope" — is a nonprofit educational
association based in **Marrakesh, Morocco**. It runs an institute teaching three things:

- **تحفيظ القرآن الكريم** — Quran memorization
- **العلوم الشرعية** — Islamic studies (Tafsir, Fiqh)
- **محو الأمية** — adult literacy

Its beneficiaries are **women, teenagers, and children**, taught in small cohorts at
physical branches around the city. Instruction is in person, in Arabic, on a fixed weekly
timetable.

## The problem

The institute runs on paper registers and spreadsheets. Three activities cost the most and
break the most often:

| Activity | How it works today | What goes wrong |
|---|---|---|
| **Scheduling** | A weekly timetable maintained by hand | Room double-bookings; a schedule change reaches people by word of mouth or not at all |
| **Account approval** | Registration on paper, decided in person | No record of who approved what, or when |
| **Grade tracking** | Per-teacher spreadsheets | Memorization coverage is recomputed by hand and gets it wrong; a corrected mark does not propagate |

The platform replaces exactly these three, for the association's **first live branch
cohort**. It is not an attempt to digitize the whole organisation at once — see
[Scope and roadmap](scope-and-roadmap.md) for what was deliberately left out and why.

## Who uses it

| | |
|---|---|
| **Staff** | A Super Admin, branch Admins, and the مؤطِّرات (instructors) who teach and mark |
| **Beneficiaries** | Adult students directly; teenagers and children **through a parent's account** |
| **The public** | Anyone visiting the site: the branch directory, the calendar, and public resources are open |

Full detail: [Users and roles](users-and-roles.md).

## Sizing

The platform is built for **~900 users at launch**, against a **5,000-user design ceiling**
it must reach without re-architecture. That is a small system by any modern standard, and
saying so plainly is load-bearing: it is the reason there is no cache layer, no read
replica, no search cluster, and no horizontal scaling machinery. Building any of those here
would be a defect, not foresight. See [Performance and scale](../architecture/performance-and-scale.md)
and SRS §2.4.

## The four constraints that shaped everything

Almost every non-obvious decision in this codebase traces to one of these. When a design
choice looks strange, check here first.

### 1. Data residency — Moroccan law

Moroccan law **09-08** and the CNDP require personal data about Moroccan citizens to remain
on Moroccan infrastructure. The consequences run deep:

- Production runs on a **VPS from a Moroccan provider**, not on AWS, GCP, or Azure.
- Backups replicate to a **second Moroccan location**, never abroad.
- The staging frontend is hosted outside Morocco, so it is **forbidden from ever touching
  real data** — it runs against mocks only.
- No managed cloud service — no hosted Postgres, no S3, no CDN — is available to us. Hence
  PostgreSQL and MinIO in containers on one box.

> Enforced as [`BR-18`](../reference/business-rules.md#br-18); topology in
> [Environments](../operations/environments.md).

### 2. Connectivity — unreliable mobile networks

Beneficiaries are on mobile connections that drop. This is why:

- Large-file operations are minimised, and audio uploads are capped at **100 MB**.
- **No web font is loaded** — an Arabic face costs 200 KB–1 MB, so the design gets its
  character from scale, weight, and rhythm instead ([Design system](../architecture/design-system.md)).
- The calendar screen makes **two requests, never a third** — reference data arrives in one
  composite document precisely because four sequential round trips are four chances to
  stall ([Calendar](../architecture/calendar-and-hijri.md)).

### 3. Digital literacy — and the Google-only decision

Authentication is **Google OAuth and nothing else**. There are no passwords anywhere in the
system — no hashes, no reset flows, no password columns "for later".

This is genuinely uncomfortable, and the specification says so. A meaningful share of the
beneficiaries are *in an adult literacy programme*; some own no smartphone and no email
address. **The decision structurally excludes people the association exists to serve.**

It was taken anyway, for the MVP only, because the alternative — building credential
storage, reset flows, and staff-assisted recovery for a population that cannot receive a
reset email — is a larger and more dangerous piece of work than it appears. The mitigations
are real and tracked:

- Staff assist beneficiaries in creating a Google account during in-person registration.
- Staff can **pre-provision** an account against someone's email, which binds on that
  person's first login — so the record exists before the person ever logs in.
- **Local username/password authentication is the first post-MVP item**, and the identity
  layer is provider-abstracted specifically so it can be added without touching `User`.

> Recorded as **Risk R-1 (HIGH)** in SRS §11, with an instruction that has teeth: *if the
> registration drive surfaces a large excluded population before launch, escalate — do not
> launch a system the first cohort cannot log into.*

### 4. Safeguarding — most records are about children

Minors have **no login of their own**. A child exists as a student record reachable only
through an approved link to a parent's account, or through a staff role. Three mechanisms
carry this:

- **Every request** that touches a child's data re-verifies the parent-child link against
  the database. Not the session, not the token — the request.
- **Consent is a versioned record**, never a boolean. Absence of a record means *no
  consent*, always ([`BR-1`](../reference/business-rules.md#br-1)).
- **Out-of-scope access returns `404`, never `403`**, so a response can never confirm that
  a particular child exists.

> [Identity and access](../architecture/identity-and-access.md) ·
> [Security](../architecture/security.md) · [`BR-5`](../reference/business-rules.md#br-5),
> [`BR-16`](../reference/business-rules.md#br-16)

## One institute, deliberately

The platform is a **strict single-tenant application**. There is no tenancy dimension
anywhere — no tenant tables, no tenant columns, no tenant claim in a token.

An earlier revision of the specification did carry a multi-tenant-ready design. It was
**removed entirely** (Revision 11), because one association at this scale gains nothing
from dormant tenancy plumbing while paying for it in every query and every scoping bug.

The trade-off is recorded rather than hidden: onboarding a second institute means a
**separate deployment** — its own VPS, database, and domain — or a deliberate
re-architecture. There is no dormant layer to switch on, and reintroducing tenant columns
speculatively is prohibited.

## How the project is built

Development is **specification-first**. [`SRS.md`](../SRS.md) is the authoritative
requirements document, currently at **Revision 37.2**; the code conforms to it rather than
the reverse. It is immutable to contributors and to AI agents, and changes only through a
numbered revision approved by the Document Owner.

Where the specification is silent or self-contradictory, the rule is to **stop and
escalate**, never to invent behaviour. Resolved ambiguities become revision entries — which
is why the [decision log](../reference/decision-log.md) reads as a history of arguments
rather than a changelog.

---

**Next:** [Users and roles](users-and-roles.md) · **Related:**
[Scope and roadmap](scope-and-roadmap.md), [System overview](../architecture/system-overview.md)
