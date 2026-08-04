import { writeFileSync } from 'node:fs';

import { createApp } from '../src/app.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import type { AppConfig } from '../src/lib/config.js';

/**
 * Placeholder values used only to build the router for introspection. Generation
 * must not require a configured environment — CI's contract job deliberately runs
 * with no secrets — and nothing here is ever used to serve a request or to reach
 * the network.
 */
const SYNTHETIC_CONFIG: AppConfig = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  GOOGLE_CLIENT_ID: 'unused',
  GOOGLE_CLIENT_SECRET: 'unused',
  JWT_SIGNING_KEY: 'unused',
  ONBOARDING_TOKEN_KEY: 'unused',
  MINIO_ENDPOINT: 'http://127.0.0.1:1',
  MINIO_ACCESS_KEY: 'unused',
  MINIO_SECRET_KEY: 'unused',
  PUBLIC_BASE_URL: 'http://127.0.0.1',
  STORAGE_BASE_URL: 'http://127.0.0.1/storage',
  SUPER_ADMIN_EMAIL: 'unused@example.com',
  NODE_ENV: 'test',
  TZ: 'Africa/Casablanca',
  PORT: 3000,
  LOG_LEVEL: 'info',
};

/**
 * Generates `docs/openapi.json` from the routes this implementation actually
 * serves (SRS §3.1, §19.2).
 *
 * Precedence is one-directional and absolute: the **SRS TD-3 registry is the
 * canonical contract**, and this document is a generated artifact of the
 * implementation that must conform to it. CI compares the two in both
 * directions. **Never hand-edit this file to make the check pass** — a mismatch
 * is an implementation bug or an SRS revision, never a documentation fix.
 *
 * Only routes already implemented appear here; the remaining TD-3 endpoints
 * join as their milestones land.
 */

interface Operation {
  summary: string;
  description: string;
  responses: Record<string, unknown>;
}

/**
 * The TD-3.8 codes this implementation can actually emit. A code appears here
 * only once something throws it — the SRS catalogue is wider because it also
 * covers later milestones (`WEIGHT_SUM_EXCEEDED`, `RATE_LIMITED`, …).
 */
const ERROR_CODES = [
  'VALIDATION_FAILED',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'STATE_CONFLICT',
  'VERSION_CONFLICT',
  'DUPLICATE',
  'CONSENT_REQUIRED',
  'CAPACITY_FULL',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
];

const ENVELOPE = 'Error envelope (TD-3.8).';

