# Entering a class عن بُعد — بذور الأمل authorizes, the provider executes

**SRS Revision 98.** How a person gets into an online class, and — far more
important — how the platform decides she may.

> **The durable rule, and everything on this page is a consequence of it:**
>
> ## بذور الأمل AUTHORIZES; the media provider EXECUTES the media session.
>
> The inverse is prohibited in terms. Membership of a provider's room is never
> evidence of authorization, the provider is never asked who is present, and
> nothing it reports may enter a permission decision. Reading it the other way
> makes a third party the identity provider for a platform serving minors.

Delivery itself — *is this class حضوري or عن بُعد* — is
[class-delivery.md](class-delivery.md) and R97. The provider choice is
[online-class-provider.md](online-class-provider.md). This page is the join.

---

## The whole flow, in order

```
client:  POST /sessions/{id}/online-join     ← the Session id, and an EMPTY body
   │
   ├─ TD-12 freshness ....... roles and status re-read from live rows
   ├─ the occurrence ........ online?  not cancelled?      → else 409 + reason
   ├─ WHO IS ASKING ......... staff → administration → beneficiary side
   ├─ the join window ....... server time, AFTER authorization
   ├─ the room .............. DERIVED from the Session id — never stored
   └─ the credential ........ minted with exactly the permissions decided
   │
provider:  a bounded participant token. Nothing else. No key, no room API.
```

Everything the client could have forged, it cannot say: participant identity,
display name, room, role, permissions and expiry are all resolved server-side,
and `onlineJoinSchema` is an **empty `.strict()` object** so a body naming any of
them is a `400` at the boundary rather than a value some service might read.

---

## Who may enter, and through which door

Precedence matters for a dual-role account: a مؤطِّرة who is also a parent opens
the class **she teaches** as its مؤطِّرة.

| door | the authority | resolved by |
|---|---|---|
| **teaching staff** | R91 effective assignment | `staffsSession` — `SessionStaff` first (where a one-off cover lives), then the schedule's assignments **effective on that occurrence's date** |
| **administration** | the same branch scope that already edits the occurrence | `branch-scope` — no *«admin ⇒ every room»* shortcut exists anywhere |
| **beneficiary / guardian** | R92 audience, §4.3 approved `FamilyLink` | `audienceForSession` + `audienceWhere`, and `resolveActingStudent` |

**Nothing here is re-implemented.** Every one of those resolvers already existed;
a second audience query is the failure [R92 names in terms](class-delivery.md),
and it is why whole-Level scope, Administrative-Group scope, Teaching-Circle
scope and R92's cross-branch override all work here without this code knowing
any of them by name.

### Four refusals that are the point, not the edge

* **An expired مؤطِّرة** — her period ended yesterday; today's class is not hers.
* **A future مؤطِّرة** — her period begins next month.
* **A مؤطِّرة who merely *declared* she can teach the subject (R88)** — capability
  is planning data. It staffs nothing, so it opens nothing.
* **A one-off cover** — enters *that* occurrence and no other. The next week
  resolves normally.

An **assistant holds identical operational authority to the main مؤطِّرة**
(R87 §G): the position is reported honestly because it is responsibility and
audit, and the permissions are the same object. See
[teaching-authority.md](teaching-authority.md).

### The guardian enters AS THE CHILD

