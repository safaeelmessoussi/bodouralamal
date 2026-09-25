# Entering a class عن بُعد — بذور الأمل authorizes, the provider executes

SRS Revisions 98 and 99: the join and the recording. Delivery is [class-delivery.md](class-delivery.md) (R97); the provider is [online-class-provider.md](online-class-provider.md).

> ## بذور الأمل AUTHORIZES; the media provider EXECUTES the media session.
>
> Room membership is never evidence of authorization; the provider is never asked who is present; nothing it reports enters a permission decision.

## The flow

```
POST /sessions/{id}/online-join      ← Session id, EMPTY body
 ├─ TD-12 freshness .... roles/status re-read from live rows
 ├─ the occurrence ..... online? not cancelled?   → else 409 + reason
 ├─ WHO IS ASKING ...... staff → administration → beneficiary side
 ├─ the join window .... server time, AFTER authorization
 ├─ the room ........... DERIVED from the Session id, never stored
 └─ the credential ..... minted with exactly the permissions decided
provider: a bounded participant token; no key, no room API.
```

- `onlineJoinSchema` is an empty `.strict()` object: a body naming identity, name, room, role, permissions or expiry is `400`.

## Who may enter

| door | authority | resolved by |
|---|---|---|
| teaching staff | R91 effective assignment | `staffsSession`: `SessionStaff` first (one-off cover), then schedule assignments effective on the occurrence's date |
| administration | the branch scope that edits the occurrence | `branch-scope`; no «admin ⇒ every room» shortcut |
| beneficiary / guardian | R92 audience, §4.3 approved `FamilyLink` | `audienceForSession` + `audienceWhere`, `resolveActingStudent` |

- Precedence: a مؤطِّرة who is also a parent opens the class she teaches as its مؤطِّرة.
- Nothing re-implemented: a second audience query is the failure [R92 names](class-delivery.md); every scope and the cross-branch override work unnamed here.
- Refused: expired مؤطِّرة, future مؤطِّرة, R88 capability-only مؤطِّرة (planning data staffs nothing); a one-off cover enters that occurrence only.
- Assistant = identical operational authority to the main مؤطِّرة (R87 §G); position reported for audit ([teaching-authority.md](teaching-authority.md)).
- Guardian enters AS THE CHILD: credential carries the child's identity and display name; the guardian gains no beneficiary role; authority is the approved `FamilyLink`, re-read per request; revoked link and forged child are both `404`, indistinguishable (§4.3).

## The room is derived

- `sha256("bodour.online-class.v1:" + session.id)` → `bodour-<32 hex>`; stored nowhere (R97.9 forbids a provider identifier on `RecurringCourseSchedule`, `Session`, the occurrence projection).
- No `OnlineRoom` table (refused): the provider opens on first authorised join and closes when the last leaves; nothing to create, reconcile or clean up; repeated requests write nothing.
- The name is not a secret and grants nothing; opacity is hygiene (timetable out of third-party logs).

## The join window

| | |
|---|---|
| opens | 15 minutes before scheduled start |
| closes | 30 minutes after scheduled end (reconnection allowance) |
| clock | the server's, association timezone (TD-13 `TZ`) |
| credential lifetime | bounded by the window; never timeless, never past 6 hours, never under a minute |

- Evaluated AFTER authorization: an unauthorised caller gets `404`, never «الحصة لم تبدأ بعد» (§20 rule 17).

## What the credential carries

| | publish | subscribe | moderation | sources |
|---|---|---|---|---|
| beneficiary | yes | yes | no | mic + camera (`audio_video`) |
| مؤطِّرة / assistant | yes | yes | yes | mic + camera |
| administrator | yes | yes | no | mic + camera |
| any, `audio_only` | yes | yes | as above | microphone only |

- «صوت فقط» is in the token (a modified client cannot publish a camera); the client never requests one either.
- Never issued: room creation, room listing, ingress, recording (capture is server-side).

## One classroom, for every portal

