# SRS Revision 61 — proposal

**Title:** The الإدارة section is Super Admin only — as a section, not as four
separate decisions

**Status:** Document Owner instruction, 2026-08-11
**Amends:** §14.1 (the `/admin/branches` sitemap line)
**Does not amend:** Revision 26's read retention — see 61.2

---

## 61.1 — The rule

**Every node under §14.1's `الإدارة` section is Super Admin only.** The section
is the unit; a module placed there is Super-Admin-only *because it is there*,
rather than by a per-module decision that has to be remembered.

Three of the four already were. The fourth, **`/admin/branches` (الفروع
والقاعات)**, was `read: Admin · write: Super Admin` under Revision 26, and the
Document Owner has directed that it join them.

| Node | Before | After |
|---|---|---|
| الفروع والقاعات `/admin/branches` | Admin read, Super Admin write | **Super Admin** |
| المهملات `/admin/trash` | Super Admin | unchanged |
| التقويم الهجري `/superadmin/hijri-calendar` | Super Admin | unchanged |
| إعدادات المنصة `/superadmin/settings` | Super Admin | unchanged |

Stating it as a **section rule** is the point. Written as four module entries,
the fifth module added there inherits nothing, and the divergence returns
silently — which is exactly how `/admin/branches` came to be the odd one out.

---

## 61.2 — What this does NOT change, and why the distinction is load-bearing

**`GET /admin/branches` remains readable by an Admin.** Revision 26 retained it
deliberately, and gave the reason:

> *Read access to reference data is explicitly retained for Admins
> (branch-scoped) … operational work depends on it, since a `Group` references a
> Branch, a Level and a Room, so withdrawing read access would make Group
> management impossible.*

That is not a historical concern. It was **verified against the current code
before this revision was drafted**: `hooks/use-scope-options.ts` calls
`listBranches` (`GET /admin/branches`), and it feeds

* `/admin/groups` — Administrative Groups, an Admin's core operational work;
* `/admin/schedules` — الجدولة, every scope selector on it;
* `/admin/content`;
* `components/scope/scope-selectors.tsx`, used across the back office.

Withdrawing the endpoint would leave a branch Admin unable to create a group,
schedule a class, or scope content — with no error explaining why, because the
selectors would simply come back empty.

**So the two are separated deliberately:**

| | Who |
|---|---|
| The `الفروع والقاعات` **screen and navigation node** | Super Admin only (61.1) |
| `GET /admin/branches` as a **selector feed** | Admin, branch-scoped (R26, unchanged) |
| Any **write** to a branch or room | Super Admin only (R26, unchanged) |

An Admin therefore cannot *manage* branches and cannot reach the screen — which
is what the instruction asks — while the data an Admin's own work depends on
keeps flowing. Nothing an Admin could do before this revision becomes possible
after it; one screen becomes unreachable.

**This is a visibility and management boundary, not a data boundary.** If the
Document Owner wants the *data* withheld from Admins as well, that is a
different and larger decision: it requires replacing every branch selector in the
back office with a feed an Admin may read, and it should be taken knowing that
cost rather than as a consequence of this one.

---

## 61.3 — Enforcement

**The section rule is enforced by a test, not by convention.** A guard asserts
that every module registered under `section: 'administration'` carries
Super-Admin-only roles, so a future module added there cannot quietly ship with
`STAFF` the way `/admin/branches` did.

Server-side authority is unchanged and remains the boundary: writes were already
Super Admin only, and R60's active-role narrowing means a Super Admin *working
as* Admin does not see the section either.

---

## Text changes

**§14.1 sitemap** — the `الإدارة` block:

> `Branches & Rooms .............. /admin/branches` ~~(read: Admin · write:
> Super Admin, R26)~~ → **(Super Admin only — R61; the endpoint stays readable by
> an Admin as a selector feed, R26)**

A one-line note is added under the section heading recording that the whole
section is Super-Admin-only by rule.
