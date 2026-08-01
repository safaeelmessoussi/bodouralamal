[Documentation](../README.md) › [Reference](README.md) › **API endpoints**

# API endpoints

**47 operations across 35 paths**, all under `/api/v1` except the health check.

> Exact schemas: [`openapi.json`](../openapi.json) — **generated, never hand-edited.**
> Conventions and governance: [API](../architecture/api.md).
> Every response is an explicit contract DTO, never an ORM entity
> ([why](../architecture/api.md#the-contract-is-an-interface-not-a-serialisation)).

**Audience:** 🌐 public/anonymous · 🔒 authenticated · 👤 Super Admin only (enforced in the
service, not by the URL prefix).

---

## Health

| | Path | Audience |
|---|---|---|
| `GET` | `/healthz` | 🌐 Component health for database, storage, and job queue. Served at the **origin root**, not under the API prefix |

## Authentication

| | Path | Audience | Notes |
|---|---|---|---|
| `GET` | `/auth/google` | 🌐 | Redirect to Google with state + PKCE |
| `GET` | `/auth/google/callback` | 🌐 | Routes by identity resolution. **Failures redirect, never JSON** |
| `POST` | `/auth/refresh` | 🍪 | **The only cookie-authenticated route.** Requires a custom header and an `Origin` match |
| `POST` | `/auth/logout` | 🔒 | Revokes **the current session only** — other devices keep working |
| `GET` | `/me` | 🔒 | Identity, roles, scopes, status, approved child links. **One of only two endpoints a Pending session may call** |

## Public

Three anonymous endpoints, each a deliberate decision about what may be public.

| | Path | Returns |
|---|---|---|
| `GET` | `/calendar` | Occurrences at the caller's visibility tier. **Self-sufficient** — opening an event costs no further request. **Uncached** |
| `GET` | `/calendar/bootstrap` | The calendar screen's reference data in one read. **Cached 5 min + strong ETag.** Reference data only — never operational data. `?category_id=` narrows **only** the Level list, server-side (§4.4); an unknown id yields an empty list rather than falling back to all |
| `GET` | `/branches` | The landing-page branch directory: id, name, address, phone, email, opening hours, map link, display order. **Never** version, operational start date, or timestamps |

`GET /branches` is deliberately **not** the admin route with permissions relaxed — an
endpoint's audience is part of its contract.

## Registration and approvals

| | Path | Audience | Notes |
|---|---|---|---|
| `POST` | `/registrations` | 🌐 + token | Gated by the signed onboarding token; no session exists yet. **Identity comes solely from the token payload** |
| `GET` | `/admin/approvals` | 🔒 | Deliberately **unscoped** — the permanent path by which a branch Admin meets applicants |
| `POST` | `/admin/approvals/{id}/approve` | 🔒 | Atomic bundle activation |
| `POST` | `/admin/approvals/{id}/reject` | 🔒 | Body carries a reason |
| `POST` | `/family-links` | 🔒 | **Staff-mediated** link of an existing child. Parents have no search over children |
| `DELETE` | `/admin/family-links/{id}` | 🔒 | Soft delete **is** the revocation — effective on the next request |

## Users, consents, and case files

| | Path | Audience | Notes |
|---|---|---|---|
| `GET` `POST` | `/admin/users` | 🔒 | List with search; create pre-provisions against a Google address |
| `GET` `POST` | `/students/{id}/consents` | 🔒 | Versioned records; staff-recorded grants carry the actor |
| `GET` `PUT` | `/students/{id}/social-profile` | 🔒 | **Both reads and writes audited.** Out of scope answers `404`, never `403` |

## Reference data

Writes are Super Admin only; Admins read within scope. **Teachers have no access at all** —
they receive reference information through the operational APIs they are authorised to use.

| | Path | Audience |
|---|---|---|
| `GET` `POST` | `/admin/branches` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/branches/{id}` | 👤 |
| `GET` `POST` | `/admin/branches/{id}/rooms` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/rooms/{id}` | 👤 |

## Groups and rosters

Operational — Admin-managed within branch scope.

| | Path | Notes |
|---|---|---|
| `GET` `POST` | `/admin/groups` | Creation runs room/time conflict detection |
| `PATCH` `DELETE` | `/admin/groups/{id}` | Deletion blocked while enrolments exist |
| `GET` `POST` | `/admin/groups/{id}/roster` | Enrolment locks the group row for the capacity check and **enqueues consent re-evaluation** |
| `DELETE` | `/admin/groups/{id}/roster/{studentId}` | Soft-deletes the enrolment **only** — academic records survive |
| `POST` | `/admin/groups/{id}/instructors` | Co-teaching |
| `DELETE` | `/admin/groups/{id}/instructors/{teacherId}` | |

## Events

| | Path | Notes |
|---|---|---|
| `POST` | `/events` | Writes the four-way scope joins **explicitly at creation** |
| `PATCH` `DELETE` | `/events/{id}` | |
| `GET` `POST` | `/admin/branches/{id}/event-backfill` | Manual backfill on branch activation. Stays an **Admin** capability — it is operational work |

## Hijri calendar

Super Admin only, enforced in the service.

| | Path | Notes |
|---|---|---|
| `GET` | `/admin/hijri-calendar?year=` | The twelve months, draft and published |
| `PUT` | `/admin/hijri-calendar/{year}/{month}` | **Records** an official announcement. Optimistic locking |
| `POST` | `/admin/hijri-calendar/{year}/publish` | Only published months render anywhere |
| `GET` | `/admin/hijri-calendar/{year}/history` | The audit trail for that year |

**No import route ships.** There is no machine-readable source to import from, so an endpoint
could only ever answer *not configured*.

---

## Specified, not yet built

Documented in the specification, reported as `PENDING` by the contract check until their
milestone lands. **They are a work-in-progress signal, not invented endpoints.**

| Milestone | Endpoints |
|---|---|
| **M4 — Quran** | `POST /students/{id}/quran-logs` · `PATCH` / `DELETE /quran-logs/{id}` — each returns the **synchronously recalculated** coverage |
| **M5 — Exams** | `POST /exams` · `POST /exams/{id}/publish` · `POST /exams/{id}/submissions` · `PATCH /submissions/{id}` · `POST /submissions/{id}/submit` · `POST /grades/{id}/publish` · `/republish` · `/pass-fail-override` |
| **M6 — Storage** | `POST /uploads/initiate` · `/complete` · `/abort` · `GET /content/{id}/download-url` |
| **Jobs** | `GET /jobs/{id}` — any endpoint that enqueues returns `202` with a job id |

**Post-MVP, deliberately absent:** grading-template routes, multipart upload endpoints, CSV
import/export, the Hijri importer.

### Not specified at all — the educational library's gap

The `/resources` library (§5.2) is **built and reviewable** against a mock adapter, and cannot
be wired because **no endpoint exists to wire it to**. This is a genuine specification gap
rather than an unimplemented milestone item: TD-3.5 defines the three upload routes and
`GET /content/{id}/download-url`, and **no route anywhere in the SRS lists content.**

| Needed | For | Status |
|---|---|---|
| A **level index** with per-level content and year counts | Page 1's cards. One request, not one per level — otherwise an N+1 on a public page | **Not specified.** Needs a revision |
| A **level content read**, grouped year → branch | Page 2's whole hierarchy | **Not specified.** Needs a revision |
| `GET /content/{id}/download-url` | Every preview and download | **Specified (TD-3.5), unimplemented** — M6 |
| An **uploader** on `EducationalContent` | The teacher display name the cards show | **Not in §7's field list.** Needs a revision plus a forward-only migration |

**Two constraints any listing endpoint must satisfy**, recorded because they are easy to miss
and impossible to add safely later:

- **Visibility is resolved server-side from the live actor**, exactly as `GET /calendar` does
  (§4.4) — an anonymous visitor receives the public tier only, and no query parameter may widen
  it.
- **`consent_forced_private` recordings never appear on a public surface** (BR-2). That is a
  filter no client may be trusted to apply.

**Two divergences from §5.2** for the Document Owner to settle: §5.2 specifies a **Subject**
tier beneath Branch (rendered as a card badge instead) and pins the **`is_current`** academic
year at top (the page sorts strictly newest-first).

---

## Conventions at a glance

| | |
|---|---|
| Prefix | `/api/v1`, same origin as the client |
| Auth | `Authorization: Bearer` — **never a cookie**, except `/auth/refresh` |
| Child context | `X-Active-Child-ID`, verified per request against **both** parties |
| Lists | Paginated: `?page=1&page_size=25`, default 25, max 100, `{ data, meta }` |
| Errors | One envelope, always → [Error codes](error-codes.md) |
| Out of scope | **`404`, never `403`** |
| Public endpoints | **Never return `401`** — an invalid credential is ignored |

---

**Related:** [API](../architecture/api.md), [Error codes](error-codes.md),
[`openapi.json`](../openapi.json)
