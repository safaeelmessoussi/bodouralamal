[Documentation](../README.md) › [Architecture](README.md) › **Storage**

# Storage

- One self-hosted SeaweedFS model for Localhost, Staging and Production, defined once in `docker-compose.yml` (Owner, 2026-09-20); no per-tier storage overlay; no tier runs real MinIO; service/DNS and TD-13 `MINIO_*` names are compatibility names, not a vendor assertion.
- Built: Nginx proxy, upload/replace/delete, permission-checked private mint, recording ingestion, durable R99 staging cleanup, consent re-evaluation, bounded abandoned-upload GC, exact replacement/deletion retirement, general visibility placement.
- NOT built: automatic 90-day destruction — needs the separate Owner policy below; the object-store change does not authorize it.

## OWNER DECISION REQUIRED — OBJECT STORE

Heading kept for links. **Resolved 2026-09-20:** SeaweedFS 4.46 for every tier; the Owner authorized destroying the then-existing Localhost/Staging MinIO data. Production go-live stays a separate, open decision: this fixed which store Production will run, not that it runs.

### B1 candidate verification checkpoint

| Evidence | Fact |
|---|---|
| Selection | SeaweedFS 4.46 is the B1 replacement; live on Localhost and Staging since 2026-09-20 |
| Upstream | [Release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.46) 2026-09-08; [security policy](https://github.com/seaweedfs/seaweedfs/security) targets the latest release; [single-node guide](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini); maintenance evidence, not a no-vulnerability claim |
| Pin | `chrislusf/seaweedfs:4.46@sha256:08d516132314207d10c8e37cbffc1f32b147d870169688734cc61c6231625b62` |
| Rejected | Garage: [no S3 bucket-policy API](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/) |
| Compose | `minio`/`minio-init` keep `minio:9000` and TD-13 names; new `${COMPOSE_PROJECT_NAME}_seaweedfs-data` volume, never a MinIO-format mount; `volume.nocopy`; backups resolve the physical name from Compose labels and keep the logical `minio-data` manifest coordinate; telemetry, Admin UI, WebDAV, Iceberg/Lance, embedded IAM disabled; no host port beyond Local Development's loopback remap |
| Overlay retired | `docker-compose.storage.yml` (Production-only) switched a tier's backend whenever a `-f` chain included it (once, against Staging); folded into `docker-compose.yml` 2026-09-20 |
| Acceptance | Liveness is not acceptance: the API checks authenticated access to all three buckets; the one-shot initializer (exact API image SDK, no vendor CLI, not at API startup) checks policies and refuses versioning/lifecycle/Object Lock drift; public policy = `GetObject` on `public/*` only; private and recording-staging have no anonymous policy; repeat init accepts only equivalent singleton Action/Resource serialization |
| Probe | Passed. SDK checksum defaults put CRC32(empty) into bodyless presigned PUTs → `BadDigest`; fixed by requiring checksums on the public-origin presigning client only; internal writes keep optional checksums; completion hashes the whole stream; truncated input fails at transport or as `VALIDATION_FAILED`/`OBJECT_CHANGED_DURING_STREAM`; tests: short body, transport error, absent DB/canonical state, cleaned server staging, retained browser staging, same-capability retry |
| Smithy | Node chunked encoder awaited its checksum promise only on stream `end`; the shared internal client returns the same rejecting promise (no suppression, invented digest or disabled checksums); unit + real-stack tests require a refusal with no unhandled rejection |

See [B1 verification](../development/testing.md#b1-seaweedfs-compatibility-and-recovery).

### One model for every tier

- The Localhost/Staging recreate was a one-time Owner-authorized destructive migration, not a policy for future changes and not a Production go-live (Production holds no data); no object copy, checksum comparison or rollback retention was built for it.
- Never mount a raw MinIO volume as SeaweedFS; only an identical store/version may restore its raw volume; cross-vendor migration uses S3 bytes/metadata.
- `minio/minio:RELEASE.2025-09-07T16-13-09Z` retired everywhere: [GHSA-hv4r-mvr4-25vw](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw) affects that final OSS line, fixed only in AIStor.
- Vendor residency, support, administration, backup and commercial evidence: [provider acceptance matrix](../operations/provider-acceptance.md); this page owns the technical contract and regression suite.
- Safe replacements: (1) a patched, supported MinIO AIStor release; (2) another maintained self-hosted S3-compatible store on approved Moroccan infrastructure; (3) a managed S3-compatible service only with Owner + legal review of Moroccan residency, backup location, contractual controls and cost. AIStor-first was the earlier recommendation; the selection is SeaweedFS.
- Any replacement must support path-style SigV4 presigning via same-origin `/storage` (exact non-default Host port included), ranged GET/HEAD, PUT, copy, delete, conditional reads/copies, object metadata, object-atomic writes, idempotent deletion, the three bucket policy shapes, the AWS SDK client, internal-only networking, authenticated `HeadBucket` on all three buckets, Moroccan primary and backup residency. `/healthz` uses those bucket checks with the real credentials, not `/minio/health/live`.
- Versioning disabled: the immutable-key model stores no version IDs; `DeleteObject` must retire the named bytes, never leave a noncurrent version or delete marker. No provider lifecycle rule may expire, rewrite, tier or auto-destroy canonical, quarantine or staging objects; Object Lock must not block an authorised exact-key purge; proven from the vendor's real admin API. Enabling versioning later needs an explicit design (version coordinates, deletion, restore, legal erasure).
- Acceptance rerun per replacement/update: three buckets exist, authenticated `HeadBucket`, versioning disabled, no unapproved lifecycle/Object Lock, truthful container healthcheck; then `nginx -t`/`nginx -T`, signed private PUT/GET proxy round trip, signed public-staging PUT + unsigned-read denials, canonical public GET/HEAD and method/root denial matrix, full B-01 safeguarding suite, B-02 placement, B-03 immutable finalization/replacement, R99 ingestion, old-key retirement, deletion/replacement race and ambiguous-storage recovery, upload/quarantine retention jobs, object-store health/readiness, backup/restore drill. Never approve Production from an API-compatibility claim alone.

## Two buckets

| Bucket | Holds | Served |
|---|---|---|
| **public** | Canonical `public` content plus disposable browser-upload staging | Stable URLs pass an exact live-row authorization subrequest; staging is write-only at the public origin |
| **private** | All `private`/`hidden` content plus every group recording under a consent restriction | Never a stable URL; every read is a short-lived presigned URL minted after a server-side permission check |

- Visibility is never encoded in the key; the bucket carries it, so a visibility change is a physical move and keys stay immutable.
- `EducationalContent.visibility` is the domain fact, `storage_bucket` its consequence: new uploads validate visibility server-side and derive the bucket; a replacement inherits the row's visibility (R53/TD-9); completion re-checks the ticket against the authoritative visibility and discards a contradictory object before any DB write (a ticket stays valid up to two hours).
- No literal-bucket `CHECK` on `educational_content`: a visibility transition is asynchronous copy–verify–delete via the placement intent/adoption path with unique destination keys and durable loser retirement. The consent-forced pending state (`consent_forced_private = true` with `visibility = public`) was retired by R170 §3; the flag is never written again.
- The anonymous S3 policy is not the boundary: S3 is network-internal, Nginx the only published origin; every canonical public GET/HEAD asks the API whether one undeleted row names that exact key as public/public, so a committed visibility change, replacement or deletion closes the origin at once (R170 §3: the consent warning is not a gate).
- Method allowlist: canonical paths admit DB-gated GET/HEAD and SigV4 PUT only; `public/staging/` admits SigV4 PUT only (GET/HEAD → unavailable page); every other method is refused before the store. PUT stays delegated to the store's signature check; current code never mints a browser write to a canonical key; legacy replacements without a compare-and-swap version are refused at completion.
- Every proxying path rejects the `STREAMING-UNSIGNED-PAYLOAD-TRAILER` content-hash mode before upstream (not signed streaming or ordinary presigned GET/PUT); defence in depth, verified without replaying an exploit.
- `/storage/public` and `/storage/public/` are bucket coordinates: denied by exact locations with or without query, never redirected (`?list-type=2` would relocate the listing); normalized matching still selects these rules for duplicate/encoded separators; the read authorizer sees the original URI and refuses any spelling but the exact DB coordinate.

### Visibility changes move the object

- Public → private copies to the private bucket and removes the old public key; a stale link gets the friendly Nginx error page («This content's access has changed») on storage 403/404, never raw S3 XML.
- Background job: copy, full SHA-256 verify, delete; idempotent, restart-safe, eventually consistent; the pending interval closes application reads and the published origin; the final transaction deletes the source before the row may say `private`; a delete-succeeded/DB-rollback retry proves the copied bytes from their server-written SHA-256.

## Presigned URLs

| Operation | TTL | Notes |
|---|---|---|
| GET public | 10 min | Anonymous mint only for a live public, non-consent-restricted public-bucket row; the origin re-authorizes the exact coordinate on read |
| GET private | 10 min | Only after the permission check, including child context for a parent |
| PUT single-shot | 1 hour | Never-completed uploads collected after 48 h |

- Previews use the same mint path as downloads: no preview endpoint, no relaxed thumbnail permission.
- `GET /content/{id}/download-url` is optionally authenticated: anonymous → the `GET /library` public tier; an active authenticated caller is re-read through TD-12 and may get the §4.9 private tier; the library frontend sends its token when it has one.
- Presigned URLs are generated against the public storage origin; `/storage/` strips the prefix and rewrites `Host` to the exact incoming HTTP Host (non-default port included), never Nginx's normalized host; a mismatch yields `SignatureDoesNotMatch` (looks like credentials, is not). A signed PUT + GET round trip through the proxy is a mandatory acceptance test; direct store access proves nothing.

## Uploads

Single-shot presigned PUT to a disposable staging key, then server-controlled immutable finalization.

- `POST /uploads/initiate` `{ filename, size, mime, content_meta }`: branch scope validated here (a teacher passing "global" is refused); per-user quota checked and incremented under a row lock in one transaction; the PUT capability addresses `staging/content/...`, never the future content key; public staging accepts the signed PUT but is never anonymously readable; returns `{ upload_id, key, put_url }`; the browser PUTs through the proxy with progress.
- `POST /uploads/{upload_id}/complete`: HEAD verifies size against declaration and caps; one full staging GET (ETag conditional as a race optimization only); prefix held until magic validation; exact length + SHA-256 over the stream; mismatch → object deleted, no record, `409 VALIDATION_FAILED`; accepted stream PUT into unique private `staging/server-finalization/...`; canonical 32-hex identity from finalization id + accepted SHA-256; server-owned object streamed to canonical PUT and re-hashed; server-finalization object deleted best-effort (the browser never had its key); row + mandatory audit commit together (create or compare-and-swap replacement); client staging key deleted last.
- `POST /uploads/{upload_id}/abort`: deletes only unreferenced staging, best-effort; `upload.gc` owns abandonment.
- The original PUT stays valid for its hour (unrevocable) and can only recreate the staging key; the DB names the distinct canonical key the browser never had write authority for.
- Version segment = first 128 bits (32 hex) of `SHA-256("upload-finalization-sha256-v1" || NUL || finalization_id || NUL || content_sha256)`; the full SHA-256 goes to mandatory audit detail and object metadata and a retry candidate is checked against it. Single-part PUT ETag is MD5, not byte identity; `If-Match` never decides hash, key or publication.
- The private server-finalization object solves the key-order problem (digest unknown until stream end). Rejected: buffering up to 100 MB in memory; reopening the client-writable key after hashing (TOCTOU). An equal-size/equal-MD5 PDF collision test overwrites client staging after the source read opens and proves one stable snapshot.
- The server streams, never buffers: memory bounded by stream chunks plus the 512-byte validation window; browser uploads only (50/100 MB); R99's 500 MB object is a storage-side copy.
- Declared content type is not trusted; magic bytes are.

### `upload_id` is a signed ticket, not a database row

- §7 defines no pending-upload entity; a table was rejected (a schema decision the SRS never took, plus a bucket/table reconciliation problem); `upload.gc` (TD-7) reaps objects older than 48 h that no content row claims.
- Daily collector: browser staging in `public` and `private`, server-finalization staging in `private`; ≤ 250 objects per job, continuation enqueued transactionally as another pg-boss job; cutoff fixed for the run; an object exactly 48 h old or lacking `LastModified` is retained; `recordings-staging` excluded (R100 gives each provider object an exact ingestion retry).
- The ticket binds every `/initiate` decision: caller, staging key, bucket, finalization identity, declared size and type, §4.9 scope fields, and for a replacement the observed target version. Title and description are deliberately unbound (free text; keeps the ticket a few hundred bytes as a URL path segment).
- Signing key derived from `JWT_SIGNING_KEY` by HKDF under its own label: the TD-13 separation between token classes without a new variable.

### Replacement (R53)

- `content_meta.replaces_content_id` runs the same two phases and updates the row; no second route. The target is resolved at `/initiate`, so an unauthorized replacement is refused before a URL is minted; the target row's visibility decides the bucket; a payload `visibility` is not a second write surface.
- Publication is optimistic and exact: match observed version, bucket and old canonical key; increment version once; `content.replace` in the same transaction; the loser removes only its own SHA-derived candidate; a same-ticket retry converges on the finalization audit without another bump.
- Audit identifies coordinates by SHA-256 of `bucket + NUL + key`, never the filename-derived key; exact old keys stay in content/Trash and pg-boss records; finalization id + full SHA-256 rebuild the canonical key on retry; older rows keep a read-only exact-key fallback.
- A ticket with `replaces` but no `replaces_version` (pre-B-03) is rejected at completion with `VERSION_CONFLICT` / `REPLACEMENT_REINITIATION_REQUIRED`, its unreferenced object discarded where safe; reloading today's version was rejected.

### Finalization failure boundaries

- PUTs are object-atomic; source read, magic, length or hash failure publishes no row; a failed server-finalization or canonical PUT leaves client staging for the same ticket to retry (per-attempt private object deleted best-effort).
- Canonical PUT succeeded, DB/audit failed → the candidate is removed only after the DB proves no matching publication committed; an ambiguous commit or cleanup outage may leave an unreachable object for `upload.gc`, never a row naming incomplete bytes.
- After publication, client-staging deletion is best-effort; duplicate completion consults the finalization audit first; no cleanup failure or later staging mutation can change the canonical coordinate or bytes.

### Limits

| | Cap | Accepted types |
|---|---|---|
| Audio | 100 MB | `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`, `audio/wav` |
| Documents, slides, images | 50 MB | PDF, JPEG, PNG, WebP, docx/pptx/xlsx |
| Video | — | Not accepted at `/uploads/*` (§4.9 «Video remains excluded entirely»); R99.12's `origin` marker does not widen it |
| Ingested class recording | 500 MB | `video/mp4`, reachable only by `session-recording-ingest` (R99.8): a provenance, not a file type; bounded for R18's disk-budget reason |

- Video's absence is a rule: the library client maps `video/*` for presentation only; accepting video is a Document Owner decision and SRS revision (§20 rule 16).
- Magic-byte check is a predicate per type, not a prefix table: RIFF real type at offset 8 (WAV vs WebP), MP4 `ftyp` at offset 4, MP3 = ID3 tag or eleven-bit frame sync (`FF` alone would admit every JPEG); OOXML types are ZIP archives, checked for consistency with the declaration.
- 100 MB (down from 500 MB) is over six hours at 32 kbps mono; it bounds failed-upload blast radius, VPS disk and the Nginx body limit.
- Resumable multipart is deferred: a failed upload restarts from zero (accepted risk; mitigations: progress + retry UI, stable-connection guidance, the cap; phone recordings are typically 10–30 MB); first post-MVP storage item; the key structure already fits.

### What a recording IS (Owner 2026-09-02, R120)

- A مؤطِّرة recording herself giving or explaining a lesson, voluntarily: MVP her own voice (phone recorder or online-class egress); post-MVP her own video.
- The platform does not record a classroom or beneficiaries; never describe teacher material as classroom capture or surveillance. No technical safeguard prevents a microphone or camera from capturing somebody else, and none is claimed; BR-2's consent mechanism governs publication and access.
- Event/party photographs and video are a separate scenario (consent from identifiable people or their parent/legal representative); no surface implements it today.
- `SessionRecording`, the `session-recording` queue and the `recordings-staging` bucket keep their names deliberately.

## Keys

```
content/{content_id}/{version-segment}/{original-filename-slugified}.{ext}
staging/content/{content_id}/{unguessable-nonce}/{original-filename-slugified}.{ext}
staging/server-finalization/{content_id}/{unguessable-nonce}
quarantine/{content_id}/…                    (soft-deleted objects)
```

- A collision-resistant hash segment defeats browser/proxy/CDN caching collisions on re-upload: 128 bits from the signed finalization identity + full content SHA-256 for browser uploads; R99 ingestion keeps its 8-hex retry-stable identity; both server-generated, never client-writable.
- Keys are immutable: a replacement gets a new key, the DB reference moves, the old object is quarantined; a cached old URL can never mask a newer upload (why the structure survived the multipart deferral).
- Filenames are slugified (Arabic via transliteration); the display name lives in the DB.

### Exact retirement authority (B4/B5)

- Visibility moves mint a fresh immutable destination key per attempt; a `StorageRetirement` placement intent commits before the copy; publication and cleanup serialize on the Content row then the intent, so a completed cleanup cannot be adopted; the winner resolves its intent and commits the exact old-coordinate retirement; failures leave an actionable obligation, never a guessed scan; the same-bucket metadata path is copy-free.
- Each intent starts `copy_settled = false` durably before any write; its destination has one writer, a single-attempt internal COPY client with SDK retries disabled for this operation only ([SDK retry contract](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)); an absent object leaves the intent `COPY_OUTCOME_UNKNOWN`; neither time nor repeated absence clears its locator.
- Settlement needs positive evidence (callback finished without a COPY, COPY success, or a later HEAD sees the unique destination), relying on [atomic CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html) and strong read-after-write; settlement commits before deletion; retrying publication always creates a new intent/key; not a vendor selection ([race proof](../development/testing.md#b4b5b6-storage-retirement-and-event-scope-2026-09-12)).
- The domain record, not pg-boss history, owns retirement after replacement, deletion or purge: pending records keep the exact locator; completed ones keep structural ids and a coordinate digest; no filenames or raw keys in audit detail or new payloads ([background jobs](background-jobs.md#storage-lifecycle-jobs--bounded-sweep-versus-exact-obligation)); not permission to inspect or delete unclassified objects on an existing host.

## Consent gating

The storage half of [BR-2](../reference/business-rules.md#br-2): a **warning since R170 §3 (Owner, 2026-09-21), no longer a gate on storage**.
- One beneficiary in a Session's resolved audience without effective media consent warns every recording linked to it (`media_consent_missing`); a recording shared by Sessions is warned by the union; nothing is forced.
- Continuously maintained: re-evaluated on roster/Teaching Group changes, consent changes, recording upload/import/replacement, Session-content link changes, R92 occurrence-audience changes; live occurrences stay covered after their schedule is soft-deleted; startup scans live links in bounded batches; every path enqueues the same full-current-state job. The metadata path re-evaluates on adding or removing the recording marker under the same ordered Session anchors; a graph that grows during acquisition refuses the transaction.
- Withdrawn by R170 §3: `content.bucket-migrate`'s consent arm, consent-grounds retirement of a public recording's old object, the `consent_forced_private = false` library conjunct, the download-URL mint and the Nginx auth subrequest. A public recording is served when `visibility = public` and the key is current. `consent_forced_private` stays in the schema, never written; the migration moved every `true` onto the warning and completed pending obligations with code `withdrawn_r170`.
- Staff only: `GET /library` projects `media_consent_missing` for staff, `null` otherwise; `GET /calendar/sessions/{id}` answers `audience_media_consent_missing` for staff (the audience checked BEFORE recording), `null` otherwise.
- A zero-person audience warns nothing; the first non-consenting addition raises it, a later grant clears it.

[Business processes](../overview/business-processes.md#the-session-consent-gate) · [Background jobs](background-jobs.md)

## Global scope is a privilege

- No-branch content appears in «Global / بدون فرع» across every branch; only Admins and Super Admins may assign it; teachers are locked to branches in their own scope (group assignments); a teacher upload with a null or out-of-scope branch is refused ([BR-20](../reference/business-rules.md#br-20)).

## Framing and Nginx for `/storage/`

- `/storage/` responses carry `frame-ancestors 'self'`; everything else keeps `'none'` (§3.1 scopes its CSP to client responses; the inherited `'none'` blanked §14.6's inline PDF preview; the app shell stays `'none'`, so clickjacking protection is unchanged).
- `add_header` in a location replaces the inherited set, so the storage block restates `X-Content-Type-Options` (`nosniff`).
- `/storage/` only: `client_max_body_size 110m` (default 1 MB → 413) and `proxy_request_buffering off`; the API location stays `2m`; never raise the body limit globally.

## Deletion and quarantine

- `DELETE /content/{id}` (R53) soft-deletes the row, writes a `Trash` snapshot and moves the object to a quarantine prefix pending the 90-day window; moved, not destroyed (a session recording cannot be re-made).
- Replacement and soft deletion commit an exact old-coordinate quarantine obligation in the row/audit transaction; the immediate copy-before-delete is only the fast path; the pg-boss job derives no coordinate from the current row, so it moves only the immutable old key. Copy precedes delete; a fast-path failure does not fail the committed request; missing source after an ambiguous delete is converged success; a malformed or out-of-prefix coordinate is refused before storage.
- Super Admin purge (R59.1): `DELETE /admin/trash/{id}` destroys the row and commits an exact storage-retirement job in the same transaction (queue absent → rollback); the worker deletes the derived quarantine key and the exact old canonical key, propagating failures for TD-7 retry; S3 deletion is idempotent and UUID/version keys are never reused; a quarantine worker finishing after purge rechecks row existence and retires both coordinates again.
- Automatic `content.quarantine-purge` age arm (BR-15, R52/R53): NOT active — nothing reads `purge_after`, the queue is not scheduled for age-based destruction; R59.4 requires an Owner decision first.

### OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE DESTRUCTION

- Decide whether to activate BR-15's automatic 90-day destruction, which entity plans it covers, and the operational/legal approval gate; until then expired Trash rows and quarantine objects are retained unless a Super Admin runs the audited manual purge.
- Recommendation: only after the off-host backup target/retention decision and a Production-scale restore drill; then test exact due-date selection, dependency refusal, audit retention, crash/retry and restore-versus-purge serialization before scheduling.

## The third bucket: `recordings-staging` (R99)

- Owned, never served; the provider writes there and only the ingestion job reads it; anonymous access denied as on `private`.
- Integration state, not storage (R99.13): a provider URL is never exposed, stored or handed to a client. [`session-recording-ingest`](background-jobs.md#session-recording-ingest--provider-completed-is-not-bodour-متاح) verifies the object and copies it server-side into the content bucket under an ordinary TD-9 key; provenance is `EducationalContent.origin`; afterwards the recording is indistinguishable from any library object (key, mint, quarantine, consent).
- Staging deletion only after the canonical object and relation commit; a transient delete failure keeps the content available and fails the ingest job for a durable retry, which reads `educational_content_id` first, skips ingest writes and deletes only the staging bucket/key stored on the recording; missing objects are success; canonical and unrelated staging keys are never cleanup targets; separate from `upload.gc`.

### The shared object verifier

`lib/object-verification.ts` asserts TD-9 about an object, not an upload ticket (formerly in `content.service.ts` against `UploadTicketClaims`). One whitelist behind two doors: signature table, cap table and sniffer shared; only reachability differs.

| | `/uploads/*` complete | `session-recording-ingest` |
|---|---|---|
| Admissible types | `isUploadableMime`, `video/*` refused (§4.9, R99.8) | `isIngestibleMime`, plus `video/mp4` at 500 MB |
| Declared size | Must match exactly | `null`; the platform declared none |
| On refusal | Object deleted at once (TD-9) | Staging object kept for a corrected retry (R99.14) |

### Server-side object primitives

- `statObject` · `readObjectHead` · `openObjectRead` · `putObjectStream` · `copyObject` · `deleteObject` on the internal client; stream primitives bounded-memory; metadata/copy/delete O(1) in object size.
- `copyObject` copies inside the storage service, so a 500 MB recording never enters a process pinned at `--max-old-space-size=768` (TD-13) on a 4 GB VPS (§2.4); GET → buffer → PUT was rejected. `CopySource` is URI-encoded.
- Upload completion uses the strict stat variant: only an actual 404 means absent; an outage is never permission to overwrite. R103 uses full-stream SHA-256 and the server-finalization source. R99 keeps the ranged verifier: HEAD and magic read share an ETag, so a provider overwrite between them is refused; its verification-to-copy step is pinned only by that ETag — outside B-03 (no client has a writable capability), a separate hardening observation.

## File preview behaviour

| Type | Behaviour |
|---|---|
| PDF | Inline preview plus download |
| Audio | Native `<audio>` plus download |
| Video | Native `<video controls>` plus download (ingested صوت وصورة recordings, R99) |
| Images | Thumbnail in lists; lightbox on click; download |
| Office files | Download only; no in-browser rendering in the MVP |

**Next:** [Background jobs](background-jobs.md) · **Related:** [Security](security.md#storage), [System overview](system-overview.md#the-storage-proxy-and-signatures)
