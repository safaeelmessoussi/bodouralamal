[Documentation](../README.md) › [Reference](README.md) › **Error codes**

# Error codes

The **canonical application error-code catalogue**. All services use exactly these
identifiers, and the set is **extensible only by specification revision** — so a client can
switch on `code` safely.

## The envelope

Every non-2xx response, without exception:

```json
{
  "error": {
    "code": "CAPACITY_FULL",
    "message_key": "errors.roster.capacity",
    "message": "…localized fallback…",
    "details": { },
    "request_id": "b3f1…"
  }
}
```

- **`code`** — switch on this. Stable, closed set.
- **`message_key`** — resolve through your i18n catalogue. Arabic is primary.
- **`message`** — a fallback for logs and debugging, not for display when you can resolve the
  key.
- **`request_id`** — show it discreetly. It is the same id in the server logs and in any job
  the request enqueued.

**Never present in any response:** stack traces, SQL, internal paths.

---

## The catalogue

### 400 — the request is wrong

| Code | When | What a client should do |
|---|---|---|
| `VALIDATION_FAILED` | Field validation; **a missing child header from a parent-only caller** | Show inline field errors. Sticky until corrected |
| `CONSENT_REQUIRED` | Registration submitted without a mandatory consent checkbox | Highlight the checkbox |

### 401 — not authenticated

| Code | When | What a client should do |
|---|---|---|
| `AUTH_REQUIRED` | No or expired session | Attempt a single-flight refresh; if that fails, redirect to login |

**A public endpoint never returns `401`.** An invalid or expired credential on a public route
is **ignored** and the request proceeds anonymously. A client that treats `401` as *redirect
to login* would otherwise login-wall a public page.

**Every refresh refusal returns this same code** — expired, revoked, unknown, purged, or
reuse-detected. The paths are deliberately indistinguishable: telling the holder of a stolen
cookie *why* it failed would confirm the token was once real. The distinction lives in the
audit log.

### 403 — authenticated, but not allowed

| Code | When | What a client should do |
|---|---|---|
| `FORBIDDEN` | Permission-matrix violation, consent gate, global-scope violation | Red toast with the message key |
| `CONSENT_GATE_LOCKED` | A **teacher** attempting to lift a consent-forced private state | Explain that only an Admin can, with justification |

`403` is used **only** where the caller may know the resource exists. Out-of-scope access is
`404` — see below.

### 404 — not found, or not yours

| Code | When |
|---|---|
| `NOT_FOUND` | Missing **or out of scope** — branch, family — **never distinguished** |

> This is a security control, not an ergonomic choice. `403` would confirm *the thing exists
> and you may not see it* — precisely the fact that must not leak about a minor's record, an
> unapproved family link, or another branch's data.

