[Documentation](../README.md) › [Architecture](README.md) › **Storage**

# Storage

MinIO, self-hosted in a container. Data residency rules out every managed object store, so
S3-compatible storage runs on the same box as everything else.

> **Status:** the Nginx proxy, upload/replace/delete flow, permission-checked private mint,
> recording ingestion, and durable R99 staging cleanup are built and tested. Visibility
> transitions, `content.bucket-migrate`, consent re-evaluation, and the general retention jobs
> remain open and are called out below rather than implied by the implemented upload flow.

## Two buckets, and the boundary between them

| Bucket | Holds | Served how |
|---|---|---|
| **public** | Only content whose visibility is `public` | Stable URLs behind the reverse proxy |
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

There is deliberately no literal-bucket `CHECK` on `educational_content`. The specified
visibility transition is asynchronous copy–verify–delete through `content.bucket-migrate`,
and the current model has no migration-state column with which a constraint could represent
that valid in-flight state. A check equating `public`/`private` strings directly would either
reject the specified transition or pretend the physical copy had completed when only the row
had changed. Until the transition endpoint and worker ship together, no production route can
change an existing row's visibility; that missing operation is fail-closed, not an alternate
write path.

### Visibility changes move the object

Switching public content to private migrates the object to the private bucket and removes
the old public key. Anyone following a stale cached link gets a **friendly platform error
page** — *"This content's access has changed"* — implemented as an Nginx error-page mapping
on storage 403/404 responses.

**Never a raw XML S3 error.** A beneficiary following an old WhatsApp link should not meet
`<Error><Code>NoSuchKey</Code>`.

The migration runs as a background job (copy, verify, delete — idempotent, skipped if
already in the target). Object storage cannot join a database transaction, so the move is
eventually consistent. That is safe because **the database row is the source of truth**, and
the presigned-mint endpoint checks the row: a not-yet-migrated object is already unreachable
through any legitimate path.

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
  for.**

Any mismatch between signed host/path and proxied host/path yields
`SignatureDoesNotMatch` — an error that looks like a credentials problem and is not.

A signed PUT plus signed GET round trip **through the proxy** is a mandatory acceptance
test, and it passes today. Verifying by talking to MinIO directly proves nothing: direct
access is the one path production never uses.

## Uploads

MVP uploads are **single-shot presigned PUT**, followed by a server-side completion check.

```
POST /uploads/initiate
  { filename, size, mime, content_meta }
  → branch scope validated HERE (a teacher passing "global" is refused)
  → per-user quota checked and incremented, under a row lock, in one transaction
  → { upload_id, key, put_url }

  browser PUTs directly to storage through the proxy, with progress

POST /uploads/{upload_id}/complete
  → server issues a RANGED GET (bytes 0-511) to MinIO and inspects magic bytes
  → HEAD verifies size against the declared value and the caps
  → mismatch → object deleted, no record created, 409 VALIDATION_FAILED
  → otherwise the content row is created (or UPDATED, on a replacement)

POST /uploads/{upload_id}/abort
  → deletes the object; best-effort, because upload.gc sweeps what a client abandons
```

### `upload_id` is a signed ticket, not a database row

**§7 defines no pending-upload entity.** Something has to carry phase one's decisions into
phase two, and the two candidates were a new table or a signed token. The table was rejected:
inventing an entity is a schema decision the specification never took, and a table that records
uploads can disagree with the bucket that holds them, creating a reconciliation problem where
there was none. The ticket carries the state instead, and `upload.gc` (TD-7) then reaps
*objects* older than 48 h that no content row claims — which is the thing that actually needs
collecting, and is true whether or not any bookkeeping row ever existed.

**The ticket binds every authorization decision taken at `/initiate`** — caller, key, bucket,
declared size and type, and the §4.9 scope fields. Without that binding, a Teacher could
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

**The server never streams or buffers the whole file to validate it.** A 512-byte window is
enough to check magic bytes, and fetching more would put a 100 MB file through the API
container's memory on a 4 GB box.

