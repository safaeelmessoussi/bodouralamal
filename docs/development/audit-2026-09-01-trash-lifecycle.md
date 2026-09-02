[Documentation](../README.md) › [Development](README.md) › **Trash lifecycle audit**

# Trash lifecycle audit — 2026-09-01

This audit was triggered by the first controlled-UAT cleanup. It distinguishes a missing
engineering transition from a retained institutional record. The canonical rules remain SRS
TD-5/R59 and BR-15; this page records the implementation/FK consequences and the questions the
SRS does not decide. It does not authorize automatic age-based destruction.

## Classification

| Entity/state | Class | Result |
|---|---:|---|
| `LevelSubject` removed with Subject/Level | B | The parent snapshot records the exact link ids. Restore/purge touches only those ids. A link deleted in an earlier independent act remains separate and blocks a parent purge through its FK. |
| `LevelSurah` removed deliberately | A | It now receives its own Trash entry and may be permanently purged. Reassignment revives the unique row and removes its tombstone atomically. |
| `LevelSurah` removed with Level | B | The Level snapshot records its exact ids; no broad `level_id` purge is permitted. |
| Empty `AdministrativeGroup` removed with Level | B | The Level snapshot records exact group ids. Its Event audience joins follow the same deletion transaction; any remaining enrolment/schedule/grade/history FK refuses purge. |
| `QuranProgressLog` deliberately corrected/deleted | A | The exact tombstoned correction row may be purged. Account deletion still retains progress history; the delete and permanent-delete audit facts remain. |
| Unused deleted `SchedulingType` | A | It is a leaf purge. A historical Event reference remains `RESTRICT` and refuses it. |
| Deleted `Partner` | A | It is an unreferenced leaf: delete now records `deleted_by` and Trash, and restore/permanent purge are complete row transitions. |
| `EducationalContent` explicit permanent deletion | A | Existing R59/P0.3 logic transactionally creates exact durable storage-retirement work before deleting the DB/Trash locator. |
| Schedule with retained historical/held Session | D under the current contract | `CASCADE_CHILDREN` is intentional. The Session is historical truth and carries its materialized room/delivery snapshot; no cleanup script may erase it. |
| Schedule with no Session ever materialized | D today; Owner decision below | The current contract is type-wide, not conditional. Engineering cannot silently promote only the empty subset to A. |
| Branch/Room/Level/Subject/Category/AdministrativeGroup referenced by retained history | D under the current FK model | `RESTRICT` is the safeguard. Ordered purge handles disposable dependants; retained schedule/Session/history is not a disposable dependant. |
| Live terminal `FamilyLink(rejected)` | C | It grants no child authority and is not Trash. It records a terminal authorization decision; no removal transition or retention horizon is specified. |
| Retained Session, consent and audit evidence | C | These records remain outside disposable cleanup. Historical Session venue coordinates are intentional materialization snapshots, not orphaned profile data. |

Classes are: **A** supported permanent purge; **B** exact ordered/cascade purge of disposable
owned data; **C** retained historical/legal record that is not an indefinitely purgeable Trash
item; **D** intentionally non-purgeable Trash/reference state with a clear refusal.

## Root causes closed in engineering

The missing plans were not FK defects. Parent deletion had tombstoned owned joins/groups but its
snapshot did not say which rows belonged to that act; a broad purge would therefore have been
unsafe. Exact id arrays make ownership durable. Legacy snapshots do not gain invented ownership:
restore reports `INCOMPLETE_SNAPSHOT`, while purge deletes no guessed child and lets PostgreSQL
refuse the parent if anything remains.

`QuranProgressLog` and `SchedulingType` already had deliberate delete + Trash paths but were absent
from the explicit purge catalogue. `LevelSurah` and `Partner` had the inverse omission: they
soft-deleted without writing Trash. Finally, both unique curriculum assignment paths could revive a
row while leaving its old Trash entry visible. These omissions are now covered in their canonical
services.

The Trash UI had also treated its filter list as closed while omitting backend-produced types. The
one exported inventory now has Arabic labels for every producer; capability still comes
from each server row and is never inferred by the browser.

## Owner decisions required

1. **Schedule history:** may a deleted schedule be permanently purged only when it has never
   materialized any Session? Separately, may a parent purge consume only derived future Session
   tombstones, or must every materialized coordinate remain institutional history?
2. **Retained tombstone presentation:** should schedule/reference tombstones protected by retained
   history stay visibly non-purgeable in Trash, or move to a distinct archive/history view? This is
   a product/retention decision, not a database cleanup technique.
3. **Rejected FamilyLink retention:** define whether a terminal rejection is retained indefinitely,
   retained for a fixed period, or receives an explicit audited removal transition. Until decided,
   it stays live, non-authorizing, and outside Trash.

## What “Trash can reach zero” means

Ordinary disposable UAT data can reach zero after dependants are removed in domain order and each
parent owns exact consequence coordinates. Zero is **not** currently guaranteed for a database
that contains deleted schedules/history-protected reference rows: those are intentionally refused
under the current contract. Reaching a cosmetic zero by clearing foreign keys, deleting retained
Sessions, or removing Trash directly would violate the lifecycle rather than complete it.
