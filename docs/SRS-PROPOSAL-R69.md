[Documentation](README.md) › **SRS proposal — Revision 69**

# Draft SRS Revision 69 — the two hierarchies get their own navigation

**Status: authorised by the Document Owner (2026-08-12)**, who specified the
navigation and asked that it be audited against the model before implementing:
*"First level of structure → then optional subdivision only when actually
needed … The UI should make these two independent hierarchies obvious."*

---

## 69.1 — The audit's finding: the MODEL is already right, and so is the AUTHORIZATION

Nothing in the intended model needs a schema change or a rule change. Stated
plainly, because it decides the size of this revision:

| Intended | Already specified by |
|---|---|
| A Level belongs to a Category, not a Branch | §7 — `Level.categoryId`; no branch column |
| A Level may exist with **no** Administrative Group | **R66** |
| Students may be enrolled **directly** in a Level | **R66** (`enrolInLevel`) |
| A Group belongs to a Level **and** a Branch | §7, unchanged |
| A Subject is independent | §7 — `Subject` reaches Levels through `LevelSubject` |
| A Subject needs **no** Teaching Group | §7 — *"Creating Teaching Groups is not a prerequisite for teaching a Subject"* |
| Unsplit Subject → whole Level | §4.4c — `TeachingMode.entire_level` |
| Circles scoped to `(Subject, Level)` | §7, R43 |

**The authorization the Owner asked for is already in the services**, and reads
are already open to operational Admins:

| | Write | Read |
|---|---|---|
| Category, Subject | Super Admin | Admin+ |
| Level | Super Admin (`assertCanManageReferenceData`) | Admin+ (`assertCanReadReferenceData`) |
| Level↔Subject pairing | Super Admin (`assertCanWriteCurriculum`) | Admin+ |
| Teaching Group — create/rename/delete | **Super Admin** (`assertCanManageGroups`, R43.3) | — |
| Teaching Group — **membership** | **Admin+**, branch-scoped (`assertCanManageMembership`, R43.3) | — |
| Administrative Group + roster | Admin+, branch-scoped | Admin+ |

**No service, policy or matrix row changes.** That split is exactly what makes
`حلقات المواد` an operational screen whose *structural* controls are
Super-Admin-only — the convention §5.6 already uses elsewhere.

## 69.2 — What is actually wrong: two screens have no way in

`مواد المستوى` and `حلقات المواد` exist and work, but their paths carry ids —
`/admin/levels/{id}/subjects` and `/admin/levels/{id}/subjects/{subjectId}` — so
**no menu can link to them**. §14.1 lists Subject Organisation under *Academic*
while no navigation node can reach it, and the consequence is what the Owner
observed: the only ways in were **row actions borrowed by unrelated screens**.
`المستويات` grew a Subject action; `مجموعات المستويات` grew one too. Both are
duplicated entry points to a screen that should have had its own.

**That is a navigation defect, not a modelling one**, and it is fixed by giving
each screen a node — which requires §14.1 to change, hence this revision.

## 69.3 — One node each, with the id as a QUERY parameter

The precedent is §14.1's own, from Revision 43: `/resources` carries *"the level
list, and one level's contents behind `?level=` — because a second path segment
would be a navigation node §14.1 does not list."*

So:

```
/admin/level-subjects            → مواد المستوى   (+ ?level=)
/admin/teaching-groups           → حلقات المواد   (+ ?level=&subject=)
```

Each screen selects what it needs **in the page**, and the query parameter is a
deep link rather than a second node. The existing paths
`/admin/levels/{id}/subjects[/{subjectId}]` **redirect** to the canonical ones,
so bookmarks and any link already in the wild keep working.

**Why not keep the path segments and add menu entries?** Because a menu entry
cannot supply an id, which is the whole reason these screens had no node. Adding
one would mean inventing a "pick a Level first" landing page — a third screen for
a question the destination can ask itself.

## 69.4 — §14.1 is restructured along the two hierarchies

**Administration (Super Admin) — stable configuration, in dependency order:**

```
الفئات → المستويات → المواد → مواد المستوى
```

`المستويات` **moves here from Academic**: a Level is curriculum structure, its
writes have always been Super Admin, and R66 removed the last operational thing
it did (creating a first group). Its read endpoint stays **Admin-accessible** —
scheduling, the approval queue's placement dialog and the groups screen all feed
selectors from it, and gating the data rather than the screen would break an
Admin's daily work. That is the rule Revision 61 already set for
`GET /admin/branches`, applied again.

**الشؤون التعليمية (operational Admin) — subdivision, only when needed:**

```
مجموعات المستويات · حلقات المواد
```

Both are where an administrator acts on **students**: creating a subdivision
because one is actually needed, and placing people into it.

## 69.5 — Each screen owns one responsibility

| Screen | Answers | Does NOT |
|---|---|---|
| `المستويات` | which Levels exist, in which Category | assign Subjects; manage groups |
| `مواد المستوى` | which Subjects a Level teaches | subdivide anything |
| `مجموعات المستويات` | how a Level is subdivided, and who is in each group | touch Subjects |
| `حلقات المواد` | how a Subject **within a Level** is subdivided, and who attends | touch Levels or the Level↔Subject pairing |

**The duplicated Subject actions are removed** from `المستويات` and
`مجموعات المستويات`. Neither screen is about Subjects, and each had grown an
entry point to a screen that lacked its own.

## 69.6 — What this revision does NOT do

* **No schema change.** Not one column.
* **No automatic creation.** A Level still gets no Group and a Subject still gets
  no Circle merely by existing — R66 and §7 respectively, both untouched.
* **No new concept, and no renaming.** Administrative Group and Teaching Group
  keep their names and their distinct meanings (§20 rule 22).
* **No Subject-side model change.** §7 already specifies it correctly; touching
  it for symmetry with the Level side is exactly what the Owner ruled out.
* **No authorization change**, in either direction.

## 69.7 — Audit against the live architecture

| Claim | Status |
|---|---|
| Both screens exist and work today | **[CODE]** `level-subjects.tsx`, `subject-organisation.tsx` |
| Neither has a navigation node | **[CODE]** `admin-modules.ts`; **[SRS]** §14.1 lists the path but no reachable node |
| They are reached only by borrowed row actions | **[CODE]** `levels.tsx`, `groups.tsx` |
| Level writes are already Super Admin, reads Admin+ | **[CODE]** `level.service.ts` |
| Level↔Subject writes are already Super Admin | **[CODE]** `reference-data.service.ts` |
| Circle structure is Super Admin, membership Admin+ | **[CODE]** `teaching-group.service.ts`; **[SRS]** R43.3 |
| `?level=` as a deep link is an existing §14.1 pattern | **[SRS]** §14.1, R43 (`/resources`) |
