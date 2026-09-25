# Class delivery — حضوري and عن بُعد

SRS Revision 97: how a teaching occurrence reaches its students, provider-independent (R97.9). Provider: [online-class-provider.md](online-class-provider.md). Joining (R98), recording and import (R99): [online-classroom.md](online-classroom.md). Delivery decides whether a class has a room to enter, never who may enter it.

## The model

| | `RecurringCourseSchedule` | `Session` |
|---|---|---|
| `delivery_mode` | default for the occurrences it materializes | what this occurrence is |
| `online_media_mode` | `audio_video` \| `audio_only`, non-null iff online | same |
| `room_id` | the venue; `NULL` whenever online | same |
| `branch_id` | administrative scope, unaffected by delivery | inherited through the schedule |

| value | word (`ar.delivery.*`, never hand-written per screen) |
|---|---|
| `in_person` | حضوري |
| `online` | عن بُعد |
| `audio_video` | صوت وصورة |
| `audio_only` | صوت فقط |

## One inheritance mechanism

- R43.4's snapshot: schedule default → `session.materialize` snapshots it → `Session.overridden` protects it; `room_id` and staffing already work so; delivery adds nothing.
- No `delivery_overridden` column: `Session.overridden` already answers «did a human decide about this occurrence».
- Free consequences: an occurrence moved عن بُعد is `overridden` (`protectionReasons` reports `OVERRIDDEN`, the next schedule edit skips it); the R50 split carries delivery onto the successor; a past or `held` occurrence is protected by `LIFECYCLE` and keeps its delivery.

## An online occurrence has NO room — enforced

```sql
CHECK ((delivery_mode = 'online') = (online_media_mode IS NOT NULL))
CHECK (delivery_mode = 'in_person' OR room_id IS NULL)
```

- The first is an equivalence: refuses an online row without media mode and an in-person row with one.
- The room is cleared, not ignored (a stale `room_id` skipped only by conflict detection would leave every renderer free to show a venue); room-collision detection needs no special case.
- Staff-time conflicts stay real: a مؤطِّرة cannot deliver an online and an in-person class in the same hour; R91 per-person arms unchanged.

## Three independent dimensions

| question | answered by | revision |
|---|---|---|
| who teaches this occurrence? | `SessionStaff` / `CourseScheduleStaff` | [R91](teaching-authority.md) |
| who is expected at it? | canonical audience resolver, `SessionAudienceBranch` | R92 |
| how and where does it happen? | `delivery_mode`, `online_media_mode`, `room_id` | R97 |

- After moving an occurrence online, `SessionStaff` is byte-identical and `audienceForSession` returns the same specification (integration suite).
- `branch_id` is scope, not venue: an online class stays a Targa class, under the Targa filter, managed by the branch Admin; never remove an online class from Branch filters.

## Where the invariant lives

1. `policies/delivery.ts` — `resolveDelivery`: the single resolution of the three columns for schedule create, schedule update, the R50 split and `session.override`; `undefined` = unchanged, `null` = cleared; makes a partial edit reach a CHECK-valid state.
2. Zod boundary — `checkDelivery`, shared by schedule and session schemas, for a field-level message.
3. The CHECK constraints — the backstop (caught a fixture writing an online session with a room).

## The client

- `components/scheduling/delivery.tsx` holds everything (rule C): `DeliverySection` (form controls, composed by the class form and the single-occurrence editor; the room selector lives inside it) and `deliveryLabel` / `mediaLabel` / `venueLabel` (details dialog, occurrence table, list view, month chip).
- Hidden means cleared: عن بُعد submits `room_id: null`, حضوري submits `online_media_mode: null`; irrelevant controls hidden, not disabled.
- The occurrence editor opens on the OCCURRENCE, never its schedule (a re-save from the schedule would undo the override).
- Event and Exam send `null`; `deliveryLabel` returns `null` rather than inventing حضوري.
- The calendar marks the exception only: online as a word, never colour alone; in-person silent.
- Delivery adds no «دخول الحصة» of its own; joining is R98.
- Teacher parity: a مؤطِّرة uses the same `SchedulingDialog` with `types={['activity']}` (R71.0 keeps class creation with Admins; §4.4c derives her scope from the schedules she staffs); delivery widens no scheduling authority.

## Guards

| guard | property |
|---|---|
| `services/delivery.integration.test.ts` (32) | defaults, refusals, CHECKs, snapshot, override, resync, history, collisions, R91/R92 independence, negative authorization |
| `components/scheduling/delivery.test.ts` (21) | one catalogue, one section, hidden-means-cleared, no dead Join button, no vendor named; a hand-written «عن بُعد» and a second delivery control each fail it |
| `pages/admin/scheduling-contract.test.tsx` | schedule wire key set for R97 |
| `pages/admin/schedule-sessions.test.tsx` | occurrence wire key set for R97 |

## Deliberately not built here

- Provider integration, rooms, tokens, joining, recording, egress and the import of recordings as `EducationalContent` are outside the delivery domain; R97.9: no media-platform identifier on `RecurringCourseSchedule`, `Session` or the calendar occurrence projection.