The credential carries the child's identity and the child's display name. The
guardian's own `User` never enters in her place, and **she acquires no
beneficiary role by it** — the authority is the approved `FamilyLink`, re-read
on that very request. A revoked link and a forged unrelated child are both
`404`, with no distinction between them (§4.3 — distinguishing them would leak
the existence of another family's daughter).

---

## The room is derived, and that is what keeps R97.9 true

```
sha256("bodour.online-class.v1:" + session.id)  →  bodour-<32 hex>
```

Deterministic, opaque, collision-safe, and **stored nowhere**. R97.9 forbids a
provider identifier on `RecurringCourseSchedule`, `Session` or the calendar
occurrence projection; a derived name means there is no column to forbid.

**No `OnlineRoom` table exists, and adding one was considered and refused.** A
room is opened by the provider on the first authorised join and closed when the
last participant leaves, so there is no lifecycle state that is not derivable —
nothing to create ahead of time, nothing to reconcile, nothing to clean up. That
is also the whole of idempotence: repeating the request writes no row, and a
page refresh costs nothing.

**Knowing the name grants nothing** and it must never be treated as a secret. A
room is entered with a credential minted for one named person after the checks
above; a guessed name reaches a room the guesser holds no credential for.
Opacity keeps the association's timetable out of a third party's operational
logs — it is hygiene, never authorization.

---

## The join window

| | |
|---|---|
| opens | **15 minutes** before the scheduled start |
| closes | **30 minutes** after the scheduled end |
| clock | **the server's**, on the association's own timezone (TD-13 `TZ`) |
| credential lifetime | bounded by the window; never timeless, never past a 6-hour ceiling, never under a minute |

The tail is a **reconnection allowance**, not an invitation to arrive late: a
three-hour class that overruns, or a مؤطِّرة whose connection drops in the last
minute, must not find the platform refusing to let her back in.

**The window is evaluated *after* authorization**, deliberately. *«الحصة لم تبدأ
بعد»* tells the reader when a class begins, and telling that to somebody not
entitled to attend would confirm the occurrence exists and when it runs. An
unauthorised caller gets `404` and learns nothing about the timetable
(§20 rule 17).

---

## What the credential carries

The smallest set that lets each kind of person do their job.

| | publish | subscribe | moderation | sources |
|---|---|---|---|---|
| beneficiary | yes | yes | **no** | mic + camera (`audio_video`) |
| مؤطِّرة / assistant | yes | yes | **yes** | mic + camera |
| administrator | yes | yes | **no** | mic + camera |
| any of them, `audio_only` | yes | yes | as above | **microphone only** |

**«صوت فقط» is a property of the credential**, not of a stylesheet: the
permitted sources are named in the token, so a modified client cannot publish a
camera into an audio-only class. The client separately never *requests* one —
see below — so the promise holds at the device, at the client and at the server.

Never issued, at any level: room creation, room listing, ingress, and
**recording**. Recording is a later revision carrying BR-2's consent gate, and a
control that could start an unconsented recording must not exist before the gate
that governs it.

---

## One classroom, for every portal

`/classroom/{sessionId}` — a beneficiary, a guardian acting for her daughter, a
مؤطِّرة, her assistant and an administrator all arrive at the same page. It adapts
to two facts that arrive **on the credential**: `media_mode` and `role`.

There is no Student classroom, no Teacher classroom and no Admin classroom
(rule C). Three copies of a live media surface is three places for a media bug
to be fixed in two of.

**The class runs inside بذور الأمل** — never a redirect to a third party's page —
in Arabic, RTL, with **no vendor named on any surface a beneficiary, parent or
مؤطِّرة can read** (rule M). She enters «حصة».

### صوت فقط is a listening surface

Not a video layout with the pictures removed:

* the **camera is never requested** (`video={false}`), so no permission prompt
  and no device indicator appears for a class that has no video;
* there is **no empty video grid** — an empty grid states *«nobody has their
  camera on»* about a class that has no cameras at all;
* who is present and **who is speaking now** is what a listener actually needs,
  and speaking is marked by a **word** as well as a highlight (rule AV);
* the camera control is **absent, not disabled**.

### Failures are sentences

Every refusal and every device problem is stated in the reader's own words with
the next step attached — never a browser exception, never an SDK string, never a
bare code. **A camera failure does not end an `audio_video` class**: the class
continues by voice, because a beneficiary without a working camera must not be
put out of a lesson.

---

## The public calendar is unchanged

It may say **«عن بُعد»** — that is a fact about the class, and hiding it would
hide something harmless. It may never expose an actionable way into a teaching
room, a room identity, or a credential. «دخول الحصة» appears only for an
authenticated reader, on a `session`, delivered `online`.

**Whether *this particular* reader may enter is not decided in the client**
(rule O). The button is a link; the classroom asks the server and says the answer
in her own words. Probing at dialog-open time was rejected on two grounds: it
would cost an authorization request for every occurrence anybody merely *looked*
at, and it would be **stale by the time she clicked**, since the window opens
fifteen minutes before the class.

---

## The provider seam

One file in the backend knows a media platform exists —
`backend/src/lib/online-class-provider.ts` — and
`scripts/ci/check-provider-seam.sh` fails the build if a second one appears, if
a vendor's name reaches user-facing text, or if a recording capability arrives
early. The seam exists **not** to make swapping providers cheap (it would not
be), but so the reach of the decision stays visible and auditable.

It has exactly one method, `issueJoinCredentials`. Everything else a provider
might have been asked turned out not to be the provider's to answer: creating
the room (there is nothing to create), who is in the room (a participant list is
not attendance, §4.7, and must never become an authorization input), and
recording (a later revision).

---

## Configuration

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (TD-13) — **all three or
none**.

* **None** is a complete, valid deployment: the association runs no online
  classes, the platform offers no «دخول الحصة», and the join route answers
  `503 SERVICE_UNAVAILABLE` naming the settings.
* **Some** is refused at boot. A URL with no secret boots, reads as configured
  to anyone inspecting `.env`, and fails at the one moment that matters.

The secret never leaves the API process.

### The CSP must name the media origin — in BOTH schemes

§3.1's CSP is `default-src 'self'`. A class عن بُعد connects the **browser**
directly to the media server, so without an entry the classroom cannot open at
all. `nginx/snippets/media-origin.conf` holds it in one place; development
mounts `media-origin.dev.conf` over it, exactly as the rate limits do.

**Both `wss:` *and* `https:` (or `ws:`/`http:` locally).** The client validates
the connection over ordinary HTTP *before* upgrading to a socket, and CSP treats
the two as different sources — so listing only the socket origin produces
*«could not establish signal connection: Failed to fetch»* **with no CSP
violation event at all**, because the blocked request is the HTTP one. That is
how it failed here, and only a real browser could have found it.

---

## Local development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d livekit
# .env
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecretdevsecretdevsecretdevsecret
```

`livekit-server --dev` runs the whole signalling stack in one container with a
fixed key pair, so **no automated test ever touches a paid account**. It carries
no Egress and no Redis — see
[online-class-provider.md](online-class-provider.md), which recorded that before
this container existed.

---

## What is guarded

| property | guard |
|---|---|
| Authorization, all four refusals, R91 · R92 · guardian · window · grants | `backend/src/services/online-class.integration.test.ts` |
| The wire shape, no secret on it, `X-Active-Child-ID` honoured, forged bodies | `backend/src/controllers/online-class.http.integration.test.ts` |
| Join button placement, one classroom, one route, Arabic for every failure | `frontend/src/components/classroom/classroom.test.tsx` |
| One backend file knows the vendor · no vendor in user text · no recording | `scripts/ci/check-provider-seam.sh` |
| **A real three-party room against a real server**, and every refusal on the page a human opens | `scripts/dev/browser/verify-livekit-join.sh` |

The last one is the only place several people are actually in a room at once,
and it is what caught the CSP.