- `/classroom/{sessionId}` for every role; adapts to `media_mode` and `role` from the credential; no per-portal classroom (rule C).
- Inside بذور الأمل, Arabic, RTL, no vendor named on any surface a beneficiary, parent or مؤطِّرة reads (rule M); she enters «حصة».
- صوت فقط is a listening surface: camera never requested (`video={false}`), no empty video grid, speaker marked by a word and a highlight (rule AV), camera control absent not disabled.
- Failures are sentences with the next step — no exception, SDK string or bare code; a camera failure does not end an `audio_video` class.

## The public calendar is unchanged

- May say «عن بُعد»; never exposes a way in, a room identity or a credential; «دخول الحصة» only for an authenticated reader on a `session` delivered `online`.
- Entry is not decided in the client (rule O): the button is a link, the classroom asks the server. Probing at dialog-open rejected (a request per occurrence looked at; stale by the click).

## Recording a class (R99)

- Optional and explicit: joining starts nothing; without «بدء التسجيل» there is no provider job, file or row (asserted directly).
- `startRecording` runs all of `authorizeJoin` first, then: may this role record?

| | start / stop | see «جاري التسجيل» |
|---|---|---|
| مؤطِّرة, assistant | ✅ identical (R87 §G) | ✅ |
| administrator in scope | ✅ | ✅ |
| beneficiary, guardian | 403 `RECORDING_NOT_PERMITTED` | ✅ |

- `403` not `404`: she is legitimately in the class (§20 rule 17 conceals only what is outside reach).
- Stopping is not restricted to the starter.
- «جاري التسجيل» is driven by `useIsRecording()` (room state): true for every participant at once, for late joiners, after the starter leaves.
- Capture is a room-composite Egress job, not a tab; `verify-livekit-join` closes the starter's tab mid-recording and asserts it still runs.

