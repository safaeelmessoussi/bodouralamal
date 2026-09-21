# Online-class media provider — the MVP decision

**Status: decided. LiveKit (2026-08-20), and SELF-HOSTED on every tier (Owner decision,
2026-09-20, [SRS Revision 164](../SRS.md)) — LiveKit Cloud is not used anywhere.**

Localhost, Staging and Production run one media architecture, defined once in
`docker-compose.yml`: the LiveKit server, its Egress recorder, and the Redis they
coordinate through. Beneficiaries' audio, video and recordings never leave this
infrastructure — no LiveKit Cloud, no third-party STUN or TURN, no external bucket.
[How it is deployed](#how-it-is-deployed-srs-revision-164) and
[what it costs to run](#what-it-actually-costs-measured) are below; the comparison
that chose LiveKit follows them unchanged.

This is an **implementation choice**, recorded separately from the delivery
domain on purpose. [SRS R97.9](class-delivery.md) makes provider-independence
normative: the domain must survive replacing what is written here.

> **Status (R99, 2026-08-21): rooms, join authorization, the embedded classroom
> and **server-side recording** are IMPLEMENTED** — see
> [online-classroom.md](online-classroom.md), which is where the architecture
> and the durable rule live. **Recording capture, its lifecycle and its verified
> callback are done; INGESTION is not**: a finished recording is a verified
> staging object, and turning it into `EducationalContent` is the next slice.
>
> The decision below is reached through **one narrow application seam**
> (`backend/src/lib/online-class-provider.ts`, guarded by
> `scripts/ci/check-provider-seam.sh`), so the reach of it stays visible.

---

## How it is deployed (SRS Revision 164)

```
browser ──wss://<domain>/rtc──▶ nginx (443) ──▶ livekit:7880      signalling, same-origin
browser ──UDP 7882 / TCP 7881──────────────────▶ livekit           media — the two extra host ports
api     ──http://livekit:7880──▶ livekit                           rooms, tokens, start/stop recording
livekit ──webhook──▶ api  /api/v1/integrations/online-class/callback
egress  ──joins the room, composites it──▶ http://minio:9000       the recording, into OUR object store
```

* **Four published ports, each with one owner.** Nginx keeps 80/443. WebRTC media is
  UDP with a TCP fallback and cannot pass through a web proxy, so the media server
  publishes **7882/udp** (one multiplexed port for every participant, not a range)
  and **7881/tcp**. Its signalling port, 7880, is proxied by Nginx as `/rtc` and is
  never published. Host preflight and CI refuse any other published port, a
  published 7880, or a loopback-bound media port on a release tier.
* **The host's address is stated, never discovered.** LiveKit's default is to ask a
  public STUN server (Google's) what the host's address is. `use_external_ip: false`
  plus `LIVEKIT_NODE_IP` removes that call; preflight holds the value to the host's
  approved public IPv4.
* **No third-party STUN reaches a client either — and this one was NOT true at
  first.** LiveKit hands every client an ICE-server list, and with none configured
  that list is **Twilio's and Google's public STUN servers**: each beneficiary's
  browser would have disclosed its address to two third parties before class. It
  was found on Staging by reading a real browser's own `RTCPeerConnection`, after an
  earlier version of this page had claimed the opposite. There is no "none"
  setting, so it is closed from both ends: the media server names **only a dead
  port on its own host** (`stun_servers`, port 3478, enforced by preflight), which
  covers the recorder and any other client; and the classroom passes an explicit
  empty list (`online-classroom.tsx`), so a browser does not attempt STUN at all.
  Nothing is lost — a publicly addressed media server is reached by a client behind
  NAT without STUN.
* **Why a dead port and not the media port — measured, because the obvious choice
  was wrong.** Naming the media port itself (7882) was the first fix. Tested from
  outside, A/B, twice each: with the server's list naming 7882, media fell back to
  **TCP every time**; with an empty list, or with a dead port named, it used **UDP
  every time** and connected within four seconds. A browser's plain STUN request to
  the media port spoils that port's handling of the same client's real connection.
  Port 3478 is not published and is opened in no firewall.
* **One key pair, three readers.** The API, the media server and the recorder all
  read `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`; preflight refuses a release whose
  three copies differ. No secret is in Git: the media server's configuration is
  passed as an environment body with the keys arriving separately.
* **Recordings go straight into our object store.** The API hands Egress the target
  per request (`online-class-provider.ts`): this deployment's own S3 endpoint on the
  internal network, path-style, the staging bucket. The platform then verifies and
  imports the file into the content lifecycle and sweeps the staging object
  (R99.13). Egress's own `EG_*.json` manifest is switched off (`disableManifest`) —
  nothing read it, and it would have accumulated beside every recording forever.
* **Health.** Each of the three carries a Docker health check; `/healthz` is TD-14's
  fixed contract and deliberately does not cover them, because the platform serves
  everything else while the media server is down. The deployment runbook verifies
  the media stack as its own step.
* **The API does not depend on it.** With the media server down, «دخول الحصة»
  answers the truthful `503` it always has (R98) and nothing else degrades.

### Retention

| | Localhost, Staging | Production |
|---|---|---|
| Live media | never stored | never stored |
| The recorder's output | the staging bucket, swept on successful import; nothing else is written there | identical |
| A recording | `EducationalContent` in the content buckets, on the tier's `seaweedfs-data` volume | identical — and **persistent**: the same volume every recovery point already snapshots |
| Removing one | the ordinary content lifecycle (Trash → retention → storage retirement) | identical |
| Volume | a handful of test recordings; the whole object store may be discarded and recreated (Owner, 2026-09-20) | grows — see the capacity figures below |

### What a recording is called, and what she sees while it is made (SRS Revision 165 §1)

The **title** of the platform's own capture is *type — Subject — Surah(s) — main teacher's
public display name — date and time «إيقاف التسجيل» was pressed* (`sessionRecordingBaseName`,
`lib/recording-name.ts`), with R75.6's ` 2`, ` 3` for later recordings of one occurrence. The
instant is the recording's own `stopped_at`, never *now*, so a retried ingestion answers the
same. **The storage key and file name deliberately keep the older, person-free *Subject —
date***: a key carries a slug of its file name (TD-9) and must not carry somebody's name, and
it has to resolve identically on a retry (R99.15).

In the classroom the recording's state is **re-read every three seconds while it is
transitional** (`starting`, `stopping`, `processing`, `importing`) and no longer once it
settles; and the state line is not printed when it would only repeat the live «جاري التسجيل»
banner. Before this it was read once, so «جارٍ بدء التسجيل…» stayed beside a banner that
already said the recording was running.

### Which Level a recording is filed under, and what to do when an import is stranded (SRS Revision 166 §4)

`EducationalContent.level_id` is required, so the import resolves the class's Level —
through `scheduleLevelIds`, the one resolution the Subject and Surah rules use. It used to read
the three single-target columns only, and a class built through the five filters (every class
since Revision 163 §5) has none: each of its recordings was refused with *"the occurrence
resolves to no Level"*, spent its four retries on the same refusal, and the classroom said
*«انتهى التسجيل لكن تعذّرت تهيئته للنشر»*. A class addressing several Levels files its
recording under the first in the Levels' own order — deterministic, so a retry writes the same
row. **Known limit:** the content's Level is single, so a *private* recording of a two-Level
class is listed for the first Level's beneficiaries only.

The job retries under TD-7's backoff and then stops, which is right for a transient failure
and useless once a DEFECT is fixed: the staging object is still there and nothing is left to
try it. `npm run ops:requeue-recordings` — `src/ops/requeue-recording-ingest.ts`, under `src/` on
purpose: the release image ships compiled `src` and `prisma` only, and a recovery tool that
cannot run on the tier where recordings were stranded is a note, not a tool — puts the ordinary
import job back for
every recording that is `completed`, has an output object and no content — idempotently (the
job's first step is its own idempotency anchor), printing counts and recording ids only.
`-- --dry-run` lists without writing. On a release tier:
`docker compose … run --rm --no-deps api npm run -s ops:requeue-recordings -- --dry-run`. On Staging and Production it is a queue mutation and needs
the Owner's authorization like any other.

## What it actually costs (MEASURED)

Measured on 2026-09-20 with real rooms and real recordings (three participants,
synthetic media), sampled from `docker stats` — not taken from vendor guidance.

| | CPU | Memory |
|---|---|---|
| Media server, idle | ~0 | 63 MiB |
| Media server, a live three-party room being recorded | 0.35 core peak | 140 MiB |
| Recorder, idle | ~0 | 186 MiB |
| Recorder, one **720p/30 video** room recording | **1.7–1.9 cores sustained** | **~700 MiB** |
| Recorder, one **audio-only** room recording | a 2-second start spike, then **0.2–0.35 core** | **~360 MiB** |
| Redis | negligible | 3 MiB |
| The whole stack while a video records | **1.98 of 2 cores** when confined to two | **1.33 GiB** |

**With the entire stack confined to two cores the video still landed as true 30 fps** —
888 frames in 29.6 s, against 893 in 29.8 s unconfined — at ~1.4 Mbit/s H.264; audio
is Opus at ~130 kbit/s. So:

| Tier | Host | Verdict |
|---|---|---|
| Localhost | 8 threads, 15.7 GiB | ample |
| Staging | 2 vCPU, 3.8 GiB | memory comfortable; CPU heavily used for the length of a video recording, which still records cleanly. One recording at a time. **Confirmed on the host itself (2026-09-20):** a real recording of a participant connected across the internet came back from Staging's own store as 1280x720 at 29.99 fps (1,064 frames in 35.48 s), with the recorder at 1.1-1.4 cores / ~750 MiB, the host at 130-166% of its 200%, and 2.7 GB of memory still available. Acceptable for a test tier; stated, not hidden |
| Production | not yet provisioned | **at least 4 vCPU** (the provider matrix already asks for 4 vCPU / 8 GiB). On 2 vCPU every video recording would saturate a host serving real users. Preflight refuses a Production host with fewer than 4 |

**The trap this measurement found.** Egress refuses a recording when fewer cores are
idle than it believes the recording costs, and its default for a room recording is
**4**. On a 2-CPU host every *video* recording was refused with `503` while audio
worked — reproduced deliberately under a 2-CPU quota. The costs are therefore set
from the figures above: `EGRESS_VIDEO_CPU_COST` 2.0 and `EGRESS_AUDIO_CPU_COST` 1.0
in general, 1.5 and 0.5 on Staging, whose two cores could never satisfy 2.0 idle.
On Staging that admits one video recording and refuses a second — the protection
wanted, not a side effect.

**Capacity, for Production planning** (from the measured bitrates): audio-only
≈ **59 MB per recorded hour**; 720p video ≈ **0.63 GB per recorded hour**. A year of
ten recorded hours a week is therefore ≈ 31 GB if audio and ≈ 330 GB if video —
which is why audio-only is the default «نوع الاتصال» (Revision 163 §1), and why the
Owner-approved free-disk floor must be set with video in mind. **The recorder image itself
is 4 GB on disk** — it carries a browser — and took Staging below its 20-GiB floor until
superseded release images were removed; count it when sizing a host.

## The comparison

Weighted for *this* project: a small Moroccan nonprofit, an Express/Prisma/React
codebase with a deliberately tiny dependency surface, an existing Session-audience
(R92) and staffing (R91) authorization model, and MinIO storage.

| | **LiveKit** | **Daily** | **Agora** | **Jitsi / JaaS** | **Google Meet** | **Zoom SDK** |
|---|---|---|---|---|---|---|
| Embedded in the platform's own UI | ✅ components-react | ✅ strong | ✅ | ⚠️ iframe-centric | ❌ redirect out | ⚠️ heavy SDK |
| Tokens issued from **our** authorization | ✅ JWT, per-participant grants | ✅ | ✅ | ⚠️ JaaS ok, self-host fiddly | ❌ Google identity owns it | ⚠️ |
| Server-side recording surviving a lost tab | ✅ Egress | ✅ | ✅ | ⚠️ Jibri, heavy | ⚠️ Workspace tier | ✅ |
| Audio-only recording | ✅ `audio_only` → OGG | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |
| Writes to **our** S3/MinIO | ✅ `endpoint` + `force_path_style` | ✅ | ⚠️ | ✅ self-host | ❌ Drive | ⚠️ |
| Webhooks with signature verification | ✅ `WebhookReceiver` | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| Self-host later, **same domain model** | ✅ same OSS server, swap URL + keys | ❌ SaaS only | ❌ | ✅ | ❌ | ❌ |
| Licence | Apache-2.0 | proprietary | proprietary | Apache-2.0 | proprietary | proprietary |
| No personal phone/Google identity required | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Local dev with no paid credentials | ✅ `livekit-server --dev` | ❌ | ❌ | ✅ | ❌ | ❌ |
| Maintainable by this project for years | ✅ small surface, exact-pinnable | ✅ | ⚠️ large API | ❌ ops burden | ⚠️ | ⚠️ |

## Why LiveKit over the strongest alternative

**Daily** is the closest competitor and genuinely excellent on developer
experience and recording. LiveKit wins on the two dimensions that are strategic
rather than convenient for this association:

1. **Apache-2.0 with an identical self-hostable server.** The exit is a
   configuration change, not a rewrite. Daily has no self-host path at all, and
   this association will outlive several vendor decisions.
2. **`livekit-server --dev` runs the signalling stack locally** with fixed
   credentials, so ordinary test suites never touch a paid account. Daily cannot
   offer this.

**Jitsi** is the only other Apache-2.0 option and loses precisely where strength
is needed: Jibri recording is a heavy operational commitment, and the embedded
experience is iframe-shaped rather than component-shaped.

## Versions verified from the registry (2026-08-20)

All Apache-2.0, all compatible with React 19.2.8 and Node ≥ 24.11:

| package | version |
|---|---|
| `livekit-server-sdk` | 2.18.0 |
| `livekit-client` | 2.22.0 |
| `@livekit/components-react` | 2.9.24 (peer `livekit-client ^2.20.1` ✓) |
| `@livekit/components-styles` | 1.2.0 |

Pin **exactly**, per this repository's dependency policy — no carets.

---

## Two infrastructure findings that shape the next sections

Recorded now because they change the plan rather than merely colour it.

### 1. Egress is a separate service and generally needs Redis

`livekit-server --dev` gives rooms and media locally; it does **not** include
Egress. Real *recording* verification therefore needs an additional egress
container plus Redis. Budget for it in the recording section rather than
discovering it there.

> **Confirmed and paid for in R99 (2026-08-21).** Both containers are now in the
> dev overlay. Two details the finding did not anticipate: `--dev` had to be
> **replaced by a config file**, because the flag can express neither a Redis
> address nor a webhook target; and the Egress worker composites the room in a
> headless browser, so it needs `shm_size: 1gb` — the default 64 MB crashes
> Chrome part-way through a long lesson.

### 2. LiveKit Cloud Egress could not have written to this deployment's store

> **Historical — Cloud is not used (SRS Revision 164).** Kept because it is one of the two
> reasons self-hosting was chosen: a self-hosted recorder writes to the internal endpoint directly.

The S3 output `endpoint` **must start with `https://`**, and the egress worker
uploads *from LiveKit's side*. This MinIO is bound to `127.0.0.1:9001` with no
TLS, so it is unreachable.

**The consequence for the design:** Egress writes to a LiveKit-reachable bucket
and the platform **imports** the object into MinIO through the existing content
lifecycle. That is also what keeps `EducationalContent` the single truth for a
recording — no `Session.recording_url`.

### Cost, honestly bounded

> **Historical — no paid tier is involved any more.** The cost is now the host's own CPU and
> disk, [measured above](#what-it-actually-costs-measured).

The free *Build* tier includes **5,000 WebRTC participant-minutes/month**. A
three-hour class with a teacher, an assistant and ten students is ~2,160
participant-minutes — about **two classes a month** before the tier is
exhausted, so realistic use means a paid tier. The paid tier's *WebRTC*
inclusions and the Egress rates were **not verifiable** from the public pricing
page and must be confirmed at signup rather than assumed.

---

## What implementing it actually cost (R98, 2026-08-20)

Recorded because the next section inherits it, and because two of the three were
invisible to every test that is not a browser.

* **The packages are the four pinned above, exactly**, and nothing else. No
  egress client, no Redis client, no package added "for later recording". The
  backend takes `livekit-server-sdk` only; the client takes
  `livekit-client`, `@livekit/components-react` and `@livekit/components-styles`.
  None introduced a security advisory.
* **The browser's URL is NOT the server's.** `LIVEKIT_URL` is handed to the
  client, so locally it is a host-published port — and inside the API container
  that same address is the container's own loopback. R98 never noticed because
  it only ever handed the URL to a browser; it broke the moment the server had
  to call the provider itself, with every recording failing on «fetch failed»
  while the media worked perfectly. Hence `LIVEKIT_API_URL` (TD-13).
* **§3.1's CSP blocks the media server**, and must name its origin in **both**
  schemes — `wss:` *and* `https:` — because the client validates over HTTP
  before upgrading. Listing only the socket origin fails with *«could not
  establish signal connection: Failed to fetch»* and **no CSP violation event**,
  since the blocked request is the HTTP one. `nginx/snippets/media-origin.conf`.
* **No tier needs an account at all.** The media server is this deployment's own
  container on every tier (Revision 164), so the browser harness proves a real
  three-party room and nothing ever consumes cloud minutes.
* **A headless browser needs fake media devices** (`--use-fake-device-for-media-stream`,
  `--use-fake-ui-for-media-stream`): the tracks are synthetic, the signalling,
  the room and the connection are real.

---

## What this decision does not license

* No provider identifier on `RecurringCourseSchedule`, `Session` or the calendar
  occurrence projection (R97.9).
* No API secret reaches the frontend. Tokens are minted server-side from the
  platform's own authorization — the R92 audience and R91 staffing — and never
  from role membership.
* A QR-style rule applies to a room token as much as to anything else: it
  authorises exactly the participant it was minted for, and nothing about
  possessing a room name grants entry.