**Declared content type is not trusted.** Magic bytes are, which is the only check that
survives a renamed file.

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
content/{content_id}/{short-random-hash}/{original-filename-slugified}.{ext}
quarantine/{content_id}/…                    (soft-deleted objects)
```

Three properties, each load-bearing:

**A short random hash segment** (8 hex characters, generated at key creation) defeats
browser, proxy, and CDN caching collisions when a file with the same name is re-uploaded.

**Keys are immutable once written.** Replacing a file on an existing record generates a
*new* key with a new hash segment and updates the database reference; the old object is
quarantined. A cached URL of the old object can therefore **never mask a newer upload** —
which is the actual bug this design prevents, and it is the reason the key structure was
retained unchanged even after multipart uploads were deferred.

**Original filenames are slugified**, with Arabic preserved via a transliteration slug and
the display name stored in the database.

## Consent gating

The storage-facing half of [`BR-2`](../reference/business-rules.md#br-2).

> If a group has **even one** enrolled student without effective media consent, **every
> session recording for that group is forced private.**

This is a **continuously maintained invariant**, not an upload-time check. Three events
trigger re-evaluation: a roster change, a consent change for an enrolled student, and every
recording upload. Each enqueues a job that recomputes the group's consent state and
force-corrects the visibility of every affected recording — migrating objects between
buckets as needed.

A recording published while everyone consented **flips to private** when a non-consenting
student later enrols.

**Only an Admin can lift the forced state, and only with a written justification** recorded
in the audit log. A teacher cannot, and the API refuses it — tested at the API level, not
just hidden in the UI.

One edge case that reads like a bug and is not: a group with **zero** students has no
non-consenting student, so the gate does not engage and uploads take the category default.
The first enrolment of a non-consenting student triggers the flip.

> [Business processes](../overview/business-processes.md#the-group-consent-gate) ·
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

**Two paths lead out of quarantine, and one of them does not exist yet.**

* **A Super Admin purge** (R59.1) — `DELETE /admin/trash/{id}` destroys the row and
  **removes the quarantined object with it**, after the transaction commits. A destroyed
  row beside surviving bytes is an orphan nobody can find, reach or account for, in the one
  entity where the data is largest. The ordering is the safe one: if the object removal
  fails, the row is gone and the bytes remain, which is a reapable leftover rather than a
  record pointing at nothing.
* **The daily `content.quarantine-purge` job** — which Revisions 52 and 53 both name as the
  enforcement of BR-15's window, and which **was never built** (R59.4). Nothing reads
  `purge_after`. Objects placed in quarantine stay there indefinitely.

That second point is worth stating plainly rather than leaving implied: **quarantine is
currently permanent storage**, and its growth is unbounded until the job ships.

**The object is moved rather than destroyed, and that is the whole point.** A deletion that
removed the file immediately would make BR-15's window a promise the platform keeps for every
entity except the one where the data is largest and least reproducible — a session recording
cannot be re-made.

**The copy precedes the delete**, so a failure between the two leaves a duplicate rather than
nothing. And a quarantine failure does not fail the request: the row is already updated and the
audit row already written, so reporting failure would tell the caller their deletion did not
happen when it did. `content.quarantine-purge` sweeps whatever is left.

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

The two callers differ in exactly three places, and each difference is deliberate:

| | `/uploads/*` complete | `session-recording-ingest` |
|---|---|---|
| **Admissible types** | `isUploadableMime` — **`video/*` refused** (§4.9, R99.8) | `isIngestibleMime` — plus TD-9's `video/mp4` row, 500 MB |
| **Declared size** | must match exactly — the browser declared it at `/initiate` | `null`; the platform declared none, and failing a good recording over a provider's rounding protects nothing |
| **On refusal** | the object is **deleted at once** (TD-9 delete-on-mismatch) | the staging object is **kept**, so a corrected one can be retried (R99.14) |

**There is one whitelist, behind two doors.** The signature table, the cap table and the
sniffer are shared; only the reachability predicates differ. A second list is how `video/mp4`
would eventually become uploadable by accident.

### Server-side object primitives

`statObject` · `readObjectHead` · `copyObject` · `deleteObject`, all on the internal client and
all **O(1) in the object's size**. The one that matters is `copyObject`: S3 and MinIO perform
the copy *inside* the storage service, so a 500 MB recording never enters this process. The
obvious `GetObject` → buffer → `PutObject` would put half a gigabyte through a container pinned
at `--max-old-space-size=768` (TD-13) for every concurrent ingestion, on a 4 GB VPS (§2.4).
That is not a tuning problem; it is the wrong mechanism.

`CopySource` is **URI-encoded**. The private copy this replaced built it by interpolation, and
a TD-9 key carries a transliterated slug of a filename a person chose.

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