| class | output |
|---|---|
| `audio_video` | MP4 with audio |
| `audio_only` | AAC in MP4 (`audio/mp4`); OGG until R168 §2 (HLS safety segments are AAC, one codec per recording — [provider page](online-class-provider.md#a-recorder-that-dies-mid-class-loses-nothing-recorded-r168-2)); plays on every iPhone |

- `recordingCommandSchema` is empty `.strict()`: a body with `media_mode` is `400`.

### State machine

```
starting ─┬─→ recording ─→ stopping ─→ processing ─→ completed
          │        └──────────┴───────────┴────────→ failed / aborted
          └─→ (stopping, processing, completed, failed, aborted)
completed · failed · aborted  →  terminal
```

- Guard in the `where`, not read-then-write (simultaneous callbacks).
- `starting → stopping` is a transition (بدء then change of mind); its absence once froze the screen on «جارٍ بدء التسجيل».

### The callback

`POST /integrations/online-class/callback` — the only route outside the guarded router. A row changes only when: (1) the provider's signature over the RAW body verifies — mounted before the JSON parser; (2) the event names an egress job this platform started; (3) the transition is allowed. Always `204` (a distinguishable refusal informs a prober; a `4xx` makes the provider retry forever).

### Failure shapes

- Two staff press بدء at once: the partial unique index on live states decides; the loser gets the winning recording, not a 500.
- Provider accepts, database write fails: the handle is captured before the write and the orphan cancelled with `updateMany` (the failure path must not fail).

### Provider output is staging, never the asset

- Egress writes to `RECORDING_STAGING_BUCKET` (owned, not served); `completed` ≠ availability.
- The completion callback persists the report and inserts a `session-recording-ingest` job in the same transaction (§16.2, §20 rule 8); it never copies (up to 500 MB; a timed-out webhook retries).
- Job: verify bytes in staging → server-side copy to the content bucket → `EducationalContent` (`origin = session_recording`) + `SessionContent` → set `session_recording.educational_content_id` → sweep staging. See [background jobs](../architecture/background-jobs.md#session-recording-ingest--provider-completed-is-not-bodour-متاح) and [storage](../architecture/storage.md#the-third-bucket-recordings-staging-r99).
- Failed final delete: still «متاح»; the failed job retries, reads the relation first, performs only the exact staging cleanup; no second queue, no bucket sweep.
- `GET` carries `status` (provider's) and `availability` (association's):

| `availability` | she reads | when |
|---|---|---|
| `capturing` | «جارٍ بدء التسجيل…» · «جاري التسجيل» · «جارٍ إيقاف التسجيل…» | live |
| `processing` | «تتم معالجة التسجيل…» | provider finalising |
| `importing` | «انتهى التسجيل، وتتم تهيئته للنشر.» | provider `completed`, no library item |
| `available` | «التسجيل متاح الآن…» | `educational_content_id` set |
| `import_failed` | «تعذّرت تهيئته للنشر… ستُعاد المحاولة» | last import refused |
| `failed` | «تعذّر تسجيل هذه الحصة.» | capture failed/aborted |

- «متاح» = `educational_content_id IS NOT NULL`, never stored (R99.14).
- A failed IMPORT is not a failed RECORDING; only the import retries; `ingestion_failure_reason` is its own column.

### Naming

- The server names recordings (R75.6: class + date base, then ` 2`, ` 3`) in [`backend/src/lib/recording-name.ts`](../../backend/src/lib/recording-name.ts); browser recorder and provider capture share one namespace per occurrence; the browser still shows the name editable before saving. Rule: [UX](ux-architecture.md#the-recordings-name-belongs-to-the-server-r756-moved-by-r99).

### Local infrastructure

- `livekit-server --dev` records nothing; Egress + Redis are dev-overlay containers: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d redis livekit livekit-egress`.
- Explicit configuration (not `--dev`), since R164 in `docker-compose.yml` on every tier ([deployment](online-class-provider.md#how-it-is-deployed-srs-revision-164)); Egress needs `shm_size: 1gb` (64 MB crashes Chrome mid-lesson).

## The provider seam

- `backend/src/lib/online-class-provider.ts` is the one backend file knowing a media platform; `scripts/ci/check-provider-seam.sh` fails on a second file, a vendor name in user text, or an early recording capability. Purpose: auditable reach, not cheap swapping.
- One method, `issueJoinCredentials`; room creation, presence (§4.7: a participant list is not attendance nor an authorization input) and recording are not the provider's to answer.

## Configuration

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (TD-13): all three or none. None = no «دخول الحصة», join route answers `503 SERVICE_UNAVAILABLE` naming the settings; some = refused at boot. The secret never leaves the API process.
- CSP (§3.1 `default-src 'self'`) names the media origin as BOTH `wss:` and `https:` (`ws:`/`http:` locally) — the client validates over HTTP before upgrading; socket-only fails *«could not establish signal connection: Failed to fetch»* with no CSP violation event. `nginx/snippets/media-origin.conf`; development mounts `media-origin.dev.conf` over it.

## Local development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d livekit
# .env
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecretdevsecretdevsecretdevsecret
```

- `--dev`: fixed key pair, no paid account, no Egress, no Redis.

## What is guarded

| property | guard |
|---|---|
| Authorization, four refusals, R91 · R92 · guardian · window · grants | `backend/src/services/online-class.integration.test.ts` |
| Wire shape, no secret, `X-Active-Child-ID`, forged bodies; callback refusals over real HTTP with raw bodies | `backend/src/controllers/online-class.http.integration.test.ts` |
| Join button placement, one classroom, one route, Arabic failures | `frontend/src/components/classroom/classroom.test.tsx` |
| One vendor file · no vendor in user text · no recording grant | `scripts/ci/check-provider-seam.sh` |
| Recording lifecycle, concurrency, orphan cancellation, out-of-order callbacks | `backend/src/services/session-recording.integration.test.ts` |
| Real three-party room, real media in both formats, capture surviving the starter's tab closing (found the CSP) | `scripts/dev/browser/verify-livekit-join.sh` |
| Ingestion: bytes verified, durable copy, one content row under concurrency, mixed-origin naming, failure and retry | `backend/src/services/session-recording-ingest.integration.test.ts` |
| Real recording played by an authorised beneficiary, refused for a different Level | `scripts/dev/browser/verify-livekit-ingest.sh` |
