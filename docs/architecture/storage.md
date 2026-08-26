[Documentation](../README.md) › [Architecture](README.md) › **Storage**

# Storage

The current implementation uses MinIO OSS, self-hosted in a container. Production requires
a maintained S3-compatible object store on Moroccan infrastructure; the final vendor/product
selection is an Owner decision recorded below.

> **Status:** the Nginx proxy, upload/replace/delete flow, permission-checked private mint,
> recording ingestion, durable R99 staging cleanup, consent re-evaluation and the
> consent-forced public → private `content.bucket-migrate` arm are built and tested. Bounded
> abandoned-upload GC and exact replacement/deletion retirement are also implemented. General
> visibility editing and automatic 90-day destruction remain open and are called out below
> rather than implied by the implemented safeguarding flow.

## OWNER DECISION REQUIRED — OBJECT STORE

The image is pinned to `minio/minio:RELEASE.2025-09-07T16-13-09Z`. MinIO's
[GHSA-hv4r-mvr4-25vw advisory](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw)
states that this final OSS line is affected and identifies a fix only in the maintained AIStor
release line. Production **must not launch on the current pin**: an edge filter reduces one
known request shape but cannot turn an unsupported, affected object-store release into a
maintained production dependency.

Safe replacement categories are:

1. a currently patched, supported MinIO AIStor release;
2. another maintained self-hosted S3-compatible object store deployed on approved Moroccan
   infrastructure; or
3. a maintained managed S3-compatible service only if the Owner and legal review establish
   Moroccan data residency, backup location, contractual controls and acceptable cost.

The lowest migration-risk recommendation is to evaluate the patched AIStor line first,
subject to licensing/support approval. If that is unsuitable, compare maintained alternatives
with a disposable compatibility proof before copying any real object. The replacement must
support path-style SigV4 presigning through the same-origin `/storage` prefix (including an
exact non-default Host port), ranged GET and HEAD, PUT, copy, delete, conditional reads/copies,
object metadata, object-atomic writes, idempotent deletion, the three existing bucket policy
shapes, the AWS SDK client, internal-only networking, health checks, and Moroccan primary and
backup residency.

After the Owner selects and pins a supported replacement, rerun: `nginx -t` and `nginx -T`;
the real signed private PUT/GET proxy round trip; signed public-staging PUT plus unsigned-read
denials; the canonical public exact-coordinate GET/HEAD and method/root denial matrix; the
complete B-01 safeguarding suite; B-02 placement and B-03 immutable finalization/replacement;
R99 recording ingestion; old-key retirement, deletion/replacement race and ambiguous-storage
recovery cases; upload/quarantine retention jobs; object-store health/readiness; and the
backup/restore drill. Do not approve Production from an API-compatibility claim alone.

## Two buckets, and the boundary between them

| Bucket | Holds | Served how |
|---|---|---|
| **public** | Canonical content whose visibility is `public`, plus disposable browser-upload staging | Canonical stable URLs pass an exact live-row authorization subrequest; staging is write-only at the public origin |
| **private** | All `private` and `hidden` content, **plus every group recording under a consent restriction** | **Never** a stable URL. Every read is a short-lived presigned URL minted after a server-side permission check |

**Visibility is never encoded in the storage key.** The bucket carries it. That is what
makes a visibility change a physical move rather than a rename, and it is why a key can
safely be immutable.

### One authority for placement

`EducationalContent.visibility` is the domain fact; `storage_bucket` is its physical
consequence. New uploads validate the requested/default visibility on the server and derive
the bucket from it. A replacement inherits the existing row's visibility — it changes the
file under R53/TD-9, not the visibility state under TD-1 — so neither an omitted value, a
Category default, nor a manipulated replacement request can select a different bucket.
Completion checks the signed ticket against that authoritative visibility again and discards
a contradictory object before any database write. The second check matters across deployments:
an already-issued ticket remains valid for up to two hours.

There is deliberately no literal-bucket `CHECK` on `educational_content`. A consent-forced
transition is asynchronous copy–verify–delete. Its explicit pending state is the existing
combination `consent_forced_private = true`, `visibility = public`, `storage_bucket = public`:
application reads fail closed while visibility and bucket continue to describe the physical
source honestly. A check equating the flag with private placement would reject that safe
state; a check changing visibility first would claim privacy while anonymous bytes still
exist. General visibility editing remains unbuilt and cannot use this safeguarding-only arm
as a publication path.

