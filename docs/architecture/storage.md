[Documentation](../README.md) › [Architecture](README.md) › **Storage**

# Storage

MinIO, self-hosted in a container. Data residency rules out every managed object store, so
S3-compatible storage runs on the same box as everything else.

> **Status:** the storage subsystem is specified in full and its Nginx proxy path is built
> and tested (a signed PUT/GET round trip passes). The upload endpoints themselves land with
> **M6**. This page describes the design as specified; where something is not yet built it
> says so.

## Two buckets, and the boundary between them

| Bucket | Holds | Served how |
|---|---|---|
| **public** | Only content whose visibility is `public` | Stable URLs behind the reverse proxy |
| **private** | All `private` and `hidden` content, **plus every group recording under a consent restriction** | **Never** a stable URL. Every read is a short-lived presigned URL minted after a server-side permission check |

**Visibility is never encoded in the storage key.** The bucket carries it. That is what
makes a visibility change a physical move rather than a rename, and it is why a key can
safely be immutable.

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

POST /uploads/{id}/complete
  → server issues a RANGED GET (bytes 0-511) to MinIO and inspects magic bytes
  → HEAD verifies size against the declared value and the caps
  → mismatch → object deleted, no record created
  → otherwise the content row is created
```

**The server never streams or buffers the whole file to validate it.** A 512-byte window is
enough to check magic bytes, and fetching more would put a 100 MB file through the API
container's memory on a 4 GB box.

**Declared content type is not trusted.** Magic bytes are, which is the only check that
survives a renamed file.

### Limits

| | Cap | Accepted types |
|---|---|---|
| Audio | **100 MB** | `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`, `audio/wav` |
| Documents, slides, images | **50 MB** | PDF, JPEG, PNG, WebP, common office types |

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

## Nginx directives that decide whether uploads work

Scoped to `/storage/` only:

```nginx
client_max_body_size      110m;   # default is 1 MB → every upload dies at 413
proxy_request_buffering   off;    # default spools the whole body to disk first
```

The API location stays at `2m`. **Never raise the body limit globally to "fix" uploads.**

## Deletion and quarantine

Soft-deleting content moves the object to a **quarantine prefix** in the private bucket,
pending the 90-day window. A daily job permanently removes objects past it.

That job is the only path to hard deletion — matching the audit log's design, where one job
is the only sanctioned deletion route.

## File preview behaviour

| Type | Behaviour |
|---|---|
| PDF | Inline browser preview plus download |
| Audio | Embedded native `<audio>` player plus download |
| Images | Thumbnail in lists; click opens a lightbox, plus download |
| Office files | **Download only** — no in-browser rendering in the MVP |

---

**Next:** [Background jobs](background-jobs.md) · **Related:**
[Security](security.md#storage), [System overview](system-overview.md#the-storage-proxy-and-signatures)
