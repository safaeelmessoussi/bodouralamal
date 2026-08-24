[Documentation](../README.md) › [Architecture](README.md) › **Security**

# Security

The posture as a whole. Mechanisms specific to logging in and being authorized live in
[Identity and access](identity-and-access.md); this page covers everything that cuts across
the system.

## Threat model, honestly stated

This is a small platform holding **records about children** for a Moroccan charity. It is
not a high-value financial target, and pretending otherwise leads to security theatre. The
threats that actually matter here are:

| Threat | Why it matters here | Primary defence |
|---|---|---|
| **A staff account is compromised or misused** | It reaches minors' case files | Per-request freshness assertions; audited reads; branch scoping |
| **A parent probes for other children** | Enumeration of minors | Uniform `404`; no parent-facing search over children |
| **A stolen session cookie** | 30-day credential | Rotation with reuse detection that kills the whole session |
| **Login races account rejection or suspension** | Stale session-bearing state could mint a fresh session after revoke-all | User-row serialization; authoritative status re-read before issuance |
| **Registration races staff pre-provisioning** | One verified email could become attached to two different accounts through separate tables | Shared normalized-email row lock; cross-channel re-read inside each ownership transaction |
| **A recording is published without consent** | Safeguarding and legal exposure | Continuously re-evaluated monotonic consent gate; exact-row authorization on the only public object origin; forced bucket migration |
| **Data leaves Moroccan infrastructure** | Law 09-08 violation | Fixture-only rule outside Morocco; Moroccan backup target |
| **An implementation shortcut regresses one of the above** | The most likely of all | CI guards; tests that assert the *security property*, not the code path |

That last row is not a joke. Most of the guards described here exist because something
plausible-looking was nearly shipped.

## Transport and headers

Everything is one origin behind Nginx, under one Let's Encrypt certificate.

**No CORS headers are emitted. Anywhere. In any environment.** Because client, API, and
storage share an origin, cross-origin requests are not part of normal operation. The staging
frontend runs against mocks and calls no real backend, which is what deletes the last
exception that would otherwise have existed.

The MinIO public bucket's anonymous policy is likewise not a second external origin:
production publishes Nginx only. Canonical public GET/HEAD requests pass an internal API
subrequest that requires an exact live public/public database coordinate with no committed
consent lock. Browser-writable public staging has a separate signed-PUT location and refuses
reads. A consent flag, replacement or deletion therefore revokes the stable origin before
eventual copy/delete work completes, and direct object-store access remains network-internal.

Nginx sets on client responses:

```
Content-Security-Policy: default-src 'self';
                         media/img/connect limited to 'self'
                         (which covers /storage/ by same-origin)
                         plus the Google OAuth endpoints
X-Content-Type-Options: nosniff
frame-ancestors 'none'
```

The CSP has a design consequence worth knowing: **no web font can be loaded**, because there
is no font host in the policy. A linked face would be blocked and silently fall back. This
turned out to be the right constraint anyway — an inlined Arabic face costs 200 KB–1 MB
against users on unreliable connections.

### Cookie attributes never vary by environment

`HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` in development, staging, and production
alike. The Path admits exactly the two refresh-cookie consumers, `/auth/refresh` and
`/auth/logout`; both enforce the same custom-header and Origin checks before reading it.
Environment-conditional downgrades — `SameSite=None`, dropping `Secure`, wildcard CORS with
credentials — are **prohibited**.

The specification names the failure mode directly: *an agent "fixing" staging cookies by
weakening them is introducing a CSRF vulnerability, not fixing a bug.* The staging frontend
is cross-origin with the local backend, so the refresh cookie will not flow between them —
**by design, and not a bug to fix.** Authenticated flows are tested against the local
same-origin stack and the production rehearsal, never through the staging origin.

Local development terminates at HTTP on `localhost`, which browsers treat as a secure
context — so the `Secure` cookie is delivered normally without weakening a single attribute.

### The external identity assertion is verified, not decoded