The public bucket's anonymous S3 policy is not the production access boundary. MinIO is
network-internal; Nginx is the only published object origin. Every canonical public GET/HEAD
asks the API whether one undeleted row still names that exact key as public/public with
`consent_forced_private = false`. A committed flag, replacement or deletion therefore closes
the stable public origin immediately even while object retirement is still pending. The
external method allowlist is deliberately smaller than the S3 API: canonical paths admit
database-gated GET/HEAD and SigV4 PUT only; `public/staging/` admits SigV4 PUT only, with
GET/HEAD sent to the unavailable page. Nginx refuses every other method before MinIO, so an
anonymous S3 Select POST, multipart/control operation or WebDAV-shaped request cannot turn
the download policy into a second read or mutation path. PUT remains delegated to MinIO's
signature check, preserving current staging uploads and still-live pre-R103 canonical
capabilities until their one-hour expiry. Current code never mints a browser write to a
canonical key, and legacy replacements are still refused at completion when their ticket
lacks the required compare-and-swap version.

As temporary defence in depth for the blocked current pin, every Nginx path that can proxy to
the object store shares one filter rejecting the advisory-named
`STREAMING-UNSIGNED-PAYLOAD-TRAILER` content-hash mode before upstream. It does not match the
signed streaming mode or ordinary presigned GET/PUT requests. This is not a substitute for a
supported patched object store, and verification deliberately asserts the defensive boundary
without constructing or replaying an exploit.

`/storage/public` and `/storage/public/` are bucket coordinates, not object coordinates, and
are denied by exact Nginx locations with or without query parameters. They are never
redirected: forwarding a `?list-type=2` query to another storage path would merely relocate
the bucket-listing exposure. Nginx's normalized location matching still selects these public
rules for duplicate or encoded separators, while the read authorizer receives the original
URI and therefore refuses any alternate spelling that is not the exact current DB
coordinate.

### Visibility changes move the object

Switching public content to private migrates the object to the private bucket and removes
the old public key. Anyone following a stale cached link gets a **friendly platform error
page** — *"This content's access has changed"* — implemented as an Nginx error-page mapping
on storage 403/404 responses.

**Never a raw XML S3 error.** A beneficiary following an old WhatsApp link should not meet
`<Error><Code>NoSuchKey</Code>`.

The migration runs as a background job (copy, full SHA-256 verify, delete — idempotent,
restart-safe). Object storage cannot join a database transaction, so the move is eventually
consistent. During the pending interval the consent flag closes both application reads and
the only published storage origin; only the network-internal public-bucket copy remains until
the worker retires it. The final transaction deletes that source before the row may say
`private`. A delete-succeeded/DB-rollback retry proves the already-copied private bytes from
their server-written SHA-256 before completing the row transition.

## Presigned URLs

| Operation | TTL | Notes |
|---|---|---|
| **GET** (private bucket) | 10 minutes | Minted only after the permission check, **including child context** where the requester is a parent |
| **PUT** (single-shot upload) | 1 hour | Initiated-but-never-completed uploads collected after 48 hours |

Previews use **the same mint path** as downloads. There is no separate preview endpoint and
no relaxed permission for thumbnails — an obvious-looking shortcut that would create a
second, weaker access path to the same objects.

### Signatures through the proxy

This is the piece that breaks silently if done carelessly.

Presigned URLs are generated **against the public storage origin**, so the signature matches
exactly what the browser sends through the proxy. The `/storage/` location must:

- strip the `/storage` prefix when forwarding to MinIO, and
- **rewrite the `Host` header consistently with the endpoint the signature was computed
  for, including any non-default port.** The proxy uses the exact incoming HTTP Host rather
  than Nginx's normalized host value.

Any mismatch between signed host/path and proxied host/path yields
`SignatureDoesNotMatch` — an error that looks like a credentials problem and is not.

A signed PUT plus signed GET round trip **through the proxy** is a mandatory acceptance
test, and it passes today. Verifying by talking to MinIO directly proves nothing: direct
access is the one path production never uses.

## Uploads

MVP uploads are **single-shot presigned PUT to a disposable staging key**, followed by a
server-controlled immutable finalization.

