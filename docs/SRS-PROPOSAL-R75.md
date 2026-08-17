[Documentation](README.md) › **SRS Proposal — Revision 75**

# SRS Proposal — Revision 75

**The in-app audio recorder, brought forward for class sessions.**

**Status:** drafted 2026-08-17 on the Document Owner's explicit instruction
(*"my current product requirement is now to implement the recorder for CLASS
SESSIONS … make the minimum necessary revision"*). **Not applied.** `docs/SRS.md`
is immutable to the implementer; this is the text for the Owner to approve, and
the wording below is exactly what would be inserted.

---

## 1 · What the SRS says today

Two clauses, and they agree with each other:

**§4.9 (Revision 12) — the deferral:**

> *In-app audio recorder — **POSTPONED to §10.1 (Revision 12)**: the browser
> MediaRecorder component (per-browser containers, iOS screen-lock suspension
> handling, duration integrity checks) was the most cross-browser-fragile piece
> of the build. In MVP, **teachers record with their phone's native
> voice-recorder app and upload the file** — the upload pipeline, consent gate,
> and the full TD-9 audio-container whitelist (webm/mp4/ogg/mpeg/wav) already
> accept everything phones produce. … Video remains excluded entirely. **Risk R-4
> (iOS recording suspension) is retired with this deferral.***

**§10.1 — the shape it must take when it returns:**

> *In-App Audio Recorder (Revision-12 deferral): MediaRecorder with feature
> detection (`isTypeSupported`), native containers per browser (webm/Opus,
> mp4/AAC, ogg/Opus), **`audioBitsPerSecond: 32000`, `channelCount: 1`** for
> speech (~14 MB/hour), iOS screen-lock warning banner + post-recording duration
> integrity check, Web Worker for any client-side processing. **Reintroduces (and
> re-scopes) risk R-4.***

So the recorder is **not an unspecified gap**. It is a **deferral with a recorded
reason**, and §10.1 already states most of the engineering contract for it.

## 2 · What is missing

Only the **decision to move it**, plus four things §10.1 leaves open because it
was written as a deferral note rather than as a specification:

1. **Where it lives.** §10.1 describes a recorder; it does not say what a
   recording *becomes* or what it attaches to.
2. **Pause/resume.** Not mentioned. The Owner requires it, and it is not free —
   `MediaRecorder.pause()` exists but its effect on the produced container's
   duration metadata is exactly the *"duration integrity"* problem §10.1 names.
3. **Naming.** A recording created in the browser has no filename a person chose.
4. **The risk position.** R-4 was *retired*; §10.1 says the recorder
   *reintroduces* it. Someone has to accept it, in writing.

## 3 · The proposed revision

> **Revision 75 (Document Owner decision — the in-app audio recorder ships for
> class sessions, 2026-08-17):** Revision 12 postponed the browser recorder to
> §10.1 and retired risk R-4 with the deferral; **this revision moves it forward
> for `Session` recordings only** and accepts R-4 again in its re-scoped form.
> **(1) What changes and what does not.** The recorder is an **additional way to
> produce an `EducationalContent`**, never a second content model: a saved
> recording is an ordinary library item with an `audio/*` MIME, created through
> the **existing** `POST /uploads/initiate` → `PUT` → `POST /uploads/{id}/complete`
> pipeline (§4.9, TD-9) and linked to its session through the **existing**
> `SessionContent` join (R43). **No new entity, no new storage mechanism, no new
> endpoint for audio**, and the §4.9 consent gate, the visibility tiers, the
> quarantine-on-replace rule and the 30-uploads/hour/user quota (R14) all apply
> unchanged because it is the same pipeline. **Phone-recorded uploads remain
> fully supported** — this adds a path, it does not remove one. **(2) Scope is
> `Session` and nothing else.** Recording is offered from a class session, whose
> `(level, subject, academic_year, branch)` supply the content's required scope
> fields. **No recorder is offered on an `Event`**: R43 retired
> `EducationalContent.event_id` and content does not attach to Events, so a
> recorder there would have nothing to link to. **Video remains excluded
> entirely** (§4.9, unchanged). **(3) Authorization is the session's, unchanged.**
> Whoever may link content to a session may record for it — TD-2 gains **no
> row**: a مؤطرة within her §4.4c scope, an Admin within their branches, a Super
> Admin. **The server remains authoritative**: the recorder produces an upload and
> a link, and both are refused exactly as a manual upload and a manual link are.
> Hiding the control is a UX layer and never the enforcement (TD-2). **(4) The
> engineering contract is §10.1's, now normative:** `MediaRecorder` with
> `isTypeSupported` feature detection; native containers per browser
> (webm/Opus, mp4/AAC, ogg/Opus), each already on TD-9's whitelist;
> **`audioBitsPerSecond: 32000` and `channelCount: 1`**; the 100 MB cap
> (§4.9/R12) unchanged. **Where `MediaRecorder` or every whitelisted container is
> unsupported, the control is not offered and the reason is stated** (§14.4) —
> the phone-upload path is the fallback and is already there. **(5) Pause and
> resume are supported, and the duration risk is stated.** `pause()`/`resume()`
> produce **one** recording, never several files. Some containers record a
> duration that ignores paused time, so the client **must not** present a
> computed elapsed time as the file's duration: **elapsed time is UI only**, and
> no duration is written to `EducationalContent` (§7 defines no such column, and
> none is added). **(6) A recording is named by default and the name is editable.**
> The default is derived from the session — its title, its description and its
> date — and **the second and subsequent recordings of the same session are
> suffixed ` 2`, ` 3`, …, the first carrying no number**. The suffix is chosen
> from the recordings **already linked to that session** so that concurrent saves
> cannot overwrite one another; **the name is a default and never an invariant** —
> it is edited through the ordinary content-edit flow, and nothing reads it back.
> **(7) Risk R-4 is reinstated, re-scoped and accepted.** iOS suspends
> `MediaRecorder` when the screen locks or the tab is backgrounded, and a long
> recording can be truncated without the browser reporting an error. The
> mitigations are **normative**: an on-screen warning while recording is active,
> a `visibilitychange` warning, and a **beforeunload guard** so a navigation
> cannot silently discard an active recording. **The accepted residual risk is a
> truncated recording on a locked iOS screen**, and the stated remedy is the
> phone-upload path, which is unchanged and always available. **(8) §10.1 loses
> the item and §4.9 gains it**, so the specification stops describing as
> postponed a feature that ships. The **Web Worker** clause of §10.1 does not
> apply: nothing is processed client-side — the blob is uploaded as the browser
> produced it.

## 4 · What this costs, honestly

| | |
|---|---|
| **Risk accepted** | R-4, re-scoped: truncated recording on a locked iOS screen. Mitigated by warnings and a `beforeunload` guard; remedied by the phone-upload path. |
| **Cross-browser surface** | Three container/codec combinations, feature-detected. Unsupported browsers lose the control, not the capability. |
| **New storage** | **None.** Same bucket, same key discipline (TD-9), same magic-byte and size verification on `complete`. |
| **New endpoints** | **None.** |
| **New entities / columns** | **None.** |
| **TD-2 rows** | **None** — the recorder inherits the session's link authority. |
| **Schema change** | **None.** |

## 5 · What the Owner is being asked to approve

1. Moving the recorder from §10.1 into §4.9, **for `Session` only**.
2. **Reinstating and accepting risk R-4** in its re-scoped form.
3. The default-naming rule and its ` 2`/` 3` suffix.
4. That **elapsed time is UI only** and no duration is stored.

## 6 · If this is not approved

Nothing is lost and nothing is half-built: the phone-record-and-upload path is
the MVP behaviour, `SessionMaterialsDialog` already uploads and links, and a
recording made on a phone is already an ordinary `EducationalContent` appearing
in the session's recordings list.