Google's token endpoint is a transport boundary, not proof that a JWT payload is authentic.
The callback consumes identity only after the supported Google verifier has checked the
RS256 signature against the provider's cached signing keys, exact issuer, configured
audience and token lifetime; the application then requires a non-empty subject and a
verified email. See [the complete boundary](identity-and-access.md#the-google-identity-trust-boundary).
Any verification or signing-key retrieval failure stops before account lookup and returns
the existing generic OAuth-unavailable redirect. Raw ID tokens, emails and provider errors
never enter logs.

## No existence leaks

**`404` for both "does not exist" and "outside your scope". Never `403`, never a
distinction.**

`403` tells the caller *the thing exists and you may not see it* — precisely the fact that
must not leak about:

- a minor's record
- a family link that is pending, rejected, or belongs to a different parent
- another branch's data

The same principle governs the refresh endpoint, where every refusal reason returns one
indistinguishable `401`, and the family-link error code, whose definition is **restricted to
own-resource contexts** so a duplicate staff-created link answers `DUPLICATE` rather than
disclosing a link's review state.

> §20 rule 17 · [API](api.md#the-404-for-out-of-scope-rule)

## Personal data

### In logs

**No PII in logs, ever.** Log user ids, never names, phones, or emails. Never log request
bodies on registration or consent endpoints. Never log a child-context header value beside
identifying data.

Structured JSON logs carry a `request_id` that is propagated into every error envelope and
job record, so a user-reported error is traceable end to end **without** logging who the
user is.

### In tokens

No PII beyond the claims listed in [Identity and access](identity-and-access.md#jwt-claims).
No email in the token. The active child is never a claim.

### In fields that were considered and rejected

`RefreshToken` deliberately omits `created_by_ip` and `user_agent_hash`. Both are personal
data on a population that includes minors, with **no consumer** — there is no session
management screen — and **no retention rule**. A user-agent hash would additionally impose a
session-binding rule that nothing states, breaking legitimate browser upgrades.

The reasons are recorded in the specification specifically so a later implementer does not
add them by reflex.

### On public surfaces

The **public display identity invariant** governs every public surface — the calendar, event
details, educational content, announcements, certificates, and every surface not yet built.

> The **backend** resolves which name to publish: the chosen public name when set, otherwise
> the person's full name. The API returns the resolved value under `display_name`, and
> **clients render it verbatim.**

A client must never implement the fallback, and must never receive both inputs in order to
choose between them. Two implementations of one rule eventually disagree, and here
disagreement means publishing a legal name where someone asked for a kunya — a failure the
interface does not reveal to the person it affects.

This is enforced structurally as well as by rule: the frontend type does not carry the raw
fields at all, so a client that cannot see them cannot choose between them. A CI guard fails
the build on the raw fields reaching the frontend, on an inline fallback anywhere, and on a
controller exposing both inputs outside the one admissible staff screen.

> SRS §7 · §20 rule 21 · `scripts/ci/check-display-identity.sh`

## Data residency

Moroccan law 09-08 requires personal data about Moroccan citizens to stay on Moroccan
infrastructure. Enforced as [`BR-18`](../reference/business-rules.md#br-18), and it
constrains the topology rather than just the policy:

- Production is a **Moroccan VPS**; backups replicate to a **second Moroccan location**.
- **Production dumps are never copied to development or staging.**
- The staging frontend is hosted outside Morocco and therefore runs against **fixture mocks
  only**, calling no real backend.
- Development fixtures are guarded by an environment check and **refuse to run in
  production** — the same guard is the residency firewall.

> [Environments](../operations/environments.md)

## Rate limiting, in two layers

The layers exist because one of them **cannot** do the other's job.

| Layer | Keyed on | Enforces | Where |
|---|---|---|---|
| **Nginx** | IP | Auth endpoints 10/min · general API 120/min | Edge |
| **Application** | **Authenticated user** | Upload initiations **30/hour** | PostgreSQL |

Nginx's rate limiting keys on connection variables and **cannot read a token subject**; its
grammar admits only `r/s` and `r/m`, so an hourly quota has no representation there at all.

The per-user quota is therefore counted in PostgreSQL, incremented **inside the same
transaction as the action it gates**, under a row lock. Three alternatives are explicitly
prohibited, each with its reason:

- **In-process memory** — dies with the container, wrong across replicas.
- **The job queue** — a queue is asynchronous; a quota decision must be synchronous and
  transactional with the request.
- **An Nginx scripting module** to drag it back to the edge.

A quota rejection returns `429` in the standard envelope, identically to an edge rejection,
so clients handle one shape.

## Storage

- **The private bucket is never exposed via a stable URL.** Every read is a short-lived
  (10-minute) presigned URL, minted **only after** a server-side permission check including
  child context.
- **Public bucket policies are never used to serve private content**, and long-lived
  presigned links are prohibited.
- Upload PUT capabilities address disposable `staging/content/...` keys only. Completion
  binds HEAD, the 512-byte magic read and server-side promotion to one storage ETag, then the
  database names a distinct canonical key for which no client received write authority.
  Reusing a still-valid PUT can therefore change staging but not accepted bytes.
- The published public-bucket proxy is an explicit method boundary, not a general S3
  endpoint: exact canonical GET/HEAD is database-authorized, PUT requires MinIO SigV4, every
  other method is refused by Nginx, and both public bucket-root spellings are denied before
  query parameters can become listing/control operations. Public staging admits only signed
  PUT and is never readable.
- Declared content type is not trusted. Size comes from object metadata and magic bytes from
  the conditional ranged read; mismatch creates no record.
- Storage keys are **immutable**; a replacement mints a new key. Visibility is **never
  encoded in the key** — the bucket carries it.

> [Storage](storage.md)

## Secrets

- All configuration flows through environment variables or the settings table. **Nothing is
  hardcoded.**
- **Secrets have no defaults, by design** — a secret that silently defaults is a
  vulnerability, not a convenience.
- The application **fails fast at boot**, naming the missing variable, so a misconfigured
  deployment stops immediately rather than failing later inside a request.
- Secrets never appear in logs, error payloads, or the API contract.
- A CI guard fails the build if an `.env` file is ever committed.

> [Configuration](../operations/configuration.md)

## Input validation

Zod schemas at every API boundary are **the single place** field limits are encoded, and
those constants are shared with the frontend so the UI mirrors rather than duplicates them.

One validation rule is worth calling out because it is a security rule wearing a validation
costume: a branch's map URL **must be an absolute `https://` URL**. The value becomes an
outbound link on a public page, so a relative or `javascript:` value there is an injection
vector rather than a typo.

## Auditing as a security control

The audit log is not a debugging aid. It is the accountability record, and three properties
make it one:

**Append-only.** No update path and no application-level delete path exists. One job is the
single sanctioned deletion route.

**Selection by allowlist, never by age alone.** Retention deletes only rows matching **both**
an *enumerated* action-type allowlist **and** the 12-month horizon. A glob is not an
allowlist: `auth.*` prefix matching would silently sweep in any future action beginning with
`auth.` — post-MVP local authentication adds several — without anyone deciding it was
purgeable. Age-only deletion and prefix matching are both prohibited, and a test asserts
that indefinitely-retained security events survive the job untouched.

**Reads are audited where reads are sensitive.** Viewing a child's case file writes an audit
row. In a safeguarding context, *who looked* is as important as *who changed*.

The underlying principle is stated as an invariant: for anything revocable, **who, when, and
why must be reconstructable from the audit log alone** — without reading the affected row,
which may have been purged or overwritten. That is why revocation-bearing entities carry no
`revoked_by` column: a duplicated actor is two records that can disagree.

A revocation path that mutates state without its audit row **in the same transaction** is
non-compliant, not merely under-logged.

The same atomicity applies at login. Successful `auth.login`, the new refresh anchor/token,
and the authoritative account/role read share one User-locked transaction. If its mandatory
audit write fails, the new session rolls back and no cookie or access token is returned. A
user-wide suspension takes that same User lock before status mutation and then locks session
anchors in UUID order, so revoke-all cannot miss a concurrently inserted session.

First identity binding and role switching use that boundary too. Binding re-reads the matched
account under the User lock before creating either the provider identity or its mandatory audit,
so a suspension that wins cannot leave a ghost binding. Role switching re-reads current Active
state and role assignments under the lock, and its token can never expire after the verified
bearer that authorized the switch; it changes capacity but cannot substitute for refresh after
logout. At the PostgreSQL layer this governing lock is `FOR NO KEY UPDATE`, deliberately
compatible with the implicit User `KEY SHARE` taken by refresh/logout FK inserts while still
serializing every non-key account mutation.

## The guardrails

Twenty-one numbered rules close the document the specification ends with, deliberately —
they are the last thing an implementer reads before writing code. Each one blocks a
plausible-looking shortcut that would cause data corruption, a safeguarding failure, or a
vulnerability.

The security-relevant ones, in brief: never store consent as a boolean · never expose
private-bucket resources statically · never trust child context without verifying both
parties · never let a teacher lift a consent lock or assign global scope · never widen the
permission matrix without a revision · never show a registration form before OAuth completes
· never read identity from a body when a token carries it · never distinguish "not found"
from "out of scope" · never log PII or commit secrets · never move real data outside Morocco
· never resolve a public display identity in a client.

> Full text: SRS §20 · Nine of these are enforced by
> [CI guards](../development/ci-cd.md#the-guards).

---

**Next:** [Storage](storage.md) · **Related:**
[Identity and access](identity-and-access.md), [Environments](../operations/environments.md)