```
POST /uploads/initiate
  { filename, size, mime, content_meta }
  → branch scope validated HERE (a teacher passing "global" is refused)
  → per-user quota checked and incremented, under a row lock, in one transaction
  → PUT capability addresses staging/content/... — never the future content key
  → public-bucket staging accepts the signed PUT but is never anonymously readable
  → { upload_id, key, put_url }

  browser PUTs directly to storage through the proxy, with progress

POST /uploads/{upload_id}/complete
  → HEAD verifies size against the declared value and the caps
  → server opens one full staging GET (ETag conditional only as an ordinary race optimization)
  → prefix held until magic validation; exact length + SHA-256 cover the complete stream
  → mismatch → object deleted, no record created, 409 VALIDATION_FAILED
  → exact accepted stream is PUT into unique private staging/server-finalization/...
  → canonical 32-hex identity derives from finalization id + accepted SHA-256
  → server-owned object is streamed to canonical PUT and re-hashed end to end
  → server-finalization object deleted best-effort; browser never had its key or authority
  → row + mandatory audit commit together (create, or compare-and-swap replacement)
  → client staging key deleted last; a cleanup miss cannot mutate the accepted bytes

POST /uploads/{upload_id}/abort
  → deletes only unreferenced staging; best-effort because upload.gc owns abandonment
```

The original PUT remains valid for its one-hour TTL; object stores cannot revoke one URL in
isolation. That capability is harmless after completion because it can recreate or replace
only the staging key. The database always names the distinct canonical key, for which the
browser was never given write authority.

The canonical version segment is the first 128 bits (32 hex characters) of
`SHA-256("upload-finalization-sha256-v1" || NUL || finalization_id || NUL || content_sha256)`.
The full accepted SHA-256 is written to mandatory audit detail and canonical object metadata;
an existing retry candidate is read and checked against that full digest. The 128-bit path
component has negligible collision probability at this application's scale while keeping the
existing layout compact. MinIO's plaintext single-part PUT ETag is MD5, so it is explicitly
**not byte identity**. `If-Match` can reject an ordinary overwrite between HEAD and GET, but
no hash/key/publication decision trusts it.

The private server-finalization object resolves the otherwise unavoidable key-order problem:
the content digest is not known until the stream ends, yet the destination key includes it.
Buffering up to 100 MB in memory was rejected. Reopening the client-writable key after hashing
would recreate the TOCTOU. Instead, one already-open source response is validated and hashed
while becoming an unguessable server-only object; canonical PUT reads only that immutable
source and re-hashes it. A real equal-size/equal-MD5 PDF collision test overwrites client
staging after the source read opens and proves MinIO finishes that request from one stable
snapshot; canonical bytes and audit SHA-256 remain the accepted snapshot.

### `upload_id` is a signed ticket, not a database row

**§7 defines no pending-upload entity.** Something has to carry phase one's decisions into
phase two, and the two candidates were a new table or a signed token. The table was rejected:
inventing an entity is a schema decision the specification never took, and a table that records
uploads can disagree with the bucket that holds them, creating a reconciliation problem where
there was none. The ticket carries the state instead, and `upload.gc` (TD-7) then reaps
*objects* older than 48 h that no content row claims — which is the thing that actually needs
collecting, and is true whether or not any bookkeeping row ever existed.

The daily collector scans exactly three scopes: browser staging in `public` and `private`, and
server-finalization staging in `private`. One job reads at most 250 objects and transactionally
enqueues the opaque continuation as another pg-boss job, so a large backlog converges without
making one worker execution unbounded. The cutoff is fixed for the complete pagination run;
an object exactly 48 hours old is retained, and a missing `LastModified` is retained rather
than guessed. `recordings-staging` is deliberately excluded because R100 gives each provider
object an exact ingestion retry rather than an age-based collector.

**The ticket binds every authorization decision taken at `/initiate`** — caller, staging key,
bucket, finalization identity, declared size and type, and the §4.9 scope fields. A replacement
also binds the target version it observed. Without that binding, a Teacher could
initiate inside their own branch and complete into the Global scope, and the check at phase one
would be decorative. **Title and description are deliberately not bound**: they are free text no
authorization turns on, and keeping them out holds the ticket to a few hundred bytes, which
matters because it travels as a URL path segment.

