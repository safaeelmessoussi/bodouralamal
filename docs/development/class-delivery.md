# Class delivery — حضوري and عن بُعد

**SRS Revision 97.** How a teaching occurrence *reaches its students*, and
nothing about which media platform carries it.

> **Scope note.** This page describes the **delivery domain**, which is
> provider-independent and normatively so (R97.9). The MVP media provider is a
> separate decision, recorded in
> [online-class-provider.md](online-class-provider.md).
>
> **Entering a class عن بُعد is R98** and lives in
> [online-classroom.md](online-classroom.md) — who may join, the derived room,
> the join window and the credential. Delivery decides *whether a class has a
> room to enter*; it decides nothing about *who may enter it*.
>
> **Recording and the import of recordings are still later revisions** and are
> not built.

---

## The model in one table

| | `RecurringCourseSchedule` | `Session` |
|---|---|---|
| `delivery_mode` | the **default** for the occurrences it materializes | what **this occurrence** is |
| `online_media_mode` | `audio_video` \| `audio_only`, non-null **iff** online | same |
| `room_id` | the venue, and **`NULL` whenever online** | same |
| `branch_id` | the **administrative scope** — unaffected by delivery | (inherited through the schedule) |

Arabic, from one catalogue (`ar.delivery.*`) and never hand-written per screen:

| value | word |
|---|---|
| `in_person` | حضوري |
| `online` | عن بُعد |
| `audio_video` | صوت وصورة |
| `audio_only` | صوت فقط |

---

## There is ONE inheritance mechanism, and delivery rides it

The platform already had an answer to *«the schedule says X, but this Thursday
is different»* — R43.4's snapshot, protected by `Session.overridden`:

```
schedule default  →  session.materialize SNAPSHOTS it  →  overridden protects it
```

`room_id` and the staffing snapshot have worked this way since R43.4. Delivery
does exactly the same and adds nothing.

**There is deliberately no `delivery_overridden` column.** `Session.overridden`
already answers *«did a human decide about this occurrence?»*, and a second
marker would give one question two answers that drift — which on this project is
not a hypothetical (see *One source of truth per concept* in `CLAUDE.md`).

Consequences, all of them free rather than implemented:

* an occurrence moved عن بُعد is `overridden`, so `protectionReasons` reports
  `OVERRIDDEN` and the next schedule edit skips it;
* the R50 **split** carries delivery onto the successor, because the successor
  *is the same class*;
* a **past** or `held` occurrence is protected by `LIFECYCLE` and keeps what it
  was delivered as. October stays what October was.

---

## An online occurrence has NO room — enforced, not filtered

Two CHECK constraints per table:

```sql
CHECK ((delivery_mode = 'online') = (online_media_mode IS NOT NULL))
CHECK (delivery_mode = 'in_person' OR room_id IS NULL)
```

The first is an **equivalence, not an implication**: it refuses an online row
with no media mode *and* an in-person row carrying one. The second half is the
one an application check forgets, and a stray `audio_only` on an in-person class
is a caller believing something false about the row it just wrote.

**Why the room is cleared rather than ignored.** The alternative was to leave a
stale `room_id` on an online row and teach conflict detection to skip it. That
puts the rule in one query and leaves the calendar, the details dialog, the
session list — and whatever is written next — free to render a venue for a class
that has none. Making the state unrepresentable means:

> **Room-collision detection needs no special case at all.** An online
> occurrence has nothing to collide over.

**Staff-time conflicts are untouched and stay real.** A مؤطِّرة cannot deliver an
online class and an in-person one in the same hour, and the R91 per-person
effective-period arms are unchanged.

---

## Three independent dimensions

| question | answered by | revision |
|---|---|---|
| **who teaches this occurrence?** | `SessionStaff` / `CourseScheduleStaff` | [R91](teaching-authority.md) |
| **who is expected at it?** | the canonical audience resolver, `SessionAudienceBranch` | R92 |
| **how and where does it happen?** | `delivery_mode`, `online_media_mode`, `room_id` | **R97** |

