# Online-class media provider — the MVP decision

**Decided: LiveKit (2026-08-20), SELF-HOSTED on every tier (Owner, 2026-09-20, [SRS Revision 164](../SRS.md)); LiveKit Cloud is used nowhere.**

- One media architecture on every tier, defined once in `docker-compose.yml`: LiveKit server, Egress recorder, their Redis.
- Media and recordings never leave this infrastructure: no Cloud, no third-party STUN/TURN, no external bucket.
- Implementation choice only; [R97.9](class-delivery.md) makes provider-independence normative. Architecture and rules: [online-classroom.md](online-classroom.md).
- One seam: `backend/src/lib/online-class-provider.ts`, guarded by `scripts/ci/check-provider-seam.sh`.

## How it is deployed (SRS Revision 164)

```
browser ──wss://<domain>/rtc──▶ nginx (443) ──▶ livekit:7880   signalling, same-origin
browser ──UDP 7882 / TCP 7881──────────────────▶ livekit        media
api     ──http://livekit:7880──▶ livekit                        rooms, tokens, recording
livekit ──webhook──▶ api  /api/v1/integrations/online-class/callback
egress  ──composites the room──▶ http://minio:9000              recording into OUR store
```

- Four published ports, one owner each: nginx 80/443; media **7882/udp** (one multiplexed port) and **7881/tcp**; signalling 7880 proxied as `/rtc`, never published. Preflight and CI refuse any other published port, a published 7880, or a loopback-bound media port on a release tier.
- Host address stated, never discovered: `use_external_ip: false` + `LIVEKIT_NODE_IP` (preflight pins it to the approved public IPv4) removes the default call to Google's STUN.
- No third-party STUN reaches a client: unconfigured, LiveKit hands clients Twilio's and Google's STUN servers (found on Staging via a real `RTCPeerConnection`); no "none" setting, so the server names only a dead port on its own host (`stun_servers`, port 3478, preflight-enforced, unpublished, no firewall rule) and the classroom passes an empty list (`online-classroom.tsx`). A publicly addressed server needs no STUN for a NAT client.
- Dead port, not 7882 (A/B from outside, twice each): naming 7882 → TCP fallback every time; empty list or dead port → UDP every time, connected within four seconds.
- One key pair, three readers: `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` for API, server and recorder; preflight refuses differing copies; server config is an environment body, keys arrive separately, nothing in Git.
- Recordings go to our store: the API hands Egress the target per request (`online-class-provider.ts`) — internal S3 endpoint, path-style, staging bucket; the platform verifies, imports and sweeps (R99.13). `EG_*.json` manifest off (`disableManifest`).
- Health: Docker health checks on all three; `/healthz` (TD-14) deliberately excludes them; the runbook verifies the media stack as its own step.
- Media server down → «دخول الحصة» answers `503` (R98); nothing else degrades.

### Retention

| | Localhost, Staging | Production |
|---|---|---|
| Live media | never stored | never stored |
| Recorder output | staging bucket, swept on import; nothing else written there | identical |
| A recording | `EducationalContent` in the content buckets on the tier's `seaweedfs-data` volume | identical, persistent — the volume every recovery point snapshots |
| Removing one | content lifecycle (Trash → retention → storage retirement) | identical |
| Volume | few test recordings; the store may be discarded and recreated (Owner, 2026-09-20) | grows — see capacity |

### Naming and classroom state (SRS Revision 165 §1)

- Title: *type — Subject — Surah(s) — main teacher's public display name — date/time «إيقاف التسجيل» pressed* (`sessionRecordingBaseName`, `lib/recording-name.ts`), R75.6 ` 2`, ` 3` suffixes; instant = the row's `stopped_at`, never *now*.
- Storage key/file name keep the person-free *Subject — date*: keys carry a file-name slug (TD-9), no names, identical on retry (R99.15).
- Classroom re-reads state every three seconds while transitional (`starting`, `stopping`, `processing`, `importing`), stops once settled, omits the line when it would repeat «جاري التسجيل».

### Level of a recording; stranded imports (SRS Revision 166 §4)

- `EducationalContent.level_id` is required; import resolves it via `scheduleLevelIds` (reading the three single-target columns alone refused every filter-built class with *"the occurrence resolves to no Level"* and «انتهى التسجيل لكن تعذّرت تهيئته للنشر»).
- Several Levels → first in the Levels' own order (deterministic on retry). Owner-kept limit (R167 §5): a private recording over SOME Levels is listed for the first Level only.
- EVERY live Level of one Category → filed under the first Level, marked `whole_category`, read by every Level of the Category ([database](../architecture/database.md)); staff toggle it in مكتبة المحتوى → تعديل.
- Since R167 §5: `session-recording-reconcile` every fifteen minutes re-queues unsucceeded imports, asks the provider about missing callbacks, believes a staged file where the provider has no answer ([background jobs](../architecture/background-jobs.md)).
- `npm run ops:active-recordings` (read-only; exit `3` while anything records) before restarting the recorder.
- `npm run ops:requeue-recordings` (`src/ops/requeue-recording-ingest.ts`, under `src/` because the release image ships compiled `src` and `prisma` only): re-queues the import for every `completed` recording with an output object and no content, idempotently; prints counts and ids; `-- --dry-run` lists; release: `docker compose … run --rm --no-deps api npm run -s ops:requeue-recordings -- --dry-run`; a queue mutation needing Owner authorization on Staging/Production. Exists because TD-7 backoff stops after a since-fixed defect.