Its signing key is derived from `JWT_SIGNING_KEY` by HKDF under its own label. That is the
separation TD-13 requires between token classes — an upload ticket and an access token must
never be interchangeable — obtained without adding a configuration variable TD-13 does not list.

### Replacement extends this flow rather than getting a route (R53)

`content_meta.replaces_content_id` targets an existing record: the same two phases run, and
completion updates that row instead of creating one. A replacement **is** an upload — it needs
the same presigned PUT, whitelist, cap, magic-byte verification and quota — so a second route
would be this flow written twice, and the copy that drifts still passes its own tests.
Resolving the target at `/initiate` also means an unauthorized replacement is refused **before**
a URL is minted. The target row's visibility also determines the replacement bucket. The
generic upload payload may carry `visibility`, but on a replacement it is not a second write
surface: the record keeps its authoritative value, and completion refuses any older or
contradictory ticket before updating its storage coordinates.

Publication is optimistic and exact: the replacement update matches the observed version,
bucket and old canonical key, increments the version once, and writes `content.replace` in
the same transaction. Competing tickets therefore cannot both publish or quarantine one
another's object. The loser removes only its own SHA-derived canonical candidate; a same-
ticket retry recognizes the committed finalization audit and converges without another
version bump. If same-ticket readers accepted different stable client-staging snapshots,
the mandatory audit identifies the one winner and the loser removes only its distinct key.

An outstanding replacement ticket that has `replaces` but no `replaces_version` is a pre-B-03
grant with no authoritative compare-and-swap observation. Completion rejects it with
`VERSION_CONFLICT` / `REPLACEMENT_REINITIATION_REQUIRED`, discards its unreferenced upload
object where safe, and leaves the existing content untouched. Reloading today's version was
rejected because it would silently give an old ticket authority it never carried.

**The server streams but never buffers the whole file.** Memory is bounded by storage stream
chunks plus the first 512-byte validation window. This is deliberately limited to browser
uploads under the existing 50/100 MB caps; R99's 500 MB provider object remains a storage-side
copy and does not enter the process.

**Declared content type is not trusted.** Magic bytes are, which is the only check that
survives a renamed file.

### Finalization failure boundaries

Storage PUTs are object-atomic: a failed or short streamed request never becomes a complete
canonical object. Source read, magic, length or hash failure publishes no row. A failed
server-finalization or canonical PUT leaves the client staging object available for the same
ticket to retry; the per-attempt private object is deleted best-effort. If the canonical PUT
succeeds and the database/audit transaction fails, completion removes that unreferenced
candidate only after the database can prove no matching publication committed. An ambiguous
commit or cleanup outage may therefore leave an unreachable canonical or staging object for
future `upload.gc`; it may not leave a row naming incomplete bytes.

After publication, client-staging deletion is best-effort and duplicate completion uses the
mandatory finalization audit before touching it. A retained PUT can recreate only that
unreferenced client key. Neither post-commit cleanup failure nor later staging mutation can
change the canonical coordinate or bytes.

### Limits

| | Cap | Accepted types |
|---|---|---|
| Audio | **100 MB** | `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`, `audio/wav` |
| Documents, slides, images | **50 MB** | PDF, JPEG, PNG, WebP, docx/pptx/xlsx |
| Video | — | **Not accepted at `/uploads/*`.** §4.9's *"Video remains excluded entirely"* remains in force for the route it was written about, and R99.12's `origin` marker does not widen it: the whitelist check does not consult that field |
| Video, **ingested class recording** | **500 MB** | `video/mp4`, reachable **only** by `session-recording-ingest` (R99.8). What R99 admits is a **provenance** — an object the platform produced by recording a class it authorised — not a file type. The cap is larger because a three-hour صوت وصورة lesson is legitimately bigger than a voice memo, and bounded for the same disk-budget reason Revision 18 gave |

**Video's absence is a rule, not an omission.** The library client maps `video/*` for
*presentation*, because that list answers a different question — how a stored thing is shown,
rather than what may be stored. Accepting video is a Document Owner decision and an SRS
revision (§20 rule 16), not an implementation detail.

