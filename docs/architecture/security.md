[Documentation](../README.md) › [Architecture](README.md) › **Security**

# Security

Cross-cutting posture; login and authorization live in [Identity and access](identity-and-access.md).

## Threat model, honestly stated

Records about children for a Moroccan charity, not a financial target.

| Threat | Primary defence |
|---|---|
| staff account compromised (reaches minors' case files) | per-request freshness assertions; audited reads; branch scoping |
| a parent probes for other children | uniform `404`; no parent-facing search over children |
| a stolen session cookie (30-day credential) | rotation with reuse detection that kills the whole session |
| login races rejection or suspension | User-row serialization; authoritative status re-read before issuance |
| registration races staff pre-provisioning (one email on two accounts) | shared normalized-email row lock; cross-channel re-read inside each ownership transaction |
| last accountable owner disabled, or two transfers race | protected singleton; owner-first/deterministic locks; DB eligibility/lifecycle triggers; atomic transfer |
| a recording published without consent | re-evaluated consent WARNING before recording and beside the visibility control (R170 §3, nothing forced); exact-row authorization on the only public object origin |
| beneficiary data leaves Moroccan infrastructure (Law 09-08) | no Production copies outside Morocco; Staging admits only the exact R115 Owner staff identity |
| an implementation shortcut regresses one of the above (the most likely) | CI guards; tests asserting the security property |

## Transport and headers

- One origin behind Nginx, one Let's Encrypt certificate; no CORS headers in any environment; Preview runs on mocks, Staging is same-origin controlled UAT.
- The MinIO public bucket is not a second origin: production publishes Nginx only; canonical public GET/HEAD passes an internal API subrequest requiring an exact live public/public database coordinate with no committed consent lock; public staging is a separate signed-PUT location refusing reads; a consent flag, replacement or deletion revokes the origin before copy/delete completes; the object store stays network-internal.
- Nginx headers: `Content-Security-Policy: default-src 'self'` with media/img/connect limited to `'self'` (covers `/storage/`) plus the Google OAuth endpoints; `X-Content-Type-Options: nosniff`; `frame-ancestors 'none'`. Consequence: no web font can load (no font host in the policy); an inlined Arabic face would cost 200 KB–1 MB.
- Cookies: `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` in every environment; the Path admits only `/auth/refresh` and `/auth/logout`, both enforcing the same custom-header and Origin checks; `SameSite=None`, dropping `Secure` and wildcard CORS with credentials are prohibited (CSRF); Staging gets no exception; `localhost` over HTTP is a secure context.
- Google identity is verified (RS256 signature, issuer, audience, lifetime), not decoded ([boundary](identity-and-access.md#the-google-identity-trust-boundary)); a failure stops before account lookup with the generic OAuth-unavailable redirect; raw ID tokens, emails and provider errors never enter logs.

## No existence leaks

- `404` for both «does not exist» and «outside your scope»; never `403` (it would confirm a minor's record, a pending/rejected/foreign family link, or another branch's data).
- The refresh endpoint returns one indistinguishable `401` for every refusal; the family-link error code is restricted to own-resource contexts, so a duplicate staff-created link answers `DUPLICATE` without disclosing review state.
- §20 rule 17 · [API](api.md#the-404-for-out-of-scope-rule).

## Personal data

- Logs: no PII; user ids, never names, phones or emails; never request bodies on registration or consent endpoints; never a child-context header beside identifying data. Structured JSON logs carry `request_id` (in every error envelope and job record), created at the edge, ignoring a caller's `X-Request-Id`; neither Nginx nor Express logs a raw URI/path or client address (Express records the route template, a constant for unmatched); raw exception messages are excluded.
- Tokens: no PII beyond the [JWT claims](identity-and-access.md#jwt-claims); no email; the active child is never a claim.
- Rejected: `RefreshToken` omits `created_by_ip` and `user_agent_hash` (personal data on minors, no consumer, no retention rule; a UA hash breaks browser upgrades).

### On public surfaces

- Public display identity invariant (SRS §7, §20 rule 21): the backend resolves the chosen public name, else the full name, as `display_name`; clients render verbatim, never implement the fallback, never receive both inputs.
- The frontend type carries no raw fields; `scripts/ci/check-display-identity.sh` fails on raw fields reaching the frontend, any inline fallback, or a controller exposing both inputs outside the one admissible staff screen.

## Data residency

- Law 09-08 as [`BR-18`](../reference/business-rules.md#br-18): Production on a Moroccan VPS, backups to a second Moroccan location; Production dumps never reach development or staging.
- Preview and Staging are outside Morocco: Preview on fixture mocks only; Staging on synthetic fixtures plus the exact R115 Owner staff identity for OAuth UAT, no real beneficiary, educational or content data.
- Development fixtures refuse to run in production (environment check = residency firewall; [environments](../operations/environments.md)).

## Rate limiting, in two layers

| Layer | Keyed on | Enforces | Where |
|---|---|---|---|
| Nginx | IP | auth endpoints 10/min · general API 120/min | edge |
| Application | authenticated user | upload initiations 30/hour | PostgreSQL |

- Nginx cannot read a token subject and admits only `r/s` and `r/m`, so the per-user quota is counted in PostgreSQL inside the gated action's transaction under a row lock; prohibited: in-process memory, the job queue (asynchronous), an Nginx scripting module.
- A quota rejection is `429` in the standard envelope, identical to an edge rejection.

## Storage

- The private bucket has no stable URL: every read is a 10-minute presigned URL minted after a server-side permission check including child context; public bucket policies never serve private content; long-lived presigned links are prohibited.
- Upload PUTs address disposable `staging/content/...` keys only; completion binds HEAD, the 512-byte magic read and server-side promotion to one storage ETag, then the database names a canonical key no client can write.
- The public-bucket proxy is a method boundary: canonical GET/HEAD database-authorized, PUT requires MinIO SigV4, other methods refused by Nginx, both bucket-root spellings denied before query parameters become listing/control operations; public staging admits signed PUT only; every proxy path rejects the unsigned streaming-trailer content-hash mode (defence in depth; Production remains blocked on the [object-store decision](storage.md#owner-decision-required--object-store)).
- Declared content type is not trusted: size from object metadata, magic bytes from the conditional ranged read; mismatch creates no record.
- Keys are immutable (a replacement mints a new key); the bucket carries visibility, never the key ([storage](storage.md)).

## Secrets

- All configuration through environment variables or the settings table; nothing hardcoded; secrets have no defaults.
- Boot fails fast naming the missing variable; secrets never appear in logs, error payloads or the API contract; a CI guard fails a committed `.env` ([configuration](../operations/configuration.md)).

## Input validation

- Zod schemas at every API boundary are the single place field limits live; the constants are shared with the frontend.
- A branch's map URL must be an absolute `https://` URL (it becomes an outbound link on a public page; `javascript:` would be injection).

## Auditing as a security control

- Append-only: no update or application delete path; `audit.purge` is the single deletion route, by enumerated action-type allowlist AND the 12-month horizon; age-only deletion and prefix matching (`auth.*`) are prohibited; a test asserts retained security events survive.
- Sensitive reads are audited (viewing a child's case file writes a row).
- For anything revocable, who, when and why are reconstructable from the audit log alone; no `revoked_by` column; a revocation without its audit row in the same transaction is non-compliant.
- The shared repository rejects detail keys copying display identity, contact values, free-text titles/labels, filenames or exact storage locators (recursive; fails the domain transaction); callers record entity ids, changed field names or a SHA-256 storage-coordinate id; required reason/justification text is not reinterpreted (TD-8/TD-14 reconciliation stays in `TASKS.md`).
- R141: a self-managed claim's rejection rationale lives only on the claim until erasure; copied rejection-reason fields were removed from `selfmanaged.reject` detail (rows kept); not a generic sanitizer.
- Login, suspension, first identity binding and role switching share the User-locked transaction with their mandatory audit write; a failed audit rolls the session back; a switch token never outlives the authorizing bearer and cannot replace refresh after logout ([lock hierarchy](identity-and-access.md#rotation-three-outcomes)).

## The guardrails

SRS §20's twenty-one rules; security-relevant: never store consent as a boolean · never expose private-bucket resources statically · never trust child context without verifying both parties · never let a teacher lift a consent lock or assign global scope · never widen the permission matrix without a revision · never show a registration form before OAuth completes · never read identity from a body when a token carries it · never distinguish «not found» from «out of scope» · never log PII or commit secrets · never move real data outside Morocco · never resolve a public display identity in a client. Nine are enforced by [CI guards](../development/ci-cd.md#guards-scriptscicheck-sh--each-proven-by-reintroducing-its-bug).

---

**Next:** [Storage](storage.md) · **Related:** [Identity and access](identity-and-access.md), [Environments](../operations/environments.md)
