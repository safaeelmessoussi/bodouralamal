[Documentation](README.md) › **SRS Proposal — Revision 77**

# SRS Proposal — Revision 77

**One notification event returns to the MVP: a class session was cancelled.**

**Status:** **APPLIED** to `docs/SRS.md` on 2026-08-18, on the Document Owner's
explicit instruction (*"Treat class session cancellation notifications as an
actual MVP notification event … notifying only students actually enrolled … If
SRS changes are required, draft/apply revisions per repository rules"*). This
document is retained as the decision record.

Raised because the Owner instructed (2026-08-18) that *"class session cancellation
notifications"* be treated as **an actual MVP notification event** — and §4.8 as
it stands forbids exactly that, in terms strong enough that implementing it
quietly would be a violation rather than an omission.

---

## 1 · What the SRS says today

**§4.8 (Revision 6) removed in-app notifications from the MVP entirely** — the
bell, the dropdown, the list page, the critical tier, the per-child preferences,
and **the `Notification` / `NotificationPreference` entities**. Its last clause is
the binding one:

> *nothing in the MVP schema may pre-create its tables.*

It also states the intended MVP substitute:

> *operational communication (session cancellations, approvals, published grades)
> happens through the existing channels the association already uses.*

**§10.1** holds the full framework for the next phase: a five-event catalogue,
critical/normal tiers, per-child composite preferences.

**Cancellation itself is already complete.** `PATCH /sessions/{id}/cancel`
performs TD-1's `scheduled → cancelled`, **requires a reason** — enforced in the
service *and* by `session_cancellation_reason_check` — and writes a
`session.cancel` audit row carrying the reason, the date and **the audience size
resolved at the moment of the action**. `restoreSession` reverses it, refuses a
past date, and deliberately keeps the former reason as history.

## 2 · What is missing, and what is NOT

**Missing:** a way for the affected beneficiary to be told. Nothing else. The
cancellation, its reason, its audit trail, its authority and its audience
resolution all exist and are tested.

**Not missing, and deliberately not proposed:**

* the bell, the dropdown and the notification list **page** as §10.1 designs them;
* the five-event catalogue;
* critical/normal tiers;
* `NotificationPreference` and per-child composite preferences;
* any delivery channel that is not in-app.

Those stay in §10.1. **This revision reverses one clause of Revision 6, not
Revision 6.**

## 3 · The proposed revision

> **Revision 77 (Document Owner decision — session cancellation becomes an MVP
> notification event, 2026-08-18):** **(1) §4.8's postponement is narrowed.** The
> in-app notification *framework* stays postponed to §10.1 — the five-event
> catalogue, the tiers, `NotificationPreference` and per-child preferences remain
> **out of the MVP** and no schema may pre-create their tables. What returns is
> **one event and the minimum entity that can carry it**. §4.8's clause *"nothing
> in the MVP schema may pre-create its tables"* is amended to *"nothing in the
> MVP schema may pre-create the tables of the postponed framework"*, which
> `Notification` as defined here is not: it carries no tier, no preference and no
> channel. **(2) New entity `Notification`** (§7): `id`, `user_id`, `type`,
> `session_id`, `created_at`, `read_at` (nullable), plus the standard
> soft-delete/audit columns the §7 convention gives every entity. **`type` is an
> enum of exactly two values — `session_cancelled` and `session_restored`** — and
> a third value is an SRS revision, not a code change. There is no
> `NotificationPreference` and no `Notification.tier`. **(3) The audience is the
> Session's resolved audience**, computed by the *same* predicate that already
> produces the `session.cancel` audit row's `audience_size` (§4.4c). It is one
> implementation, not two that agree today: a notification list that disagreed
> with the audit's count would make both unusable. **Only enrolled students are
> notified** — not staff, who take the decision, and not parents, whose access is
> §4.3's child context and is not a mailbox of their own in the MVP.
> **(4) Notifications are written in the SAME TRANSACTION as the state change.**
> A committed cancellation with no notifications is a class nobody was told
> about, and a retry cannot distinguish it from one already notified.
> **(5) Restore reconciles, and it is a second event rather than a deletion.**
> Restoring deletes any **unread** `session_cancelled` rows for that session — an
> unread notice of something that is no longer true is worth nothing — and, for
> every student who had **already read** one, writes a `session_restored`
> notification. Silently deleting a read notification would leave a person
> believing a class is cancelled with nothing on the platform to correct them,
> which is a worse failure than the one this revision exists to fix. Both halves
> are **idempotent**: cancelling twice or restoring twice produces the same rows.
> **(6) Reads are the caller's own and nobody else's.** `GET /notifications`
> returns only rows whose `user_id` is the authenticated caller's, paginated per
> TD-10, newest first with the `id` tiebreaker (R76.3). `POST
> /notifications/{id}/read` marks one read and is idempotent; a row belonging to
> another user answers **`404`, never `403`** (§20 rule 17). No endpoint lists,
> counts or reveals another user's notifications, and no role — Admin or Super
> Admin — may read another person's. **(7) TD-3 gains two routes**, both
> authenticated and neither role-gated, because a notification's audience is
> established when it is written and re-checking a role at read time would answer
> a different question. **(8) The MVP surface is a count and a list on the
> student's own screen**, not §10.1's bell-and-dropdown: whatever §10.1 later
> specifies replaces this surface rather than extending it. **(9) §4.8's
> substitute channels are unchanged and are still the association's primary
> means.** This adds a record inside the platform; it does not claim the family
> was reached.

## 4 · What this costs

| | |
|---|---|
| **Schema change** | **One table**, `notification`, with one enum. No column added to any existing entity. |
| **New entities** | 1 (`Notification`). `NotificationPreference` remains out. |
| **New endpoints** | 2. |
| **TD-2 rows** | **None** — a notification is read by its own recipient, which is not a role. |
| **Default behaviour** | Unchanged for every existing screen. |
| **Reversibility** | The table can be dropped; nothing else references it. |

## 5 · What was approved

1. Narrow §4.8's postponement to the **framework**, admitting one event.
2. `Notification` as defined in (2) — **no** `NotificationPreference`, no tier.
3. Restore as a **second event**, not a silent deletion (5).
4. The two TD-3 routes in (7), and the §20 rule 17 answer in (6).
5. **Parents are not notified in the MVP** (3). This was the one point where a
   reasonable Owner might decide the other way, and it was **decided in the
   instruction itself** — *"notifying only students actually enrolled"* — so it
   is recorded here rather than asked.

## 6 · The alternative that was rejected

**A derived read** — *"sessions in my calendar that are cancelled"* — needs no
table and no migration, and it was seriously considered. It fails on **read
state**: without a stored row there is nothing to mark read, so the screen can
only ever say *this class is cancelled* and never *this is news*. It also cannot
survive the roster changing: a student who leaves a Level would lose the notice
that last week's class was cancelled, which is precisely when they most need it.
A notification is a **delivered fact**, not a projection of current state, and
the two differ the moment either side moves.