**The magic-byte check is a predicate per type, not a prefix table**, because three of the
signatures are not prefixes: RIFF containers carry their real type at offset 8 (so WAV and WebP
are distinguishable, which a four-byte test would not manage), MP4 carries `ftyp` at offset 4,
and MP3 is either an ID3 tag or an eleven-bit frame sync — and matching `FF` alone would admit
every JPEG as audio. The three OOXML types are ZIP archives and are indistinguishable at this
depth, so the check there is *consistent with the declaration*, which is what a 512-byte window
can honestly assert.

100 MB was reduced from 500 MB: at 32 kbps mono speech that is over six hours of recording,
and the smaller cap shrinks three things at once — the blast radius of a failed single-shot
upload, the VPS disk budget, and the Nginx body limit.

### Why single-shot, and what it costs

Resumable multipart uploads are deferred. **A failed upload restarts from zero** — recorded
as an accepted risk, with mitigations rather than denial:

- Upload progress and a clear retry affordance in the UI
- Guidance to upload on stable connections and split long sessions
- The 100 MB cap, and the reality that phone voice recordings are typically 10–30 MB

Multipart resume is the **first** post-MVP storage item, and the key structure is already
compatible — it is a drop-in change to the upload path only.

## Keys

```
content/{content_id}/{version-segment}/{original-filename-slugified}.{ext}
staging/content/{content_id}/{unguessable-nonce}/{original-filename-slugified}.{ext}
staging/server-finalization/{content_id}/{unguessable-nonce}
quarantine/{content_id}/…                    (soft-deleted objects)
```

Three properties, each load-bearing:

**A short collision-resistant hash segment** defeats browser, proxy, and CDN caching
collisions when a file with the same name is re-uploaded. Ordinary upload finalization uses
128 bits derived from its signed finalization identity and the full accepted content SHA-256;
R99 ingestion retains its 8-hex retry-stable recording identity. Both canonical forms are
server-generated and never client-writable. The full browser-upload SHA-256 remains in audit
detail and object metadata even though the path uses its domain-separated 128-bit derivative.

**Keys are immutable once written.** Replacing a file on an existing record generates a
*new* key with a new hash segment and updates the database reference; the old object is
quarantined. A cached URL of the old object can therefore **never mask a newer upload** —
which is the actual bug this design prevents, and it is the reason the key structure was
retained unchanged even after multipart uploads were deferred.

**Original filenames are slugified**, with Arabic preserved via a transliteration slug and
the display name stored in the database.

## Consent gating