## A recorder that dies mid-class loses nothing recorded (R168 §2)

Two outputs of one encode per recording:

| Output | Where | Reaches storage |
|---|---|---|
| Final file | `session-recordings/<session>/<recording>.mp4` | once, at class end |
| Ten-second HLS safety segments + playlist | `session-recordings/<session>/<recording>.segments/` | each segment when complete |

Established by `scripts/dev/browser/verify-recorder-crash.sh` on the real stack:
- HLS is AAC, so everything is: صوت فقط is AAC in MP4 (`audio/mp4`), no longer Opus/OGG — TD-9 type, plays on every iPhone.
- Key is `.mp4` for both kinds: asked for `<id>.m4a` the recorder writes and reports `<id>.m4a.mp4`; `mime_type` says what it is; the segments folder derives from the recording ID (name up to first dot), never «key minus one extension».
- Provider's word is not evidence of life: a SIGKILLed recorder stays «active» indefinitely; silence (no segment in ten seconds) is the fact (`services/session-recording-segments.ts`).

| Who notices | After | What happens |
|---|---|---|
| Classroom | 20 s of the ROOM recording nothing while the row says `recording` | «توقّف المسجِّل… ما سُجِّل محفوظ»; «بدء التسجيل» offered again |
| `POST /sessions/{id}/recording` | 90 s without a segment (checked against storage, not her click) | dead recording retired (`processing`; provider asked to stop — a recorder alive after all delivers its full file, which wins); new recording starts |
| `session-recording-reconcile` | 10 min without a segment, after at least one | retires likewise |
| later pass | retired or provider-failed, no final file, segments quiet | `ffmpeg` remuxes segments (`-c copy`, stdin, nothing on disk) into `output_key`; row `completed` + `recovered_from_segments`; ordinary import publishes and sweeps file, segments, playlist |