function op(summary: string, description: string, responses: Record<string, string>): Operation {
  const declared = Object.entries(responses).map(([status, text]) => [
    status,
    Number(status) >= 400
      ? {
          description: text,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        }
      : { description: text },
  ]);

  // Every endpoint can return 500 — the error middleware is the last handler on
  // every route. Documenting it once here rather than per operation keeps it
  // from being forgotten on the endpoint where it eventually matters.
  declared.push([
    '500',
    {
      description: `${ENVELOPE} INTERNAL — unexpected server fault; details are never leaked to the client.`,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    },
  ]);

  return { summary, description, responses: Object.fromEntries(declared) };
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'بذور الأمل Platform API',
    version: '0.1.0',
    description:
      'Generated from the implementation. The SRS TD-3 route registry is the canonical ' +
      'contract (§3.1); this document must conform to it and is never hand-edited.',
  },
  servers: [{ url: '/api/v1', description: 'Same-origin API path (§3.1)' }],
  components: {
    schemas: {
      // TD-3.8: one envelope for every non-2xx response, on every endpoint.
      // Described once here rather than restated per operation — the prose in
      // each response says which `code` to expect; this says what the body is.
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message_key', 'message', 'details', 'request_id'],
            properties: {
              code: {
                type: 'string',
                description:
                  'The canonical application error code (TD-3.8). Extensible only by SRS revision.',
                enum: ERROR_CODES,
              },
              message_key: { type: 'string', description: 'i18n key; the client renders this.' },
              message: {
                type: 'string',
                description: 'Localised fallback text (Arabic at launch, §6).',
              },
              details: {
                type: 'object',
                additionalProperties: true,
                description:
                  'Structured context for codes that carry it — e.g. `reason: ROOM_TIME_OVERLAP` ' +
                  'with `conflicting_group_id`, `capacity` on CAPACITY_FULL, or `conflicting_month` ' +
                  'on a Hijri ordering refusal. Empty object when there is nothing to add.',
              },
              request_id: {
                type: 'string',
                description: 'Correlates the response with the server log line.',
              },
            },
          },
        },
      },
    },
  },
  paths: {
    '/auth/google': {
      get: op(
        'Begin Google OAuth',
        'Redirects to Google with state + PKCE (§4.1b steps 1–2, TD-12).',
        { '302': 'Redirect to Google.' },
      ),
    },
    '/auth/google/callback': {
      get: op(
        'Google OAuth callback',
        '§4.1b routing: existing identity → session by status; pre-provisioned email match → ' +
          'bind identity → session by status; unknown → onboarding. Failures are REDIRECTS to ' +
          '/login?error=<key>, never the TD-3.8 envelope (§4.1b step 7).',
        { '302': 'Redirect by routing decision, or to /login?error=<key> on failure.' },
      ),
    },
    '/auth/refresh': {
      post: op(
        'Rotate the refresh token',
        'The ONLY cookie-authenticated route (TD-12). Requires X-Requested-With and an Origin ' +
          'matching PUBLIC_BASE_URL. Rotation, the 10s predecessor grace window, and ' +
          'reuse detection are per TD-4.13 and §18 T1–T12.',
        {
          '200': 'New access token; a rotated refresh cookie unless the grace window applied.',
          '401': `${ENVELOPE} All refusal reasons are deliberately indistinguishable.`,
        },
      ),
    },
    '/auth/logout': {
      post: op(
        'Log out of the current session',
        'Revokes the current session only; other devices are unaffected (TD-4.14).',
        { '204': 'Session revoked. Idempotent.' },
      ),
    },
    '/me': {
      get: op(
        'Current identity',
        'Identity, roles, branch scopes, account_status and approved child links. The only ' +
          'endpoint (with logout) that a Pending session may call (TD-1).',
        { '200': 'Current user.', '401': ENVELOPE },
      ),
    },
    '/registrations': {
      post: op('Unified registration', 'Public, gated by the signed onboarding token in X-Onboarding-Token (§4.1b step 4c). Adult self-registration or parent+child in ONE transaction (TD-4.1). Identity comes solely from the token payload — the schema rejects email/provider_subject_id outright (§20 rule 9). New accounts enter Pending. **A 503 `SERVICE_UNAVAILABLE` from this endpoint carries actionable `details`**: when `legal.consent_text_version` is unset (§2.3 owner task) the body reports `reason: CONSENT_TEXT_VERSION_NOT_CONFIGURED` and names the setting, because §4.1a forbids writing a consent record whose text version is unknown and a client cannot distinguish a configuration gap from a transient outage without being told. **`first_name_arabic` and `last_name_arabic` are REQUIRED for every person (Revision 40)** — الاسم الشخصي and الاسم العائلي, 1–60 characters each so the composed name fits `name_arabic`\'s 120. **`name_arabic` is NOT accepted**: the server composes it as `"{first} {last}"` in the same transaction, because a client composing it would become the authority on how a person\'s name reads (§1.1), and `.strict()` therefore rejects a supplied `name_arabic` rather than ignoring it. **`branch_id` is REQUIRED (Revision 39)** — the applicant chooses exactly one Branch, and **no Level, Room or Group**, which `.strict()` rejects outright rather than dropping so a client cannot believe a placement was recorded. The value is validated **inside the transaction** against a live, non-soft-deleted `Branch`: a closed premises is refused (`VALIDATION_FAILED`), because the foreign key alone would not catch a soft delete. A branch whose `operational_start_date` has not yet occurred **is** accepted — §4.4 keeps such a branch out of the *calendar*, but an association must be able to enrol for a premises before it opens. It is written to `User.intended_branch_id` **on the applicant only**, never copied onto the child: the parent chose one branch for the family, and a second copy would be a second value to keep in step. **It records a REQUEST, not a placement** — where the person ends up is their Group, assigned administratively after approval (§4.1). **`sex` (`female` | `male`) is REQUIRED for every person the transaction creates (Revision 27)** — the applicant, and the child on the parent+child path — because the registration exists before the User does; it is the person-side half of `Level.gender_restriction` and is written in the same transaction, never patched on afterwards. Person objects are **strict**: an unknown key is refused, not silently stripped. **The payload carries no placement (Revision 29)** — no Branch, Room, Level or Group — because registration creates a pending applicant only; assignment is an administrative action after approval, and reference data stays behind its own APIs.', { '201': 'Created; account_status pending.', '400': `${ENVELOPE} VALIDATION_FAILED or CONSENT_REQUIRED.`, '409': `${ENVELOPE} STATE_CONFLICT on token replay; DUPLICATE if the identity exists.`, '503': `${ENVELOPE} consent text version not configured (§2.3).` }),
    },
    '/admin/settings': {
      get: op('Platform settings', '**Super Admin only** (§5.6, TD-3.11, Revision 42), asserted against live rows per request (TD-12). Returns the **writable** settings and their current values — an explicit server-side allow-list, not every `SystemSetting`: the table also holds category default visibilities and the grading scale, which have different audiences and consequences. Each row carries `key`, `label_key`, `hint_key`, `value` and `version`. `value` is `null` when the setting has **never been configured**, which is deliberately distinct from an empty string (refused on write): for `legal.consent_text_version` a null is the state in which **no registration can be accepted at all** (§4.1a), so the screen can call it out rather than showing a blank box. Labels arrive as **i18n keys chosen by the server**, so a client cannot hold its own list and drift out of step with the allow-list.', { '200': 'The writable settings, configured or not.', '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN for anyone but a Super Admin.` }),
    },
    '/admin/settings/{key}': {
      put: op('Update a platform setting', '**Super Admin only** (§5.6, TD-3.11, Revision 42). Body: `{ value, version }`. **This endpoint exists because the platform was otherwise undeployable:** `legal.consent_text_version` is required before any registration is accepted (§4.1a), §15.1 deliberately does not seed it (§2.3 makes versioning the Arabic consent text an owner compliance task), and no API previously existed to set it — so a first deployment refused every applicant with no in-product remedy. **The key must be on the writable allow-list**, otherwise `404` (§20 rule 17: never a 403, which would confirm the key exists elsewhere). **The value is validated per key and may never be empty** — for the consent version, a non-blank string of 1–100 characters after trimming, because a blank version would *look* configured while reproducing the exact failure the setting prevents. **TD-15 optimistic locking:** a stale `version` is `409 VERSION_CONFLICT` rather than a silent overwrite of another Super Admin\'s change. **Audited as `setting.update` carrying the OLD and NEW value** (TD-8) — a row holding only the new value cannot answer *"what text was in force when this person consented"*, which is the question a compliance review asks. **A change affects FUTURE registrations only:** registration copies the version onto each `ConsentRecord` at the moment of agreement, and nothing here rewrites a stored consent, because §4.1a\'s requirement that each record carry the exact text agreed to is precisely what forbids restamping.', { '200': 'Saved; returns the setting with its incremented version.', '400': `${ENVELOPE} VALIDATION_FAILED — empty, over-long, or wrong-typed value.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN for anyone but a Super Admin.`, '404': `${ENVELOPE} NOT_FOUND for a key that is not writable through this API.`, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
    },
    '/admin/approvals': {
      get: op('Approval queue', 'Admin or Super Admin only (TD-2), re-asserted against live rows per request because approvals are a TD-12 high-risk surface. Two item types share the queue: `registration` (a pending applicant together with any pending child and link that arrived as one §4.1 bundle) and `family-link` (a standalone §4.3 "Link a Child" request). A pending child is never listed separately — it appears inside its parent\'s bundle so the family is approved once. Paginated per TD-10 (default 25, max 100), oldest first. **Explicit contract DTO (§16.2, Revision 38):** an item is `id`, `type`, `applicants: [{ id, name, role }]`, `submitted_at`, `bundle: { child_count, link_count }` and **`branch: { id, name } | null` (Revision 39)**. **`branch` is what the applicant ASKED FOR at registration, never where they will be placed** — placement is the person\'s Group, decided administratively after approval. It is `null` on a family-link item, which carries no branch at all, and `null` on any account registered before R39, where it means *not stated* rather than *no branch*. **`?branch_id=` filters, and deliberately does not scope** (§14.2, R39): it narrows what this reader chose to look at and does not limit what they may see, because the queue must keep showing a branch Admin the applicant whose chosen branch is **wrong** — or absent — so they can correct it. Turning it into a scope would be an access-control change requiring its own revision. A `branch_id` filter **excludes family-link items wholesale** rather than matching none of them, which is what keeps `meta.total` honest. This queue never returned an ORM entity — it returned a hand-built shape in `camelCase`, which Revision 38 corrected in the same pass, because a contract that is *mostly* consistent is the harder kind to remember. `submitted_at` is an **instant**, correctly: a submission is a moment, not a calendar date. `name` rather than `name_arabic` because the field is *the name to display*, and this staff-facing queue shows legal names — the §7 public display-identity invariant governs **public** surfaces, where a kunya may stand in; here it would be wrong.', { '200': 'Queue page; each item carries its applicants and what approving it will change.', '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN when the caller is no longer Active or the admin role assignment no longer exists (TD-12).` }),
    },
    '/admin/approvals/{id}/approve': {
      post: op('Approve a queue item', 'TD-4.2: parent activation, child activation, link approval and the audit row commit in ONE transaction — §4.3 requires all three atomically, since a half-approved bundle is a parent who can see a child whose own record is still Pending. TD-1 transition Pending → Active. Approval does NOT assign roles. Concurrent decisions are first-wins (TD-15.3): the loser gets 409, never a 500.', { '200': 'Approved; reports the item type and how many accounts were activated.', '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness or TD-2 role).`, '404': `${ENVELOPE} NOT_FOUND for an unknown id.`, '409': `${ENVELOPE} STATE_CONFLICT when the item was already decided.` }),
    },
    '/admin/approvals/{id}/reject': {
      post: op('Reject a queue item', 'Requires a reason (§5.6, §14.2) of at most 500 characters (TD-9) — rejecting a family\'s application without recording why is not an auditable decision. Rejection is atomic across the bundle in the same way as approval (TD-4.2): the parent and child are never left half-decided. TD-1 transition Pending → Rejected.', { '200': 'Rejected; the reason is stored on the decision and in the audit row.', '400': `${ENVELOPE} VALIDATION_FAILED when the reason is missing or too long.`, '401': ENVELOPE, '403': ENVELOPE, '404': ENVELOPE, '409': `${ENVELOPE} STATE_CONFLICT when the item was already decided.` }),
    },
    '/branches': {
      get: op('Public branch directory', "TD-3.9 (Revision 35) — the §5.1 landing-page branch list, **anonymous**. Returns **only** `id`, `name`, `address`, `phone`, `email`, `opening_hours_ar`, `google_maps_url` and `display_order`; `version`, `operational_start_date`, `created_at`, `updated_at`, `deleted_at` and `deleted_by` are **never** exposed. The projection is an explicit `select`, not a filtered read, so a column added to `Branch` later joins the model and not this response. This is deliberately **not** `GET /admin/branches` with the permission relaxed: an endpoint's audience is part of its contract, and one endpoint serving two audiences has to get the difference right on every future change. **Soft-deleted branches never appear** — a closed premises must not keep advertising an address and a phone number. `opening_hours_ar` is free multiline Arabic text, displayed verbatim and **never parsed** (§7); `google_maps_url` is an absolute `https://` URL or `null`, and a client must degrade gracefully when it is null rather than fabricate a link. Ordered `display_order ASC NULLS LAST`, then `name` (correct Arabic order via the native collation), then `id`. **Paginated (TD-10):** `?page=` (default 1) and `?page_size=` (default 25, max 100 — capped, not refused).", { '200': 'The public branch list with the TD-10 envelope.', '400': `${ENVELOPE} VALIDATION_FAILED.` }),
    },
    '/calendar/bootstrap': {
      get: op('Calendar bootstrap', "TD-3.10 (Revision 36) — everything the calendar screen needs to render its **chrome**, in one anonymous read: the Hijri mapping for every day in the range, the month metadata behind the dual title, and the Category, Level and Branch lists for the filters. `GET /calendar` keeps returning **only** occurrences, so the page makes exactly **two** requests and never a third. **Reference data only** — events, enrolments, progress and grades are never admissible here whatever a future screen would find convenient; that limit is what keeps a bootstrap from becoming a dumping ground. **Not a list endpoint, so TD-10 does not apply**: the contained lists are bounded by the domain (3 categories, ~21 levels, ≤10 branches, ≤366 days), and paginating a filter would be meaningless because a caller cannot use half of one. `hijri.months` and `gregorian_months` are what let the client render *يوليوز 2026 | محرم 1448* — or the two-month form across a boundary — with **no month-transition logic of its own**. A day whose Hijri month is not recorded and published omits its `hijri_*` fields (Revision 31: the platform says nothing rather than computing). **Cacheable**: `Cache-Control: public, max-age=300` plus a strong `ETag`, chosen against what actually changes — recording a Hijri month is not something a visitor must see within seconds, while an event edit is, which is why `/calendar` stays uncached. **`?category_id=` narrows the Level list, server-side**: §4.4 requires the restriction to happen here *\"so the client never filters a list it was handed\"*, so selecting a Category on the screen is a request rather than a local filter. It scopes **only** the Level list — the Hijri days, month metadata, Categories and Branches are the calendar's chrome regardless of which Category is selected. An unknown id yields an **empty** Level list rather than falling back to all Levels, because a filter that quietly stops filtering is worse than one returning nothing; a malformed id is `400`.", { '200': 'The calendar chrome, cacheable.', '400': `${ENVELOPE} VALIDATION_FAILED — missing dates, an inverted range, one longer than 366 days, or a malformed category_id.` }),
    },
    '/calendar': {
      get: op('Read the calendar', 'The one **public** read in the system (TD-3.4): an anonymous visitor receives the **public tier only**. One unified grid over the recurring **Group** timetable and the one-off **Event** exception layer, expanded across `from`..`to` (max 366 days — an unbounded range would expand every recurrence forever). All five recurrence types are supported; **biweekly-alternating** is week-on/week-off. **This endpoint never returns `401`** (Revision 34): a missing credential is anonymous, and an invalid, malformed or expired one is **ignored** and the request proceeds as anonymous — a credential that fails verification carries no identity to act on, and the landing page (§5.1) renders this calendar for visitors who have none. **Visibility is resolved server-side from the caller\'s live roles, never from a parameter** (§4.4): a Pending account sees exactly what an anonymous visitor sees; an approved Student or Parent adds the private tier, which is deliberately **not** filtered by the student\'s own branch (Risk R-6); a Teacher additionally sees Hidden events whose scope intersects their assigned groups; **all Admins see Hidden regardless of branch scope** while their Private tier **is** branch-scoped; Super Admins see everything. A group timetable is not public information, so an anonymous caller receives no groups. When scoped to a branch, nothing before its `operational_start_date` is returned (§4.4). **Instructors carry a resolved name (Revision 36.1)**: `instructors: [{ id, display_name }]`, where `display_name` is **already** `public_display_name` when the person set one and their full name otherwise. **Clients render it verbatim and implement no fallback** — a client-side `publicName || fullName` would be a second source of truth for which name a person agreed to publish, and the wrong branch leaks a legal name. **Each occurrence is self-sufficient (Revision 36)**: `description`, `recurrence`, `branch_name`, `room_name`, `category_id`/`category_name`, `level_id`/`level_name` and `instructors` travel with it, so an event dialog opens with **no further request** — the alternative was an N+1 on a public screen. Fields a kind has no source for are `null` rather than invented: an Event has no room or instructor, a Group no description or recurrence, because a Group *is* the routine timetable. A `category_id` filter joins `branch_id`/`level_id`/`group_id`; a Group inherits its category through its Level. Every occurrence also carries the **decorative Hijri overlay** (`hijri_date`, `hijri_month_ar`), read from the Ministry of Habous\'s official announcements as recorded in `HijriMonthStart` and resolved server-side (Revisions 31–32). **Nothing is computed and there is no day-offset** — the former adjustable ±2-day offset was removed, because an offset approximates a sighting-based calendar *uniformly* while the real divergence varies month to month. A month that has not been recorded **and published** carries `null` in both fields, and the client then renders the Gregorian date alone rather than a guess (§20 rule 14). It is a label: nothing in scheduling or recurrence reads it back (§4.4, §5.7). Dates are `YYYY-MM-DD` and times `HH:MM`, local wall-clock (TD-11) — a 09:00 class stays at 09:00 across Morocco\'s Ramadan DST shift (§19.2).', { '200': 'Occurrences, ordered by date then time then id.', '400': `${ENVELOPE} VALIDATION_FAILED — missing/invalid dates, an inverted range, or one longer than 366 days.`,  }),
    },
    '/events': {
      post: op('Create an event', '§4.4\'s exception layer — holidays, one-off activities, exams, ceremonies. The recurring weekly timetable belongs to Groups, so an Event never duplicates it. **Scope reach is materialised into the four join tables at creation** (`EventBranch`/`EventCategory`/`EventLevel`/`EventGroup`), *never* evaluated at read time: a wildcard would be re-interpreted on every calendar read and its meaning would silently change as branches are added. **Only branches whose `operational_start_date` has already occurred are attached** — a branch opening later is deliberately excluded, and the manual backfill action is how it joins, so the gap is neither auto-filled nor ignored. The response reports what was ACTUALLY attached, which may be fewer branches than requested. All five recurrence types are supported including biweekly-alternating; a recurring event **must** carry `recurrence_end_date`, since an unbounded recurrence would expand forever in every calendar query. Dates are `YYYY-MM-DD` and times `HH:MM`, local wall-clock (TD-11). TD-2: Admin and Super Admin may schedule any scope; a **Teacher may schedule only for their own groups** (hidden allowed) and cannot pair a group with a wider branch/level/global scope.', { '201': 'Created; reports the scope rows actually written.', '400': `${ENVELOPE} VALIDATION_FAILED — bad dates, or a recurring event without an end date.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN when a Teacher attempts a scope beyond their groups.`, '404': `${ENVELOPE} NOT_FOUND for a group the caller does not teach (§20 rule 17).` }),
    },
    '/events/{id}': {
      patch: op('Edit an event', "TD-15 optimistic locking: send the `version` you loaded; a stale one is `409 VERSION_CONFLICT`, never a silent overwrite of a colleague's edit. **Scope is not editable and scope keys are rejected** (`400`) rather than silently dropped — §4.4 materialises the four scope joins *at creation time* and provides the manual branch-activation **backfill** as the one sanctioned way to attach a branch later; re-resolving scope on edit would let a global event silently gain every branch that opened since it was created, which is exactly the auto-fill §4.4 forbids. Dates validate on the **merged** event, so clearing `recurrence_end_date` while the recurrence is still weekly fails. Who may edit is narrower than who may create: a branch-scoped Admin only for an event **every** branch of which is inside their scope, and a Teacher only for one scoped exclusively to groups they teach — anyone else gets `404`, not `403` (§20 rule 17).", { '200': 'The updated event with its new version.', '400': `${ENVELOPE} VALIDATION_FAILED — unknown/scope keys, a malformed date or time, or an invalid merged recurrence.`, '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an unknown event or one outside the caller's reach.`, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
      delete: op('Delete an event', 'TD-5: the event is soft-deleted and **its scope join rows are removed** — they are the materialised reach of an event that no longer applies, and carry no history of their own. Attached content keeps its `event_id` for provenance but no longer surfaces under the event.', { '204': 'Deleted.', '401': ENVELOPE, '403': ENVELOPE, '404': ENVELOPE }),
    },
    '/admin/hijri-calendar': {
      get: op('Read one Hijri year', 'SRS Revisions 31–32, §5.7. The platform **reproduces exactly the official Hijri calendar published by the Ministry of Habous and Islamic Affairs** — never Umm al-Qura, never a library algorithm, and there is no day-offset (the Ministry\'s divergence varies month to month, so a uniform offset cannot express it). Always returns **twelve** rows: a month the Ministry has not yet announced is a blank to fill, not a missing row. **Super Admin only** (Revision 26 reference data), enforced server-side — the `/admin/*` prefix is not the permission boundary.', { '200': 'The twelve months, recorded or blank, with status and version.', '400': `${ENVELOPE} VALIDATION_FAILED — missing year, or one outside TD-9\'s 1300–1600 (which rejects a Gregorian year typed into the Hijri field).`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN for anyone below Super Admin.` }),
    },
    '/admin/hijri-calendar/{year}/{month}': {
      put: op('Record the official start of one Hijri month', '**Records the Ministry of Habous\'s official announcement** for this month — the Gregorian date on which it announced the month began. **The Super Admin is not deciding this date** (Revision 32); the Ministry decides it by sighting, and this transcribes it. **TD-15 optimistic locking**: `version` is required when correcting an existing month and a stale one is `409` — two Super Admins correcting the same month must not clobber each other. **A correction returns the month to `draft`**, so a change to live data must be reviewed and republished deliberately. **TD-9 ordering** is enforced across the year boundary in both directions: month *n+1* must start after month *n* and no two months may share a start date, because an out-of-order pair makes date resolution ambiguous — and resolution is what every Hijri label in the platform depends on. Dates are `YYYY-MM-DD`, local calendar dates (TD-11), never instants.', { '200': 'The recorded month with its new version.', '400': `${ENVELOPE} VALIDATION_FAILED — malformed date, month outside 1–12, a missing version on an existing month, or \`reason: 'MONTH_ORDER'\` with the conflicting month in \`details\`.`, '401': ENVELOPE, '403': ENVELOPE, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
    },
    '/admin/hijri-calendar/{year}/publish': {
      post: op('Publish the official months of a Hijri year', '**Publishing is what makes a month visible platform-wide**: only published months are rendered anywhere, so a year can be recorded progressively and reviewed before anyone sees it. Publishes every `draft` month of the year in one transaction and reports the count. Publishing when there is nothing to publish is a coded `409` rather than a silent success, so the client can tell "already live" from "just published".', { '200': 'The number of months moved from draft to published.', '400': ENVELOPE, '401': ENVELOPE, '403': ENVELOPE, '409': `${ENVELOPE} STATE_CONFLICT with \`reason: 'NOTHING_TO_PUBLISH'\`.` }),
    },
    '/admin/hijri-calendar/{year}/history': {
      get: op('Read the change history for a Hijri year', 'The TD-8 audit trail, which **is** the history — it is append-only and already records both the previous and the new start date on every change, so a separate history table would duplicate it and could drift from it. The correction is the interesting event: this table reproduces the Ministry\'s official announcements, and a wrong start date silently mislabels every date in its month.', { '200': 'Audit entries, newest first.', '400': ENVELOPE, '401': ENVELOPE, '403': ENVELOPE }),
    },
    '/admin/branches/{id}/event-backfill': {
      get: op('List backfill candidates for a branch', '§4.4: the events a late-opening branch missed — those reaching some other branch but not this one. Listing is deliberately separate from attaching, because the gap must be neither silently auto-filled nor silently ignored: an Admin sees the candidates and chooses. **Paginated (TD-10):** `?page=` (default 1) and `?page_size=` (default 25, **max 100** — a larger request is capped, not refused). Responds `{ data, meta: { page, page_size, total } }`; `total` is the unpaginated count, so a client can compute page count. Ordering carries an `id` tiebreaker, which is what keeps paging stable across requests.', { '200': 'Candidate events.', '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for a branch out of scope.` }),
      post: op('Attach events to a branch', '§4.4 manual backfill. **Idempotent** — attaching an event the branch already carries is a no-op rather than an error, so a retried request cannot duplicate scope rows. Reports how many were newly attached.', { '200': 'Reports the number newly attached.', '400': ENVELOPE, '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an out-of-scope branch or unknown event.` }),
    },
    '/students/{id}/consents': {
      get: op('Read a student\'s effective consent state', 'BR-1: the effective status of each consent type is its **most recent** record, and **absence of any record is no consent** — never a default of granted. Admin or Super Admin (TD-2), scoped, with the TD-12 freshness assertion.', { '200': 'Effective state per consent type; null where no record exists.', '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for a student out of scope or nonexistent.` }),
      post: op('Record a consent decision declared in person', '§4.1a `staff_recorded` — the second capture method alongside the registration form. It is a first-class path, not a fallback: §2.2 records that many beneficiaries cannot complete a web form themselves. **Admin and Super Admin only (TD-2)** — a Teacher may view a student\'s data but may not declare a decision on a family\'s behalf. Writes a **new row, never an update** (§7 append/state-change only), so the history of what a family agreed to survives a later change. Fails closed when no `legal.consent_text_version` is configured (§2.3), because a decision that cannot be tied to a wording is not a record of consent. **Every change enqueues `consent.reevaluate` for each SESSION whose resolved audience contains the student, inside the same transaction** (§4.1a, TD-7, TD-4, Revision 43) — BR-2\'s subject is a session\'s audience, so the gate can never drift from the records.', { '201': 'Recorded; reports how many sessions were queued for re-evaluation.', '400': `${ENVELOPE} VALIDATION_FAILED.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness or TD-2 role).`, '404': `${ENVELOPE} NOT_FOUND for a student out of scope or nonexistent.`, '503': `${ENVELOPE} consent text version not configured (§2.3).` }),
    },
    '/students/{id}/social-profile': {
      get: op('Read a student\'s social profile', 'Minors\' case-file data — the most restricted surface in the system (§4.10, BR-16). Visible **only** to Super Admin, to Admin within branch scope, and to a Teacher for their **specifically-assigned** students, resolved server-side through the §4.4c course-staffing predicate (Revision 43). **Never** to students, **never** to guardians including the child\'s own linked parents, and never to teachers at large (TD-2 Revision 28). TD-12 names any StudentSocialProfile read as high-risk, so the caller\'s status and role are re-read from live rows on every request. **The read is audited** (`socialprofile.view`, TD-8 R28): viewing a safeguarding record is itself a security-sensitive act. Out of scope answers **404, never 403** (§20 rule 17) — a 403 would confirm that a particular child has a case file.', { '200': 'The profile; fields are null when no record exists yet.', '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN when the caller is no longer Active or holds none of the three roles (TD-12).`, '404': `${ENVELOPE} NOT_FOUND for a student out of scope OR nonexistent — deliberately indistinguishable.` }),
      put: op('Create or update a student\'s social profile', 'Same audience as the read (TD-2 Revision 28): Super Admin, Admin within branch scope, and a Teacher for their assigned students only. Upsert, because §7 makes the case file one record per student and staff should not have to know whether one exists. **Only the fields supplied are written**, so a partial update never blanks a colleague\'s entry by omission. **Audited** (`socialprofile.update`, TD-8 R28) recording **which fields changed, never their values** — §14 forbids PII in logs, and copying a child\'s health condition into the audit detail would move the very data BR-16 restricts into a table with a different access rule.', { '200': 'The stored profile.', '400': `${ENVELOPE} VALIDATION_FAILED against the §7 column limits.`, '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for a student out of scope or nonexistent.` }),
    },
    '/admin/users': {
      get: op('List, filter and search users', '§14.2 Users screen. Columns are exactly what §14.2 specifies — Arabic name, Nickname, Role(s), Branch scope, Status, Phone — and deliberately nothing from `StudentSocialProfile`, which §4.10 restricts to assigned teachers. Visibility is branch-scoped (§4.2 Revision 25): a branch-scoped Admin sees only users holding a live role assignment to one of that Admin\'s managed branches, and users with **no** branch assignment — parents, unassigned students, pre-provisioned accounts — are visible to **Super Admins only**. An all-branches (`NULL`) Admin sees everyone. The `branch_id` filter narrows within that scope and can never reach outside it. Filters: `role`, `branch_id`, `status` (§14.2). TD-10 search via `q` spans Arabic name, French name, nickname, phone, the linked parent\'s name, and Google email across **both** `UserIdentity.email` and `User.pre_provisioned_email` (Revision 15) — an unclaimed account has no identity row, and those are the accounts staff most need to find. Substring, case-insensitive, minimum 2 characters, matched against indexed normalized shadow columns; the query is normalized by the same rules as the stored value, with parity against the SQL functions asserted by test. Sorted by `name_arabic` (natively ar-x-icu collated, TD-6a) with `id` as the deterministic tiebreaker. Paginated: default 25, max 100.', { '200': 'Page of users in the TD-10 envelope.', '400': `${ENVELOPE} VALIDATION_FAILED on a bad filter or a query shorter than 2 characters.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness or TD-2 role).` }),
      post: op('Pre-provision an account against a Google email', 'Staff-assisted registration under Google-only auth (§3.1, §5.6 `/admin/users`, §4.1b step 4b). There is no password to issue, so staff record the person\'s details plus the Google address **authorized to claim** the account. **No `UserIdentity` is created** — §7 prohibits placeholder identity rows, because a half-populated identity would break the "has an identity implies has authenticated" predicate the whole §4.1b routing rests on. The binding happens on that address\'s first successful Google login (TD-4.10). The email is stored lowercase (TD-12) and is unique among non-null values via a TD-6 partial index spanning deleted users too, so an address can never be made claimable twice. Admin or Super Admin (TD-2) with the TD-12 freshness assertion; only a Super Admin may create another Admin. Accounts default to `Pending`; `pre_approved` yields `Active`, which §4.1b step 4b explicitly contemplates.', { '201': 'Account created and claimable; not yet bound to any identity.', '400': `${ENVELOPE} VALIDATION_FAILED on a missing name or malformed email.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness, TD-2 role, or an Admin attempting to create an Admin).`, '404': `${ENVELOPE} NOT_FOUND when the named branch scope does not exist.`, '409': `${ENVELOPE} DUPLICATE when that email may already claim an account.` }),
    },
    '/family-links': {
      post: op('Link an existing child to a parent (staff-mediated)', '§4.3 Revision 23: the MVP gives parents NO search over existing children — there is no parent-facing directory and TD-10 search belongs to the staff-only §14.2 screen — so this is an Admin/Super Admin operation (TD-2) with the TD-12 freshness assertion. Both parties are identified from §14.2, where staff are already authorized to browse users, which is why accepting ids here raises no enumeration concern. The link is created `Pending` even though staff created it (§4.3 retains that rule without exception) and is decided in the §5.6 approval queue. Parent self-service remains registering a NEW child through §4.1b. Body: `{ parent_id, student_id }`.', { '201': 'Pending link created; awaits an approval decision.', '400': `${ENVELOPE} VALIDATION_FAILED for a bad id pair, or a user named as their own parent.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness or TD-2 role).`, '404': `${ENVELOPE} NOT_FOUND when either party does not exist or is soft-deleted.`, '409': `${ENVELOPE} DUPLICATE when a live link already exists — never FAMILY_LINK_PENDING, whose TD-3.8 definition is restricted to own-resource contexts.` }),
    },
    '/admin/family-links/{id}': {
      delete: op('Revoke an approved family link', 'Admin or Super Admin (TD-2), asserted against live rows per request. §4.3 Revision 16: soft-deleting the row IS the revocation mechanism — TD-1 keeps `Approved` terminal and no `Approved → Revoked` transition exists, because enforcement is already complete: the `X-Active-Child-ID` middleware re-checks the link on every request, so revocation takes effect on the very NEXT request. Follows the ordinary TD-4.8 soft-delete transaction (`deleted_at`/`deleted_by` + Trash snapshot + `familylink.revoke` audit carrying both parties and the reason). A reason of 1–500 characters is required (TD-9). The TD-6 partial unique index covers non-deleted rows only, so the same pair can be requested again later as a fresh Pending link.', { '200': 'Revoked; the parent loses access to that child immediately.', '400': `${ENVELOPE} VALIDATION_FAILED when the reason is missing or too long.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness or TD-2 role).`, '404': `${ENVELOPE} NOT_FOUND for an unknown or already-revoked link.`, '409': `${ENVELOPE} STATE_CONFLICT when the link is not Approved — pending and rejected links are decided through the approval queue.` }),
    },
    '/admin/branches': {
      get: op('List branches', '**Read access is retained for Admins** (branch-scoped) because operational work depends on it — a Group references a Branch, a Level and a Room (TD-2 Revision 26). Ordered by display_order ASC NULLS LAST then name (ar-x-icu collated, §2.2/TD-10). Super Admins see all. **Paginated (TD-10):** `?page=` (default 1) and `?page_size=` (default 25, **max 100** — a larger request is capped, not refused). Responds `{ data, meta: { page, page_size, total } }`; `total` is the unpaginated count, so a client can compute page count. Ordering carries an `id` tiebreaker, which is what keeps paging stable across requests. **Explicit contract DTO (§16.2, Revision 38):** every branch response — here, `POST` and `PATCH` alike — returns exactly `id`, `name`, `operational_start_date`, `display_order`, `address`, `phone`, `email`, `opening_hours_ar`, `google_maps_url` and `version`, in `snake_case`, built by an allow-list projection. `operational_start_date` is a **TD-11 calendar date (`YYYY-MM-DD`)**, never an instant — an instant invites a timezone conversion in a client. `created_at`, `updated_at`, `deleted_at` and `deleted_by` are **not** exposed: they are operational metadata no screen consumes. Until Revision 38 this endpoint returned the Prisma row itself, which is how a `camelCase` shape and four internal columns came to sit inside a `snake_case` envelope; a column added to `Branch` now joins the model and not this response.', { '200': 'Branch list.', '401': ENVELOPE, '403': ENVELOPE }),
      post: op('Create a branch', '**Super Admin only** — Branches are reference/configuration data (TD-2 Revision 26). This also removes an incoherence: branch creation cannot be scope-checked, since no branch exists yet to check against, so an Admin previously created a branch they could not then see. Returns the same branch DTO as `GET` (§16.2, Revision 38).', { '201': 'Created.', '400': ENVELOPE, '403': ENVELOPE }),
    },
    '/admin/branches/{id}': {
      patch: op('Update a branch', '**Super Admin only** (reference data, TD-2 Revision 26); `operational_start_date` and `display_order` included, since activating a branch is an organisational decision. Optimistic locking on `version` (TD-15): a stale version returns 409 VERSION_CONFLICT rather than overwriting silently. Returns the same branch DTO as `GET`, carrying the **incremented** `version` for the client to send on the next edit (§16.2, Revision 38).', { '200': 'Updated.', '404': ENVELOPE, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
      delete: op('Soft-delete a branch', '**Super Admin only** (reference data, TD-2 Revision 26). Prohibited while Rooms or Groups reference it (TD-5) — 409 STATE_CONFLICT. Writes a Trash snapshot and an audit row (TD-4.8).', { '204': 'Deleted.', '404': ENVELOPE, '409': `${ENVELOPE} STATE_CONFLICT when referenced.` }),
    },
    '/admin/branches/{id}/rooms': {
      get: op('List a branch\'s rooms', '**Read access retained for Admins**, scoped to branches they administer (TD-2 Revision 26) — an Admin must be able to pick a Room even though only a Super Admin may create one. Out-of-scope answers 404 (§20 rule 17). **Paginated (TD-10):** `?page=` (default 1) and `?page_size=` (default 25, **max 100** — a larger request is capped, not refused). Responds `{ data, meta: { page, page_size, total } }`; `total` is the unpaginated count, so a client can compute page count. Ordering carries an `id` tiebreaker, which is what keeps paging stable across requests. **Explicit contract DTO (§16.2, Revision 38):** a room is exactly `id`, `name`, `branch_id` and `version`, in `snake_case`, by allow-list projection — the same shape from `GET`, `POST` and `PATCH`.', { '200': 'Room list.', '404': ENVELOPE }),
      post: op('Create a room', '**Super Admin only** — Rooms are reference/configuration data (TD-2 Revision 26). Recorded as the most likely future exception, being per-branch and higher-churn than the rest of the set.', { '201': 'Created.', '400': ENVELOPE, '404': ENVELOPE }),
    },
    '/admin/rooms/{id}': {
      patch: op('Update a room', '**Super Admin only** (reference data, TD-2 Revision 26). Optimistic locking on `version` (TD-15).', { '200': 'Updated.', '404': ENVELOPE, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
      delete: op('Soft-delete a room', '**Super Admin only** (reference data, TD-2 Revision 26). Prohibited while Groups reference it (TD-5).', { '204': 'Deleted.', '404': ENVELOPE, '409': `${ENVELOPE} STATE_CONFLICT when referenced.` }),
    },
    '/admin/administrative-groups': {
      get: op('List administrative groups', 'TD-3.12 (Revision 43) — the permanent **organisational** unit inside a Level (§4.4c). **Operational data**: Admin within branch scope, or Super Admin, asserted in the service (TD-2) — the `/admin/` prefix authenticates but does not authorise. A branch-scoped Admin sees only the groups of the branches they administer; an all-branches (`NULL`) scope means *every* branch, never *none*. `?level_id=` and `?branch_id=` narrow within that scope and can never reach outside it; a **malformed** id is `400`, not an empty list, because "that is not an id" and "this Level has no groups" are different answers and the second one misleads. Ordered by `display_order` then `name` — natively `ar-x-icu` collated (TD-6a), so correct Arabic ordering needs no per-query COLLATE (§20 rule 13). **Paginated (TD-10):** `?page=` (default 1), `?page_size=` (default 25, max 100 — capped, not refused). **Explicit contract DTO (§16.2):** exactly `id`, `name`, `level_id`, `branch_id`, `display_order` and `version`. **`branch_id` is load-bearing** (§4.4c): it is the single answer to *"which branch is this person at"*, which `User.intended_branch_id` deliberately does not give — that records only what an applicant asked for (§4.1, R39). Absent by design and never to be re-added (§20 rule 22): `room_id`, `teacher_id`, `assistant_id`, the weekly schedule, and **`max_students`** — there is no capacity anywhere in the model, informational or otherwise (BR-23), and `CAPACITY_FULL` is retired from the TD-3.8 catalogue.', { '200': 'Group page in the TD-10 envelope.', '400': `${ENVELOPE} VALIDATION_FAILED — a malformed level_id or branch_id filter.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN for a caller holding neither admin nor super_admin.` }),
      post: op('Create an administrative group', 'TD-3.12 (Revision 43). Body: `{ level_id, branch_id, name, display_order? }` — **strictly** those keys, so a client sending `max_students`, `room_id` or a schedule is **refused** rather than having them silently dropped: a `201` after sending a capacity would reasonably be read as a limit having been recorded, and BR-23 says none exists to record. Admin within branch scope, or Super Admin; an out-of-scope `branch_id` answers `404`, never `403` (§20 rule 17), which would confirm that a branch exists where the caller may not look. The Level and the Branch are both re-checked **live and non-soft-deleted inside the transaction** — a foreign key alone would accept a closed premises. This is the route for **additional** groups: a Level always already has one, created atomically with it (TD-4.6b, Revision 43.1), or backfilled at the first Branch (TD-4.6d), so a Level is never grouplessness-by-omission.', { '201': 'Created.', '400': `${ENVELOPE} VALIDATION_FAILED — a missing name, a negative display_order, or an unknown key.`, '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an unknown Level, or a Branch outside the caller's scope (§20 rule 17).` }),
    },
    '/admin/administrative-groups/{id}': {
      patch: op('Rename or reorder an administrative group', 'TD-3.12 (Revision 43). **Only `name` and `display_order` are editable**, and `level_id`/`branch_id` are **rejected** rather than ignored. Moving a group to another Level would invalidate every `Enrollment.level_id` that points at it — the composite FK would refuse the write, but as an opaque constraint error rather than an explained refusal — and moving it to another Branch would change where its students are recorded as attending without anyone deciding that per student. Both are re-creations, not edits. **TD-15 optimistic locking:** send the `version` you loaded; a stale one is `409 VERSION_CONFLICT`, never a silent overwrite of a colleague\'s edit. Returns the same DTO as `GET`, carrying the incremented `version`.', { '200': 'Updated.', '400': `${ENVELOPE} VALIDATION_FAILED — a missing version, or an attempt to move the group between Levels or Branches.`, '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an unknown group or one outside the caller's branch scope.`, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
      delete: op('Soft-delete an administrative group', 'TD-3.12 (Revision 43), TD-5 soft delete with a Trash snapshot and an audit row (TD-4.8). **Three refusals, each `409 STATE_CONFLICT` with a `reason` in `details`:** `ENROLMENTS_EXIST` while any student is still enrolled; `SCHEDULES_EXIST` while a Recurring Course Schedule targets it, so a group can never vanish from under a timetable; and **`LAST_GROUP_IN_LEVEL`**, because §4.4b requires a Level to keep at least one group — the state TD-4.6b prevents at creation is otherwise reachable by deletion, which is the same broken state arrived at from the other side.', { '204': 'Deleted.', '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an unknown group or one outside the caller's branch scope.`, '409': `${ENVELOPE} STATE_CONFLICT with reason ENROLMENTS_EXIST, SCHEDULES_EXIST or LAST_GROUP_IN_LEVEL.` }),
    },
    '/admin/administrative-groups/{id}/roster': {
      get: op('Read a group roster', 'TD-3.12, §5.6 enrollment screen. Admin within branch scope, or Super Admin; a group outside scope answers `404`, never `403` (§20 rule 17). Soft-deleted students are excluded. Ordered by the natively `ar-x-icu` collated name (BR-19, §20 rule 13). **Paginated (TD-10).** Each entry is exactly `id`, `student_id`, `name`, `enrolled_at` — `id` is the **enrolment** id, which is what identifies the row, while `DELETE` addresses the student. `name` is the staff-facing legal name, as in the approval queue: the §7 public display-identity rule governs **public** surfaces, and a roster is not one. `enrolled_at` is an **instant**, correctly — an enrolment happens at a moment rather than on a calendar date.', { '200': 'Roster page in the TD-10 envelope.', '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an unknown group or one outside the caller's branch scope.` }),
      post: op('Enrol a student into the group', 'TD-3.12, §5.6. Body: `{ student_id }` — **strictly** that one key. **`level_id` is not accepted**: the service reads it from the group, because taking it from the caller would leave the composite FK as the only thing between a typo and a mis-filed student, surfacing as an opaque constraint error rather than a decision this service made. The response echoes `level_id` so the client learns which Level the student was thereby enrolled into. **`Level.gender_restriction` is enforced** (Revision 27) and a `null` `sex` is *not eligible* rather than a wildcard. **BR-21 — one group per Level — is refused with an explanation, not a raw constraint error:** enrolling into the same group again is `409 DUPLICATE`, and enrolling into a *different* group of a Level the student already belongs to is `409 STATE_CONFLICT` with `reason: ALREADY_ENROLLED_IN_LEVEL` naming `current_administrative_group_id`, which is exactly the information needed to decide whether to move them instead. **There is NO capacity check** (BR-23): none exists, `CAPACITY_FULL` is retired from the TD-3.8 catalogue, and the roster row lock went with the invariant it protected — a future capacity rule must bring the lock back rather than rely on a constraint alone. **Enqueues `consent.reevaluate` for each SESSION whose resolved audience now contains the student, in the same transaction** (§4.1a, TD-7, Revision 43): BR-2\'s subject is a session\'s audience, so the gate can never drift from the records.', { '201': 'Enrolled; returns the enrolment including the Level it resolved to.', '400': `${ENVELOPE} VALIDATION_FAILED — a missing or malformed student_id, an unknown key, or a sex ineligible for the Level's restriction.`, '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an unknown student, or a group unknown or outside scope.`, '409': `${ENVELOPE} DUPLICATE in this group; STATE_CONFLICT with reason ALREADY_ENROLLED_IN_LEVEL for another group of the same Level.` }),
    },
    '/admin/administrative-groups/{id}/roster/{studentId}': {
      delete: op('Un-enrol a student', 'TD-3.12, TD-5 — a soft delete of **the enrolment row only**. **Grades, exam submissions and Quran logs are never touched:** they are the historical academic record and survive a student leaving, so a re-enrolled or transferred student rejoins a Level that still knows what they did. **Their Teaching Group seats for that Level ARE removed** (Revision 43) — a place in a subject split inside a Level the student has left is a roster entry for a class they no longer attend. Enqueues consent re-evaluation on the same transaction, since the student\'s session audience has changed.', { '204': 'Un-enrolled.', '401': ENVELOPE, '403': ENVELOPE, '404': `${ENVELOPE} NOT_FOUND for an unknown group, one outside scope, or a student not enrolled in it.` }),
    },
    '/healthz': {
      // TD-14 serves this at the ORIGIN root, outside the /api/v1 prefix, so the
      // document must override the global server base. Without this the contract
      // advertises /api/v1/healthz, which falls inside the guarded router and
      // answers 401 — a consumer following the document would call the wrong URL
      // and conclude the service was unhealthy.
      servers: [{ url: '/', description: 'Served at the origin root (TD-14)' }],
      get: op(
        'Health check',
        'Public. Checks database, storage and job-queue components (TD-14); §19.1 step 8 ' +
          'asserts a 200 here on deployment.',
        { '200': 'All components healthy.', '503': 'At least one component is down.' },
      ),
    },
  },
};

// ── Reconcile against the routes the application ACTUALLY serves ────────────
//
// The path map above is hand-written, so on its own it proves nothing: a route
// documented here and in the TD-3 registry, but never mounted on the router,
// passed every gate while returning 404 to real callers. That happened, and only
// an HTTP-level test caught it — the drift check compares this file's output to
// the committed copy, and the §3.1 conformance check compares that output to the
// registry, so neither ever consults the router.
//
// Walking the real Express stack here is what makes "generated from the
// implementation" true rather than aspirational. `createApp` takes its config and
// client as parameters, so this needs no environment and no database connection —
// constructing a PrismaClient does not connect.
function mountedOperations(): Set<string> {
  const app = createApp(createPrismaClient(SYNTHETIC_CONFIG.DATABASE_URL), SYNTHETIC_CONFIG);

  const found = new Set<string>();
  const walk = (stack: unknown[], prefix: string): void => {
    for (const entry of stack) {
      const layer = entry as {
        route?: { path?: string; methods?: Record<string, boolean> };
        name?: string;
        handle?: { stack?: unknown[] };
        path?: string;
      };

      if (layer.route?.path) {
        // Express 5 normalizes `:id` params; the contract uses `{id}`.
        const path = `${prefix}${layer.route.path}`.replace(/:([A-Za-z_]\w*)/g, '{$1}');
        for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
          if (enabled && method !== '_all') found.add(`${method.toUpperCase()} ${path}`);
        }
      } else if (layer.handle?.stack) {
        // A nested router. Express 5 does not expose the mount path reliably on
        // the layer, so recurse with the same prefix: every nested router in this
        // application is mounted at the API prefix, which the comparison strips
        // anyway.
        walk(layer.handle.stack, prefix);
      }
    }
  };

  const root = (app as unknown as { router?: { stack?: unknown[] } }).router;
  walk(root?.stack ?? [], '');
  return found;
}

const documented = new Set<string>();
for (const [path, item] of Object.entries(document.paths)) {
  for (const method of Object.keys(item)) {
    if (method === 'servers') continue;
    documented.add(`${method.toUpperCase()} ${path}`);
  }
}

const mounted = mountedOperations();
const undocumented = [...mounted].filter((op) => !documented.has(op)).sort();
const unserved = [...documented].filter((op) => !mounted.has(op)).sort();

if (undocumented.length > 0 || unserved.length > 0) {
  if (unserved.length > 0) {
    process.stderr.write(
      `DOCUMENTED BUT NOT SERVED (the contract would advertise a 404):\n  ${unserved.join('\n  ')}\n`,
    );
  }
  if (undocumented.length > 0) {
    process.stderr.write(
      `SERVED BUT NOT DOCUMENTED (§3.1 forbids undocumented endpoints):\n  ${undocumented.join('\n  ')}\n`,
    );
  }
  process.stderr.write(
    'The OpenAPI path map and the Express router disagree. Fix whichever is wrong —\n' +
      'do not "resolve" this by editing docs/openapi.json (§3.1).\n',
  );
  process.exit(1);
}

const target = new URL('../../docs/openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
process.stdout.write(
  `openapi.json written: ${Object.keys(document.paths).length} paths, ` +
    `${documented.size} operations, all reconciled against the live router\n`,
);