→ [Security](../architecture/security.md#no-existence-leaks)

### 409 — the state or a constraint conflicts

| Code | When | What a client should do |
|---|---|---|
| `STATE_CONFLICT` | A transition the state machine does not allow; **onboarding-token replay** | Usually "already handled" — refresh and re-render |
| `VERSION_CONFLICT` | **Optimistic-lock mismatch** — a stale version on a staff-edited entity | *"This record was changed by someone else."* Reload, let the user re-apply |
| `DUPLICATE` | Unique-constraint race loser | Treat as already-created |
| `SCHEDULE_CONFLICT` | **A room, teacher or assistant is already committed** for an overlapping session (§4.4). Detected against **materialized** sessions, so the answer is exact rather than an approximate rule comparison | Name the clashing session and offer to move one — the `details` carry the resource and the date |
| ~~`CAPACITY_FULL`~~ | **Retired by Revision 43.** BR-23: room capacity informs and refuses nothing, and an Administrative Group has no capacity at all. **Nothing can raise it**, and TD-3.8 removed it because an unraisable code invites someone to find a use for it | — |
| `SINGLE_SUBMISSION_FINAL` | Resume attempted on a single-submission exam | Explain the policy |
| `UPLOAD_INCOMPLETE` | Completion called on a missing or partial object | Offer retry from the start |
| `WEIGHT_SUM_EXCEEDED` | Template items would exceed 10,000 bp | *(post-MVP)* |
| `TEMPLATE_NOT_ACTIVE` | Operation requires an active template | *(post-MVP)* |
| `FAMILY_LINK_PENDING` | **Own-resource contexts only** — a parent acting on their own not-yet-approved request | Explain it is awaiting approval |

`FAMILY_LINK_PENDING` carries a deliberate restriction: it is **never returned by the
child-context middleware**, where an unapproved link is `404`. Returning link status to a
non-owner would leak existence — which is why a duplicate staff-created link answers
`DUPLICATE` instead.

#### `STATE_CONFLICT` carries a `reason`, and clients should branch on it

`STATE_CONFLICT` alone says *the state disagrees*; the remedy differs completely by case, so
`details.reason` is the discriminator a screen actually renders. **A client that shows one
generic message for all of these is hiding the only useful part of the answer.**

| `reason` | Raised by | The user's next step |
|---|---|---|
| `SUBJECT_NOT_IN_LEVEL` | Creating a Teaching Group | Assign the Subject to the Level first (§4.4b) |
| `TEACHING_GROUPS_EXIST` | Removing a Subject from a Level | Delete the splits first — their members would otherwise hold seats in a subject that is not offered |
| `SCHEDULES_EXIST` | Deleting a Teaching Group | Move or delete the timetable entries that target it |
| `ALREADY_IN_SUBJECT_SPLIT` | Placing a student | They are in another split of the same Subject — the intent was almost certainly a *move* |
| `NOT_ENROLLED_IN_LEVEL` | Placing a student | Enrolment precedes placement (BR-22 from the other side) |
| `ALREADY_HELD` · `SESSION_IN_PAST` | Session edits | A held session cannot be rescheduled; a past one cannot be restored onto the timetable |
| `INVALID_TRANSITION` | Suspend / reactivate | TD-1 does not allow it from this status; `details.account_status` says which |
| `SELF_SUSPENSION` | Suspend | An administrator cannot suspend themselves — the next request would lock them out |
| `LAST_SUPER_ADMIN` | Suspend, or `PUT .../roles` | Appoint another Super Admin first. Revision 22's lockout recovery needs a VPS shell and is not a UI outcome |
| `GENDER_RESTRICTION` | Enrolment, including at approval | The Level admits one sex (§4.4b); `details.required_sex` says which. **The student's own sex is never echoed** |
| `ALREADY_ENROLLED_IN_LEVEL` | Enrolment | BR-21 — one group per Level. `current_administrative_group_id` is named, because the intent was probably a *move* |
| `CONSENT_TEXT_VERSION_NOT_CONFIGURED` | Registration (`503`, not `409`) | An owner task (§2.3) — the message names the missing setting |

Two more travel on **`400 VALIDATION_FAILED`** rather than `409`, because they describe a
malformed request rather than a state that moved on:

| `details.reason` | Raised by | The user's next step |
|---|---|---|
| `ENROLLMENT_REQUIRED` | Approval | §4.1: every admitted student needs a Level and a group **in the approval itself**. `missing_user_ids` names who — on a family bundle that is the only way to know which of them |
| `NOT_IN_BUNDLE` | Approval | A placement named somebody this approval does not admit. Without the check, approval would be an unscoped enrolment endpoint |

**Deletion blocked by references is different**: it carries `details.blocked_by`, an object of
`{ relationship: count }` naming every blocker at once, so a screen can say *which* rather than
making the administrator remove things one at a time to find out.

### 413 · 429

| Code | When | What a client should do |
|---|---|---|
| `PAYLOAD_TOO_LARGE` | Upload caps exceeded | Show the cap; suggest splitting long recordings |
| `RATE_LIMITED` | Nginx per-IP **or** the per-user quota | Back off. **One shape for both layers**, so clients handle it once |

### 500 · 502 · 503

| Code | HTTP | When |
|---|---|---|
| `INTERNAL` | 500 | Anything else. **No internals leaked** |
| `OAUTH_EXCHANGE_FAILED` | 502 | Google code exchange failed. Surfaced to the browser **only** as the `/login?error=oauth_unavailable` redirect |
| `SERVICE_UNAVAILABLE` | 503 | A required dependency (storage, OAuth upstream) is down |

`SERVICE_UNAVAILABLE` is what the [degraded-operation
matrix](../operations/resilience.md#degraded-operation) returns. **The system never fabricates
success** — a failed dependency yields a 503 and a proper error state, never a blank screen
or silent data loss.

---

## Two things that are not envelopes

**OAuth callback failures are redirects.** The callback is a browser flow; it redirects to
`/login?error=<key>` with one of `user_denied`, `state_mismatch`, `oauth_unavailable`, or
`email_unverified` — rendered as a friendly message with a retry.

**Concurrency conflicts are never 500s.** They are expected, coded outcomes with their own
409 codes.

---

## Client handling summary

```
401  → single-flight refresh, then login. NEVER on a public endpoint.
403  → red toast, message_key text, 6 s
404  → "not found" — do not speculate about permissions
409 VERSION_CONFLICT → "changed by someone else", reload, re-apply
409 (other)          → usually "already handled", refresh
429  → back off
503  → error state with retry; the rest of the app still works
4xx validation → inline field errors, sticky
```

**Toasts never contain PII beyond first names, and never raw error internals.**

---

**Related:** [API](../architecture/api.md#the-error-envelope),
[API endpoints](api-endpoints.md), [Resilience](../operations/resilience.md)