- Recovered item says so in «الوصف»; at most one segment may be missing.
- `ffmpeg`: one static binary, pinned by digest, in a shared layer (Debian's package = +481 MB, ~200 packages).
- `npm run ops:recording-segments -- <recording-id>` (read-only): storage's segments, newest time, provider's view side by side. `npm run ops:reconcile-recordings`: one pass now.
- TD-9's 100 MB / 500 MB caps bound person uploads only (would refuse audio > ≈1 h 40, video > ≈47 min); platform capture capped at 5 GiB (`platformRecordingCap`). Staging holds segments + final file (~2× size) until the import sweeps both.

## What it actually costs (MEASURED)

2026-09-20, real rooms and recordings, three participants, synthetic media, `docker stats`.

| | CPU | Memory |
|---|---|---|
| Media server, idle | ~0 | 63 MiB |
| Media server, live three-party room recorded | 0.35 core peak | 140 MiB |
| Recorder, idle | ~0 | 186 MiB |
| Recorder, one 720p/30 video recording | 1.7–1.9 cores sustained | ~700 MiB |
| Recorder, one audio-only recording | 2 s start spike, then 0.2–0.35 core | ~360 MiB |
| Redis | negligible | 3 MiB |
| Whole stack while video records | 1.98 of 2 cores (confined to two) | 1.33 GiB |

- Confined to two cores, still true 30 fps: 888 frames / 29.6 s vs 893 / 29.8 s unconfined; ~1.4 Mbit/s H.264; audio Opus ~130 kbit/s.

| Tier | Host | Verdict |
|---|---|---|
| Localhost | 8 threads, 15.7 GiB | ample |
| Staging | 2 vCPU, 3.8 GiB | memory fine; CPU heavily used per video recording, records cleanly; one at a time. On the host (2026-09-20): internet participant recorded at 1280x720, 29.99 fps (1,064 frames / 35.48 s), recorder 1.1–1.4 cores / ~750 MiB, host 130–166 % of 200 %, 2.7 GB free |
| Production | not provisioned | ≥ 4 vCPU (matrix: 4 vCPU / 8 GiB); 2 vCPU would saturate under one video recording; preflight refuses < 4 |

- Egress refuses a recording when idle cores < its believed cost (default 4): on 2 CPUs every video recording was `503`, audio worked. Set from the figures: `EGRESS_VIDEO_CPU_COST` 2.0 / `EGRESS_AUDIO_CPU_COST` 1.0; Staging 1.5 / 0.5 — one video recording admitted, a second refused, by design.
- Capacity: audio ≈ 59 MB per recorded hour; 720p ≈ 0.63 GB/h; ten hours a week for a year ≈ 31 GB audio / ≈ 330 GB video — why audio-only is the default «نوع الاتصال» (R163 §1) and the free-disk floor assumes video.
- Recorder image is 4 GB on disk (carries a browser); it took Staging under its 20-GiB floor until old release images were removed — count it when sizing.

## The comparison

Weighted for a small Moroccan nonprofit, a tiny dependency surface, existing R92/R91 authorization, MinIO.

| | **LiveKit** | **Daily** | **Agora** | **Jitsi / JaaS** | **Google Meet** | **Zoom SDK** |
|---|---|---|---|---|---|---|
| Embedded in our UI | ✅ components-react | ✅ | ✅ | ⚠️ iframe | ❌ redirect | ⚠️ heavy SDK |
| Tokens from our authorization | ✅ JWT per-participant grants | ✅ | ✅ | ⚠️ self-host fiddly | ❌ Google identity | ⚠️ |
| Server-side recording surviving a lost tab | ✅ Egress | ✅ | ✅ | ⚠️ Jibri, heavy | ⚠️ Workspace tier | ✅ |
| Audio-only recording | ✅ `audio_only` | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |
| Writes to our S3/MinIO | ✅ `endpoint` + `force_path_style` | ✅ | ⚠️ | ✅ self-host | ❌ Drive | ⚠️ |
| Signed webhooks | ✅ `WebhookReceiver` | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| Self-host, same domain model | ✅ same OSS server | ❌ SaaS only | ❌ | ✅ | ❌ | ❌ |
| Licence | Apache-2.0 | proprietary | proprietary | Apache-2.0 | proprietary | proprietary |
| No personal phone/Google identity | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Local dev without paid credentials | ✅ `livekit-server --dev` | ❌ | ❌ | ✅ | ❌ | ❌ |
| Maintainable for years | ✅ small, exact-pinnable | ✅ | ⚠️ large API | ❌ ops burden | ⚠️ | ⚠️ |

- Over Daily: Apache-2.0 + identical self-hostable server (exit = config change; Daily has no self-host), and `--dev` signalling with fixed credentials keeps suites off paid accounts.
- Jitsi (other Apache-2.0 option) loses on Jibri's operational weight and iframe embed.

## Versions verified from the registry (2026-08-20)

Apache-2.0, React 19.2.8 / Node ≥ 24.11 compatible; pin exactly, no carets.

| package | version |
|---|---|
| `livekit-server-sdk` | 2.18.0 |
| `livekit-client` | 2.22.0 |
| `@livekit/components-react` | 2.9.24 (peer `livekit-client ^2.20.1` ✓) |
| `@livekit/components-styles` | 1.2.0 |

## Infrastructure findings

- Egress is a separate service needing Redis; `--dev` lacks it. R99: both containers in the dev overlay; `--dev` replaced by a config file (cannot express Redis address or webhook target); Egress needs `shm_size: 1gb` (default 64 MB crashes its Chrome mid-lesson).
- Historical (Cloud unused since R164): Cloud Egress needs an `https://` S3 `endpoint` reachable from LiveKit; this MinIO is `127.0.0.1:9001` without TLS — one reason for self-hosting. Design kept: Egress writes to a reachable bucket, the platform imports it through the content lifecycle; `EducationalContent` is the single truth, no `Session.recording_url`.
- Cost is the host's own CPU and disk ([measured](#what-it-actually-costs-measured)); no paid tier.

## What implementing it cost (R98, 2026-08-20)

- Exactly the four packages above: backend `livekit-server-sdk`; client `livekit-client`, `@livekit/components-react`, `@livekit/components-styles`; no advisories.
- Browser URL ≠ server URL: `LIVEKIT_URL` goes to the client (host-published port, loopback inside the API container); server-side calls failed «fetch failed» until `LIVEKIT_API_URL` (TD-13).
- §3.1 CSP must name the media origin as both `wss:` and `https:` (client validates over HTTP before upgrading); socket-only fails *«could not establish signal connection: Failed to fetch»* with no CSP violation event — `nginx/snippets/media-origin.conf`.
- No tier needs an account (R164); the harness proves a real three-party room.
- Headless browser needs `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`: synthetic tracks, real signalling/room/connection.

## What this decision does not license

- No provider identifier on `RecurringCourseSchedule`, `Session` or the occurrence projection (R97.9).
- No API secret in the frontend; tokens minted server-side from R92 audience and R91 staffing, never role membership.
- A room token authorises exactly its participant; a room name grants nothing.
