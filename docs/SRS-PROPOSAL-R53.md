[Documentation](README.md) › **SRS proposal — Revision 53**

# Draft SRS Revision 53 — content replacement and deletion get a contract

> **Status: APPLIED to `docs/SRS.md` on 2026-08-06**, under the Document Owner's instruction
> to build the content upload UI *"allowing replacing and deleting uploaded content"*.
>
> Retained for the rationale — particularly *why replacement extends the upload flow instead of
> becoming a route of its own*, which the specification states as a rule rather than an argument.

---

## What the SRS says today

TD-3.5 defines four storage operations:

```
POST /uploads/initiate      → { filename, size, mime, content_meta } → { upload_id, key, put_url }
POST /uploads/{upload_id}/complete
POST /uploads/{upload_id}/abort
GET  /content/{id}/download-url
```

That is a complete *creation* contract and no lifecycle at all. Meanwhile **TD-9 already
specifies replacement mechanics in detail** —

> Keys are immutable once written. Replacing a file on an existing content record generates a
> *new* key (new hash segment) and updates the DB reference; the old object is quarantined.

— and **TD-5/BR-15 already specify deletion mechanics** (soft delete, `Trash` snapshot, the
ninety-day window closed by `content.quarantine-purge`). Both describe *how the platform must
behave when it happens*, and neither says **through which endpoint it happens.** §5.6 lists
*Delete* among the Content Library's actions and §5.5 asks for content management on
`/teacher/content`, so the operations are in the MVP; only their contract is missing.

**This is a gap, not a deferral.** Every neighbouring clause assumes the operations exist.

## The decision

**Replacement extends `/uploads/initiate` rather than becoming its own route.**

`content_meta` gains an optional `replaces_content_id`. When present, the upload targets an
existing record: the same two-phase flow runs, the key is minted against the *existing*
`content_id`, and `/complete` updates that row instead of creating one — new key, new hash
segment, old object quarantined, `version` incremented.

Three reasons this is better than `PUT /content/{id}/file`:

1. **A replacement is an upload.** It needs the identical presigned PUT, the identical TD-9
   whitelist and cap checks, the identical magic-byte verification at completion, and the
   identical quota. A second route would be the same flow written twice, and the copy that
   drifts still passes its own tests.
2. **Authorization happens before the bytes move.** Resolving the target at `/initiate` means an
   unauthorized replacement is refused before a URL is minted — not after a teacher on a mobile
   connection has uploaded eighty megabytes.
3. **The immutability rule stays in one place.** TD-9's "keys are never reused" holds because
   there is one key-minting path, and a replacement goes through it like everything else.

**Deletion is its own route**, `DELETE /content/{id}`, because it moves no bytes in and shares
nothing with the upload flow.

## What deletion does, and what it deliberately does not

* **Soft delete** — `deleted_at`/`deleted_by`, a `Trash` snapshot, and BR-15's ninety-day window
  (TD-5, §4.10), exactly as every other entity.
* **The object is moved to `quarantine/…`, never destroyed.** `content.quarantine-purge` (TD-7)
  closes the window. A deletion that destroyed the object at once would make the Trash's promise
  a lie for exactly the entity where the data is largest and hardest to reproduce — a session
  recording cannot be re-made.
* **No permanent-delete route**, consistent with Revision 52's ruling for the Trash. Adding one
  is a data-retention decision and needs its own revision.
* **Deleting content never touches the sessions that referenced it.** §4.9 already says
  unlinking never deletes the file; the converse holds too — `SessionContent` rows are soft-
  deleted with the record and the sessions themselves are untouched.

## Audit

`content.upload`, `content.replace` and `content.delete` join the TD-8 grid. **This needs no
revision of its own** — TD-8 states *"this list is the minimum; adding coverage is allowed,
removing it is not"* — but it is recorded here because the three rows are what make the
storage lifecycle answerable, and none of them is in the purgeable allowlist.

## Exact wording applied

### 1. New entry in §0

> **Revision 53 (content replacement and deletion get a contract, 2026-08-06):** TD-3.5 defined
> creation and no lifecycle, while TD-9 already specified how replacement must behave and
> TD-5/BR-15 how deletion must — mechanics with no endpoint to reach them, though §5.5 and §5.6
> both list the actions. **Replacement extends the upload flow**: `content_meta` gains an
> optional `replaces_content_id`, and completion updates that record rather than creating one —
> **a new key with a new hash segment, the previous object quarantined, `version` incremented**,
> exactly as TD-9 requires. It is deliberately **not** a route of its own: a replacement *is* an
> upload, needing the same presigned PUT, the same whitelist and cap checks, the same magic-byte
> verification and the same quota, and a second route would be that flow written twice.
> **Deletion is its own route**, `DELETE /content/{id}`, because it moves no bytes in: soft
> delete, `Trash` snapshot, and **the object moved to `quarantine/…` rather than destroyed**, so
> BR-15's ninety-day window means for a recording what it means everywhere else.
> **No permanent-delete route**, consistent with Revision 52.

### 2. TD-3.5 — the two additions

> ```
> POST /uploads/initiate      → { filename, size, mime, content_meta } → { upload_id, key, put_url }
>                               content_meta.replaces_content_id (optional, R53): the upload
>                               REPLACES that record's file — new key, old object quarantined,
>                               version incremented; never an overwrite (TD-9)
> DELETE /content/{id}        → soft delete + Trash snapshot + object moved to quarantine/…
>                               (R53, TD-5, BR-15). Never a permanent delete
> ```

### 3. TD-8 — three rows

> | `content.upload` / `content.replace` / `content.delete` *(Revision 53)* | mime, size, visibility and branch scope on upload; previous and new storage key on replacement; the storage key on deletion |