Changing one changes none of the others, and the integration suite proves the
two that matter: after moving an occurrence online, `SessionStaff` is
byte-identical and `audienceForSession` returns the same specification.

### Branch survives going online

`branch_id` is the class's **administrative and educational scope**, not its
venue — R92 had already separated venue from audience. A class delivered عن بُعد
is still a Targa class: it appears under the Targa filter, resolves its audience
the same way, and is managed by the same branch Admin. **Do not remove an online
class from Branch filters.**

---

## Where the invariant lives

Three layers, each doing a different job — none of them redundant:

1. **`policies/delivery.ts` — `resolveDelivery`.** The single resolution of the
   three columns, asked by schedule create, schedule update, the R50 split and
   `session.override`. `undefined` means *unchanged*, `null` means *cleared*.
   It is what makes a **partial** edit arrive at a state the CHECKs accept.
2. **The Zod boundary — `checkDelivery`.** One function, shared by the schedule
   and session schemas, so an occurrence can never reach a combination a
   schedule could not. It exists to produce a **field-level message** instead of
   a constraint name.
3. **The CHECK constraints.** The backstop, which caught a fixture in this
   feature's own test suite writing an online session with a room.

---

## The client

**One concept, one implementation** (rule C). `components/scheduling/delivery.tsx`
holds everything:

* `DeliverySection` — the form controls, composed by the class form **and** the
  single-occurrence editor. The **room selector lives inside it**, because a room
  is meaningful only for an in-person class.
* `deliveryLabel` / `mediaLabel` / `venueLabel` — the read side, used by the
  details dialog, the occurrence table, the list view and the month chip.

Rules this surface must keep:

* **Hidden means cleared.** Switching to عن بُعد submits `room_id: null`;
  switching to حضوري submits `online_media_mode: null`. Irrelevant controls are
  **hidden, not disabled** — a greyed-out room selector looks like a control that
  could matter.
* **The occurrence editor opens on the OCCURRENCE**, never on its schedule.
  After an override the two differ, and seeding from the schedule would let an
  unrelated re-save silently undo the override.
* **`null` for a kind with no delivery model.** An Event and an Exam send
  `null`; `deliveryLabel` returns `null` rather than inventing حضوري.
* **The calendar marks the exception only.** A month cell is the most crowded
  surface in the platform, so online is marked and in-person is silent — as a
  **word**, never colour alone.
* **There is no «دخول الحصة».** Joining needs infrastructure that does not exist;
  a control that cannot work is worse than none.

### Teacher parity

A مؤطِّرة reaches scheduling through the **same** `SchedulingDialog`, with
`types={['activity']}` — R71.0 keeps class creation with Admins because §4.4c
derives her scope *from the schedules she staffs*. Delivery therefore widens no
scheduling authority: she gets the shared section wherever she already had the
form, and nowhere else.

---

## Guards

| guard | property |
|---|---|
| `services/delivery.integration.test.ts` (32) | the whole domain: defaults, refusals, CHECKs, snapshot, override, resync, history, collisions, R91/R92 independence, negative authorization |
| `components/scheduling/delivery.test.ts` (21) | one catalogue, one section, hidden-means-cleared, no dead Join button, no vendor named |
| `pages/admin/scheduling-contract.test.tsx` | the schedule wire key set, restated for R97 |
| `pages/admin/schedule-sessions.test.tsx` | the occurrence wire key set, restated for R97 |

Both new client guards were **proved against the defect they exist for**: a
hand-written «عن بُعد» and a second delivery control each fail them.

---

## Deliberately not built here

Provider integration, rooms, tokens, joining, recording, egress, and the import
of recordings as `EducationalContent`. R97.9 makes the absence normative: **no
media-platform identifier belongs on `RecurringCourseSchedule`, `Session` or the
calendar occurrence projection.** The domain must survive replacing the vendor.
