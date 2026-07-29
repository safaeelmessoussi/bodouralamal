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
| `CAPACITY_FULL` | Group roster at capacity — **one code, not two** for "group full" | Show remaining capacity |
| `SINGLE_SUBMISSION_FINAL` | Resume attempted on a single-submission exam | Explain the policy |
| `UPLOAD_INCOMPLETE` | Completion called on a missing or partial object | Offer retry from the start |
| `WEIGHT_SUM_EXCEEDED` | Template items would exceed 10,000 bp | *(post-MVP)* |
| `TEMPLATE_NOT_ACTIVE` | Operation requires an active template | *(post-MVP)* |
| `FAMILY_LINK_PENDING` | **Own-resource contexts only** — a parent acting on their own not-yet-approved request | Explain it is awaiting approval |

`FAMILY_LINK_PENDING` carries a deliberate restriction: it is **never returned by the
child-context middleware**, where an unapproved link is `404`. Returning link status to a
non-owner would leak existence — which is why a duplicate staff-created link answers
`DUPLICATE` instead.

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