The storage-facing half of [`BR-2`](../reference/business-rules.md#br-2).

> If a Session's resolved audience has **even one** beneficiary without effective media
> consent, every recording linked to that Session is forced private. A recording shared by
> Sessions uses the union of those audiences.

This is a **continuously maintained invariant**, not an upload-time check. Re-evaluation is
triggered by roster/Teaching Group membership changes, consent changes, recording
upload/import/replacement, Session-content link changes and R92 occurrence-audience changes.
Retained live occurrences remain affected after their recurring schedule is soft-deleted, and
startup scans live recording links in bounded batches for older backlog. Every path enqueues
the same full current-state job for the affected occurrence.

A recording published while everyone consented **flips to private** when a non-consenting
student later enrols.

**Only an Admin can lift the forced state, and only with a written justification** recorded
in the audit log. The engine deliberately never clears the flag after a later grant. The
Admin override surface is still a separate M6 item and is not invented by this worker.

One edge case that reads like a bug and is not: a Session with a **zero-person resolved
audience** has no non-consenting beneficiary, so the gate does not engage and an unforced
upload keeps its Category default. The first audience mutation adding a non-consenting
beneficiary triggers the flip.

> [Business processes](../overview/business-processes.md#the-session-consent-gate) ·
> [Background jobs](background-jobs.md)

## Global scope is a privilege

Content with no branch appears in the *"Global / بدون فرع"* container across every branch.

**Only Admins and Super Admins may assign it.** Teachers are locked to branches within their
own assigned scope, resolved through their group assignments. A teacher upload with a null
or out-of-scope branch is refused.

This prevents a single-branch teacher from accidentally publishing a file platform-wide
([`BR-20`](../reference/business-rules.md#br-20)).

## Why stored objects allow same-origin framing

`/storage/` responses carry `frame-ancestors 'self'`; **everything else keeps
`'none'`.**

`frame-ancestors` applies to the response *being framed*. Inherited from the
server-level CSP, `'none'` forbade **any** page — including our own — from
embedding a stored object, so §14.6's inline PDF preview rendered blank while the
identical URL opened correctly in a tab and `<audio>` played fine. Those two work
because a top-level navigation is not framing and media loading is governed by
`media-src`; only the `<iframe>` was affected, which is what made it look like a
viewer bug.

**§3.1 scopes its CSP to *client responses*** and names only media/img/connect
sources for `/storage/`. It never asks stored objects to refuse framing — that
was an artefact of `add_header` inheritance, and it contradicted §14.6.

**Clickjacking protection is unchanged**: that threat is a hostile page framing
*our interface*, and the app shell still answers `frame-ancestors 'none'`. This
says only that our origin may embed its own documents.

One nginx trap worth knowing: **`add_header` in a location replaces the inherited
set entirely**, so the storage block restates `X-Content-Type-Options` too —
declaring only the CSP would have silently dropped `nosniff` from every stored
object.

## Nginx directives that decide whether uploads work

Scoped to `/storage/` only:

```nginx
client_max_body_size      110m;   # default is 1 MB → every upload dies at 413
proxy_request_buffering   off;    # default spools the whole body to disk first
```

The API location stays at `2m`. **Never raise the body limit globally to "fix" uploads.**

## Deletion and quarantine

`DELETE /content/{id}` (R53) soft-deletes the row, writes a `Trash` snapshot, and moves the
object to a **quarantine prefix**, pending the 90-day window.

Replacement and soft deletion commit an exact old-coordinate quarantine obligation in the
same PostgreSQL transaction as the row/audit change. The request still attempts the
copy-before-delete transition immediately, but that is only the fast path: storage failure or
an ambiguous delete response leaves the pg-boss job to retry. The job derives no coordinate
from the current row. It can therefore move only the immutable old key named at commit time,
never a replacement's newer canonical bytes.

**Two authorised paths lead out of quarantine, but only the deliberate one is active.**

* **A Super Admin purge** (R59.1) — `DELETE /admin/trash/{id}` destroys the row and
  commits an exact storage-retirement job **inside the same transaction**. The worker deletes
  both possible leftovers — the derived quarantine key and exact old canonical key — and
  propagates every storage failure so TD-7 retry/terminal observability applies. If the queue
  is absent, database destruction rolls back. A duplicate or a retry after an ambiguous
  response is safe because S3 deletion is idempotent and content UUID/version keys are never
  reused. A quarantine worker that finishes after permanent deletion rechecks row existence
  and retires both old coordinates again, so the stale job cannot leave a newly copied
  quarantine object behind.
* **The automatic `content.quarantine-purge` age arm** — which Revisions 52 and 53 both name as the
  enforcement of BR-15's window. R59.4 requires an Owner decision before automatic
  Production destruction. The queue and worker now exist for the exact non-destructive
  quarantine transitions and deliberate R59.1 purges above, but **nothing reads
  `purge_after` and the queue is not scheduled for age-based destruction**.

### OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE DESTRUCTION

Decide whether to activate BR-15's automatic 90-day destruction, which entity plans it may
apply, and the operational/legal approval gate. Until that decision, expired Trash rows and
their quarantine objects remain retained unless a Super Admin invokes the existing audited
manual purge. Recommendation: enable only after the supported object-store decision, the
off-host backup target/retention decision, and a Production-scale restore drill are complete;
then test exact due-date selection, dependency refusal, audit retention, crash/retry, and
restore-versus-purge serialization before scheduling the destructive scan.

**The object is moved rather than destroyed, and that is the whole point.** A deletion that
removed the file immediately would make BR-15's window a promise the platform keeps for every
entity except the one where the data is largest and least reproducible — a session recording
cannot be re-made.

**The copy precedes the delete**, so a failure between the two leaves a duplicate rather than
nothing. A quarantine fast-path failure does not fail the already-committed request, but it is
no longer swallowed as the only record of work: the exact job was committed first and retries
the transition. Missing source after an ambiguous delete is converged success; a malformed or
out-of-prefix coordinate is refused before storage.

## The third bucket: `recordings-staging` (R99)

A bucket the platform **owns and does not serve**. The provider's recording facility writes
its output there and nothing else ever reads it except the ingestion job. Anonymous access is
denied exactly as it is on `private`.

**It is integration state, not storage.** R99.13 is explicit that a provider URL is never
exposed as the content asset, never stored as one and never handed to a client: its lifetime
is not the association's to control, and a library item pointing at it would rot silently.
`session-recording-ingest` ([background jobs](background-jobs.md#session-recording-ingest--provider-completed-is-not-bodour-متاح))
verifies the object, copies it **server-side** into the ordinary content bucket under an
ordinary TD-9 key, and only then is there anything for a reader to find.

Staging deletion is attempted only after the canonical object and relation commit. A
transient delete failure leaves the content available and fails the existing ingest job so
pg-boss retains a durable retry. That retry reads `educational_content_id` first, skips every
ingest write and deletes only the staging bucket/key stored on the same recording. Missing
objects are success under S3 delete semantics; canonical and unrelated staging keys are never
cleanup targets. This exact post-commit obligation is separate from the age-based
`upload.gc` collector for abandoned browser uploads.

After that copy an ingested recording is **indistinguishable from any other library object** —
same key structure, same presigned mint, same quarantine path, same consent gate. That is the
point: R99 admits a *provenance*, and provenance is recorded in `EducationalContent.origin`,
not in where the bytes live.

### The shared object verifier

`lib/object-verification.ts` makes TD-9's assertions about **an object**, not about an upload
ticket. It was written inside `content.service.ts` against `UploadTicketClaims`, which was
correct while a browser was the only way bytes reached a bucket; R99's ingestion has to make
the same assertions about an object no ticket describes.

The two callers differ in exactly three policy places, and each difference is deliberate:

| | `/uploads/*` complete | `session-recording-ingest` |
|---|---|---|
| **Admissible types** | `isUploadableMime` — **`video/*` refused** (§4.9, R99.8) | `isIngestibleMime` — plus TD-9's `video/mp4` row, 500 MB |
| **Declared size** | must match exactly — the browser declared it at `/initiate` | `null`; the platform declared none, and failing a good recording over a provider's rounding protects nothing |
| **On refusal** | the object is **deleted at once** (TD-9 delete-on-mismatch) | the staging object is **kept**, so a corrected one can be retried (R99.14) |

**There is one whitelist, behind two doors.** The signature table, the cap table and the
sniffer are shared; only the reachability predicates differ. A second list is how `video/mp4`
would eventually become uploadable by accident.

### Server-side object primitives

`statObject` · `readObjectHead` · `openObjectRead` · `putObjectStream` · `copyObject` ·
`deleteObject`, all on the internal client. The stream primitives are bounded-memory; the
metadata/copy/delete primitives are **O(1) in the object's size**. The R99 primitive that
matters is `copyObject`: S3 and MinIO perform the copy *inside* the storage service, so a 500 MB recording never enters this process. The
obvious `GetObject` → buffer → `PutObject` would put half a gigabyte through a container pinned
at `--max-old-space-size=768` (TD-13) for every concurrent ingestion, on a 4 GB VPS (§2.4).
That is not a tuning problem; it is the wrong mechanism.

`CopySource` is **URI-encoded**. The private copy this replaced built it by interpolation, and
a TD-9 key carries a transliterated slug of a filename a person chose.

Upload completion uses the strict stat variant: only an actual 404 means absent; a storage
outage is never reinterpreted as permission to overwrite. R103 then uses full-stream SHA-256
and the private server-finalization source described above. R99 retains the ranged verifier:
its HEAD and magic-byte read share an ETag, so an ordinary provider overwrite between those
operations is refused. Its later verification-to-copy step is still pinned only by that
storage ETag; because R99 gives no client a writable capability this is outside B-03, but
stronger source pinning remains a separate hardening observation rather than being silently
folded into the browser-upload pipeline.

## File preview behaviour

| Type | Behaviour |
|---|---|
| PDF | Inline browser preview plus download |
| Audio | Embedded native `<audio>` player plus download |
| Video | Native `<video controls>` plus download — which is what makes an ingested صوت وصورة recording playable with no new component (R99) |
| Images | Thumbnail in lists; click opens a lightbox, plus download |
| Office files | **Download only** — no in-browser rendering in the MVP |

---

**Next:** [Background jobs](background-jobs.md) · **Related:**
[Security](security.md#storage), [System overview](system-overview.md#the-storage-proxy-and-signatures)
