# Online-class media provider — the MVP decision

**Status: decided (2026-08-20). LiveKit, for the MVP, with a self-hosting path.**

This is an **implementation choice**, recorded separately from the delivery
domain on purpose. [SRS R97.9](class-delivery.md) makes provider-independence
normative: the domain must survive replacing what is written here.

> **Status (R98, 2026-08-20): rooms, join authorization and the embedded
> classroom are IMPLEMENTED** — see [online-classroom.md](online-classroom.md),
> which is where the join architecture and the durable rule live. **Recording is
> still not built**: no Egress, no Redis, no recording grant, no import into
> `EducationalContent`.
>
> The decision below is reached through **one narrow application seam**
> (`backend/src/lib/online-class-provider.ts`, guarded by
> `scripts/ci/check-provider-seam.sh`), so the reach of it stays visible.

---

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

### 2. LiveKit Cloud Egress cannot write to this deployment's MinIO

The S3 output `endpoint` **must start with `https://`**, and the egress worker
uploads *from LiveKit's side*. This MinIO is bound to `127.0.0.1:9001` with no
TLS, so it is unreachable.

**The consequence for the design:** Egress writes to a LiveKit-reachable bucket
and the platform **imports** the object into MinIO through the existing content
lifecycle. That is also what keeps `EducationalContent` the single truth for a
recording — no `Session.recording_url`.

### Cost, honestly bounded

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
* **§3.1's CSP blocks the media server**, and must name its origin in **both**
  schemes — `wss:` *and* `https:` — because the client validates over HTTP
  before upgrading. Listing only the socket origin fails with *«could not
  establish signal connection: Failed to fetch»* and **no CSP violation event**,
  since the blocked request is the HTTP one. `nginx/snippets/media-origin.conf`.
* **Local development needs no account at all.** `livekit-server --dev` is a
  dev-overlay container with a fixed key pair, so the browser harness proves a
  real three-party room and CI consumes no cloud minutes.
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
