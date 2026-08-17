[Documentation](../README.md) › [Architecture](README.md) › **Frontend**

# Frontend

React 19 + Vite 8, TypeScript strict, **no runtime dependencies beyond React itself.**

> **Status:** a public shell. The landing page, login, OAuth error states, account status
> screens, the public branch directory, and the **full dual calendar** are built. **There are
> no authenticated screens yet** — the M1–M3 endpoints have no interface driving them. This
> page describes what exists and the patterns the rest will follow.

## Dependency posture

```json
"dependencies": { "react": "19.2.8", "react-dom": "19.2.8" }
```

That is the whole list. No router, no state library, no component library, no CSS framework,
no date library, no HTTP client.

This is not minimalism for its own sake — it follows from the version policy. During active
development, **patch updates are permitted; new frameworks and components are not**, without
Document Owner approval. Every dependency is therefore a decision with a stated reason,
taken deliberately rather than reached for.

Two consequences visible in the code:

- **Routing is a path switch**, not a router. The sitemap is a short fixed list, and a
  router joins the stack when nested authenticated layouts arrive — as an approved
  dependency, not a drive-by addition. The *decision* lives in `lib/route.ts` as a pure
  function; `main.tsx` only maps a decision to a component ([why](#the-router-must-never-return-nothing)).
- **The dialog is built on native `<dialog>`.** `showModal()` gives a focus trap, Escape
  handling, page inertness, and top-layer stacking for free — all the things a modal library
  is usually imported for.

## Structure

```
src/
  main.tsx           entry — providers, the path switch
  pages/             one per sitemap node
  components/
    ui/              primitives: button, card, container, dialog, icon, logo
    header/          the application header and its parts
    calendar/        the calendar's atomic components
    …                feature components
  adapters/          API payload → view model
  contexts/          session, active child
  hooks/             navigation, data
  lib/               api client, dates
  i18n/              the ar catalog and the lookup helpers
  styles/            tokens/ · base/ · components/
```

### The adapter layer

`adapters/` is the seam between the API's shape and the components' needs. It exists so a
contract change lands in one file rather than across every component that reads a field.

#### The unchecked cast under this whole layer

`api<T>()` takes a type parameter and **nothing verifies it at runtime.** The generic
*asserts* a shape; it does not parse one. An adapter type that names a field the API has
never sent therefore:

- **compiles perfectly** — TypeScript believes the assertion;
- **passes every frontend test** that builds its own fixtures from that same wrong type;
- **is invisible to `curl`** — the server's bytes were always correct;
- and fails **only in a browser**, as `undefined` where an object was expected.

That is not hypothetical. `adapters/hijri-calendar.ts` declared `hijri_year` / `months` /
`hijri_month_ar` against a real `year` / `data` / `month_name_ar`. The page did
`data?.months.filter(…)`; the `?.` guarded `data` being null but not `months` being
`undefined`, `.filter()` threw, React unmounted the tree, and `/superadmin/hijri-calendar`
rendered **blank white** with no error anywhere.

**The two guards, and why one alone is not enough:**

| Side | Guard | What it catches |
|---|---|---|
| **Server** | An HTTP test asserting the **exact key set** of the response — `expect(Object.keys(body).sort()).toEqual([…])` | The API drifting away from the contract. `toMatchObject` cannot do this: it checks a subset and is **blind to a field that is missing** |
| **Client** | A fixture literal typed as the adapter's own interface, written with the key set the server test pins | The adapter's *type* drifting away from the contract — renaming a field breaks the **typecheck**, which is the check the cast cannot perform |

`pages/admin/hijri-calendar.test.tsx` is the worked example of the client half. Both halves
are cheap; neither substitutes for the other, because they fail on opposite drifts.

A corollary worth stating: **do not declare one type for a read response and a write response
that differ.** The Hijri write returns `hijri_year` and omits `month_name_ar`, so it has its
own `HijriMonthRecorded`. Sharing one type across two shapes is what let the mismatch hide.

#### Mock adapters: building a screen before its endpoint exists

A screen may be built against a **mock adapter** when its endpoints are not yet specified —
that is what lets the interface, the states and the layout be finished and reviewed while the
contract is still being decided, instead of the two waiting on each other.

The convention that makes it safe:

| Rule | Why |
|---|---|
| **The interface is production; only the implementation is mock** | Types are written as the API response they expect to parse, in `snake_case`. Swapping in real `api()` calls is a change to the adapter's exported functions and to nothing else |
| **No component, page or test may touch the mock directly** | If they did, replacing it would mean touching all of them — which is the entire cost the seam exists to avoid |
| **The file states, at the top, that it is temporary and why** | Including which endpoints are missing and what authorises them |
| **Mock data is chosen to exercise the layout**, not to look plausible | One item of each kind, one empty group, one group with many — the states you need to see |
| **Never document mock behaviour as production behaviour** | The handbook describes the interface and the states; the numbers live only in the mock file |

`adapters/content.ts` is the worked example: the educational library is complete and
reviewable, and **no content endpoint exists** — see
[the gap analysis](../reference/api-endpoints.md#specified-not-yet-built).

A mock adapter is **not** licence to invent a contract. It is a placeholder behind a seam,
and the endpoints it anticipates still require a Document Owner revision before they are
built (§20 rule 16).

It carries one rule with security weight: **the frontend type for a calendar occurrence does
not carry the raw name fields at all.** The backend resolves which name is public and sends
`display_name`; the adapter's type has no other option to choose from.

That is structural enforcement rather than a rule to remember — a client that cannot see the
inputs cannot implement the fallback it is forbidden from implementing.

> [Security](security.md#on-public-surfaces) · §20 rule 21

### One API caller

Every request goes through `lib/api.ts`, so the two transport rules live in one place rather
than at each call site:

- the access token travels **only** in the `Authorization` header;
- the active child travels **only** in `X-Active-Child-ID`, per request.

**The client never puts a student id in a body or query string for authorization** — the
server would ignore it anyway.

The error class deliberately carries only the status. The response body is **not** parsed
there, because only the screen rendering an error knows which of its fields it needs.

## Validation errors name the field

The backend has always sent `details.issues` with an exact `path` per failure —
`applicant.first_name_arabic`, `child.last_name_french`, `branch_id`. The
registration form threw all of it away and rendered one sentence, so a rejected
submission said *"review the fields"* without saying which, and an applicant had
to guess.

`mapServerIssues` now translates each `path` onto the form's own field keys and
marks the control. Three details are deliberate:

- **The `path` is used, not the message text.** Zod's message is English prose
  written for a developer (*"Invalid input: expected string, received
  undefined"*); showing it to an Arabic-speaking applicant would be worse than
  showing nothing. A known path becomes our own Arabic message on the right
  field.
- **The server's `parent` maps onto the form's `applicant`** — the same person
  under two names. Without the translation the error would be computed and
  attached to nothing.
- **An issue the form cannot place is surfaced verbatim, never dropped.** An
  `Unrecognized key` is precisely the signal that a stale client is talking to a
  newer server, which is the failure that produced this section.

## Mandatory UI states

Every page and every data-bearing component implements all of:

| State | Requirement |
|---|---|
| **Loading** | A skeleton for tables, not a spinner alone |
| **Empty** | Friendly, Arabic-first, with the relevant create action if permitted |
| **Error** | The message key rendered, the request id shown discreetly, a retry button |
| **No permission** | A proper state — never a blank page, never a crash |
| **No results** | **Distinct from empty** — "nothing matches your filters", with a clear-filters action |
| **Offline / retry** | Failed fetches offer a retry; failed uploads restart cleanly |

> *Forgetting empty states is the most common agent failure mode* — the specification says so
> outright, and end-to-end tests assert them.

The distinction between **Empty** and **No results** is the one most often collapsed, and it
matters: "you have no groups yet" and "no groups match this filter" call for different
actions from the user.

### Two specific states

**A Pending user is intercepted before any authenticated route renders.** A global guard
hard-redirects to the approval-status screen, so a Pending user never sees an empty skeleton
or a sidebar. This is a **UX layer only** — the server-side denial is the security boundary,
and both are tested independently.

**An Active account holding no role** renders the no-permission state. It is reachable only
through staff error, and it must never be a blank page, a crash, or a dashboard.

## Navigation

The sitemap is **authoritative**: no invented sections, no reshuffling. Items render only
for roles the permission matrix allows, and the sidebar is RTL-first.

Two clarifications that have caused real bugs:

**Status interstitials are redirect targets, not navigation nodes.** The approval-status and
"account deactivated" screens appear in no menu, which is why they are absent from the
sitemap tree. Their absence is **not** licence to omit them — building them is not an
invented section.

**No "log out everywhere" node exists, and none may be added.** The revoke-all capability is
internal, used by suspension and deletion.

### The sidebar answers *how do I get there*; the breadcrumb answers *where am I*

The sitemap is a **flat list per section**, and a flat list cannot express that a
Subject's circles live inside one Level's subjects, which live inside a Level.
Revision 69 gave `مواد المستوى` and `حلقات المواد` a node each — that made them
reachable, and left the hierarchy invisible. `PortalShell` therefore takes an
optional `breadcrumb`, rendered above the heading by
[`components/portal/breadcrumb.tsx`](../../frontend/src/components/portal/breadcrumb.tsx):

```
المستويات  ›  مواد مستوى «الثاني»  ›  حلقات مادة «الفقه»
```

Three rules make it safe to add anywhere:

**The trail is passed in, never derived from the URL.** Deriving it would mean
inventing an ancestor for any path that has none — which is how a breadcrumb
grows a landing page that SRS §14.1 does not list (§20 rule 16). The page knows
its own ids; ancestors are linked with the `?level=` deep link R69.3 defines, so
every crumb points at a node that already exists.

**A trail shorter than two items renders nothing.** `مواد المستوى` before a
Level is chosen is not *inside* anything, and a one-item breadcrumb naming only
the current screen is decoration.

**It renders only for a session permitted to open the module.** A crumb names a
Level, and the no-permission state must not disclose one.

### A deploy that never reaches the browser

`index.html` was served with **no `Cache-Control` header at all**. Browsers then
apply *heuristic* caching, so a returning visitor kept executing the previous
bundle — and because Vite emits content-hashed filenames, the stale shell also
pointed at the stale JS, which the browser likewise held. **The entire old
application ran from cache, with no error anywhere.**

It produced a genuinely confusing failure: a registration form rendering last
week's fields, posting last week's payload, refused by a server that had
correctly moved on. Both halves looked like application bugs and neither was —
the shipped code was right and simply was not running.

The pairing that fixes it:

| Path | `Cache-Control` | Why |
|---|---|---|
| `index.html`, and every SPA route | `no-cache` | *Revalidate before reuse* — not "do not store". The ETag makes it a `304` in the common case, so the cost is one conditional request and the guarantee is that a deploy takes effect immediately |
| `/assets/*` | `public, max-age=31536000, immutable` | The filename changes whenever the bytes do, so the response never needs revalidating |

**The rule: a content-hashed asset may be cached forever; the document that
names it may not be cached at all.** Getting that backwards is indistinguishable
from a code bug, because the code is correct — it simply is not the code that is
running.

### The router must never return nothing

`/dashboard` rendered a **blank white page**, and it was reachable in one click by every
signed-in user.

Two mistakes met:

1. **The header's Dashboard button linked to `/dashboard`** — a path §14.1 does not define.
   The sitemap lists *role-specific homes*: `/dashboard/student`, `/teacher`, `/admin`
   (R62 removed `/dashboard/parent` with the Family Dashboard — a parent's home is their
   child's dashboard). §4.1b step 4a calls the post-login landing a "role-based dashboard
   redirect" for the same reason: which home you get depends on who you are.
2. **The path switch's `default` branch returned `null`.** React renders nothing, and the
   browser shows an empty document — which §14.4 forbids outright ("never a blank page,
   never a crash"). Any typo'd URL did the same; the button just guaranteed someone found it.

A third, quieter problem sat behind them: `AdminRouter`'s `AdminNotFound` was **unreachable**.
`main.tsx` only reaches it when `isAdminPath(path)` is true, and `isAdminPath` *is*
`moduleForPath(path) !== null` — so the null check inside could never fire. The application
had a not-found page that no path could reach, and no not-found page for the paths that
needed one.

**The fix makes the invariant checkable rather than trusting a switch statement.** The routing
decision is now `resolveRoute(path)` in `lib/route.ts`, a pure function returning a closed
`Route` union, and the test asserts every path — including `/dashboard`, `/nonsense`,
`/admin-not-really` and `''` — resolves to *something*. Reintroducing the `null` fallback fails
six tests.

Two states, deliberately distinct:

| | Means | Rendered as |
|---|---|---|
| `not-found` | §14.1 does not define this path | `NotFound`, with a way home |
| `screen-pending` | §14.1 *does* define it; no milestone has built it | `ScreenPending`, naming why |

Collapsing them would tell a teacher their home is *gone* when it is merely unbuilt — the same
distinction the back office already draws with `ModulePending`.

`roleHomePath(roles)` resolves the button's target, most-privileged role first, and returns
`null` for an account with no role so the button is **hidden** rather than pointing nowhere
(§14.4 Revision 16 puts that account on the no-permission state).

### A cascade bug worth remembering

The header's burger menu was declared *after* the media query that hides it, at equal
specificity — so it stayed visible at every width. A CI guard
(`check-header-nav-exclusive.sh`) now asserts that the burger and the horizontal navigation
are mutually exclusive, and it was **proven by reintroducing the bug**.

A second: the dashboard link was removed from the navigation because it is an *account
control*, not a site section — and it duplicated a destination already reachable. The fix
included extracting navigation building into a **pure function** so it could be tested
directly, and server-rendering the header in both states to verify the output rather than
assert the intent.

## Shared components

The registry is build-once-reuse, and duplicating one per page is prohibited:

`StudentSelector` · `GroupSelector` / `LevelSelector` / `BranchSelector` ·
`PaginatedTable` · `DualDateDisplay` · `VisibilityBadge` / `VisibilitySelect` ·
`ConsentStatusBadge` · `FileUploader` · `ChildContextSwitcher` *(R62.9 — no longer a header dropdown of its own; it is the `ولي الأمر` GROUP inside the one account switcher, because selecting a child sets the active role and the active child in a single action)* · `ApprovalCard` ·
`ConfirmDialog` · `EmptyState` / `ErrorState` / `NoPermissionState` · `JobStatusIndicator`

`DualDateDisplay` carries a rule from the calendar design: it renders **the Gregorian date
alone** when the Hijri month has not been published. No placeholder, no computed guess.

`Dialog` takes a `wide` variant, for a dialog carrying a **list** rather than prose — the
default width is a reading measure, which is right for an event record and too narrow for a
day's timetable.

### The rules these components exist to keep

**The behavioural contract of each shared component — and the page-shape rules
they compose into — live in [Platform UX & atomic
design](../development/ux-architecture.md), not here.** That page is the one a
future UI change is interpreted against; this section stays a *register of what
exists*, because a component list and a set of rules drift apart the moment they
are maintained in one place.

The three additions of 2026-08-17 are worth naming in the register, since each
replaced something hand-rolled:

* **`SearchableSelect`** — one choice from a large set, **showing its options on
  open**. The gap it filled had been met by *typed-search workflows*: a picker
  returning nothing until two characters were entered, which offers nothing at all
  to a reader who does not already know the name.
* **`Button variant="add"`** — the `＋` convention, emitted by the variant so a
  caller never types it. It had lived in a *translation string* for exactly one
  screen.
* **`withCategoryNames`** — joins a Category name onto Levels carrying only
  `category_id`, so `levelLabel` can render `{Category} — {Level}` from the
  calendar bootstrap without a second label format.

And one deletion: **`.button` / `.button.primary` in `status-pages.css` was a
second complete button system**, across ten call sites on the registration, status
and profile pages — its own class name, its own padding, and none of `ghost`,
`danger` or `add`. Every one of them now renders `ButtonLink`.

## The calendar page, as a worked example

The most complete screen in the client, and the one whose decisions generalise furthest.

Decomposed into atomic components — title, navigation, filter toolbar, three filter selects,
grid, day cell, event chip, day dialog, details dialog — each with a single responsibility.

### The page reads top to bottom as a sequence of questions

```
            الجدول الزمني            ← eyebrow: what page is this
        يوليوز 2026 │ محرم 1448      ← the headline: WHICH MONTH
     السابق      اليوم      التالي    ← how do I move
      [branch]  [category]  [level]  ← what am I filtering
   ┌───────────────────────────────┐
   │            the grid           │
```

*Where am I → how do I move → what am I looking at → the thing itself.* Each step gets its
own centred block and generous vertical rhythm, so they read as four steps rather than one
dense control bar.

**The `<h1>` is an eyebrow, not the headline.** A visitor came to read *which month*, so the
dual title takes the visual weight and the page label recedes — while remaining a real
heading, because the page still needs one.

### Navigation: three buttons, and no month label

`السابق · اليوم · التالي`. The month name appears **once**, in the title.

The previous control was a month selector that carried *its own copy* of the Gregorian month
beside the title's — two renderings of one fact, which is the duplication this project removes
rather than syncs. A test asserts the nav contains **no** month name at all.

**`اليوم` is the primary variant; the other two are secondary.** It is the action most often
wanted and the only one not reversible by pressing its opposite, so it earns the single
emphasis. It changes the month and deliberately does **not** open the day dialog — pressing a
navigation button should move the view, not launch a modal over it.

**Short labels, long accessible names.** Visible text is `السابق`; the accessible name is
`الشهر السابق`, because "previous" alone is ambiguous when announced out of context. The long
name **contains** the short one, which is what keeps voice control working (WCAG 2.5.3 *Label
in Name*) — a user saying "السابق" still matches. A test asserts the containment rather than
just the presence of both.

**Navigation preserves every filter**, because the filters are state independent of the month
and nothing in the handler touches them.

### Two requests, never a third

| Request | Returns | Cached |
|---|---|---|
| `GET /calendar/bootstrap` | The **chrome**: Hijri days, month metadata, categories, levels, branches | 5 min + ETag |
| `GET /calendar` | The **occurrences**, each self-sufficient | No |

Opening a day or an event costs **nothing further**. That is what
[occurrence self-sufficiency](calendar-and-hijri.md#the-calendar-screens-two-requests) buys,
and it is why the details dialog needs no loading state.

### The client computes no dates

The dual title renders `gregorian_months` and `hijri.months` **as the backend assembled
them**: one entry renders one name, two render both joined by a slash. A Gregorian month
straddling two Hijri months therefore needs no special case in the client — which is the
whole point, because computing a Hijri date in a client is prohibited outright (§20 rule 14).

Per-cell Hijri numbers come from `hijri.days`, keyed once into a map for O(1) lookup.

### Absence is rendered as absence

The rule appears three times on this screen, and it is the same rule each time:

- A day whose Hijri month is **not recorded** shows **no Hijri number** — not a dash, not a
  computed guess. An empty slot is reserved so the Gregorian number does not shift.
- When **no** month in view is recorded, the title's Hijri side **and its divider** are
  omitted entirely rather than rendered blank.
- A field the backend did not send is **absent** from the details dialog. An empty row claims
  the value *is* blank, which is a different statement from *"not recorded"*.

### The two title sides fail differently, on purpose

The **Hijri side has no fallback** — that is the rule above.

The **Gregorian side falls back** to the month the page is already displaying. The asymmetry
is deliberate: the month on screen is *client state*, so a failed reference fetch must not
cost the page its own heading, and a Gregorian month name is not a Hijri computation. It reads
from the same i18n list the dialogs use, so the names still have one source.

Removing the month selector made this necessary. Previously the label came from client state
via that control and always rendered; with the title as the only label, an unqualified
"render what the backend sent" would have left the page headless whenever the chrome request
failed.

### An accessibility regression the removal nearly caused

The month selector held the `aria-live="polite"` region that announced month changes. Deleting
it would have made navigation **silent** for keyboard and screen-reader users — the grid
redraws with no spoken feedback.

`aria-live` now sits on the **title**, which is the element that names the month. A test
asserts it, because this is precisely the kind of behaviour that disappears in a refactor and
nobody notices until someone who relies on it does.

### Two dialogs, and why

**Clicking a day** opens the full day programme; **clicking an event** opens its record. Both
are dialogs rather than panels, decided on the page's shape: the grid now claims nearly the
full viewport width and most of its height, so anything below it opens off-screen and turns
every click into a scroll.

The day dialog **replaced a panel** that used to sit beneath the grid. Removing it is what
let the cells grow to hold a real day's programme — the cell is the compact view, and the
dialog is the complete one, which is what makes the cell's compactness affordable.

### Filters: the dependency is server-side

Branch, category, and level. **Selecting a category re-requests the bootstrap with
`category_id`**, and the server returns only that category's levels.

This is not a preference. §4.4 requires the narrowing to happen server-side *"so the client
never filters a list it was handed"*, and the level selector is built so that rule cannot be
broken: **it has no category prop at all.** There is nothing in it to filter with.

Changing category **resets the level**, in the page rather than in either select — the two
are one filter with a dependency, and the reset belongs where that relationship is visible.
Without it, a level from the previous category would silently filter the grid to nothing
while both selects looked perfectly reasonable.

### A defect worth remembering: the shared dialog id

A native `<dialog>` must be in the DOM to be openable, so a page with two of them keeps both
mounted permanently. The shared `Dialog` hardcoded `aria-labelledby="dialog-title"` — which
was harmless with one dialog and became **two elements with the same id** the moment the
calendar had two. A screen reader resolving the reference finds whichever comes first, so the
event dialog would have announced the *day* dialog's title.

Fixed with `useId`, which makes it structurally impossible rather than a rule to remember.
The lesson generalises: **a hardcoded id in a reusable component is a latent collision**, and
it stays invisible until the component is used twice on one page.

## The educational library, as a second worked example

`/resources` (§5.2, §4.9) — two views of a drilling folder system: a level index grouped by
category, and one level's contents grouped **academic year → branch**.

### Two views, one navigation node

§14.1's sitemap defines exactly **one** resources node, and §5.2 describes it as a *drilling
folder system* with a "Level List" and a "Level Resources View". Those two views are therefore
one route with a **`?level=` parameter**, not a second path segment.

The reasoning is worth reusing: **a new path segment would be a navigation node the sitemap
does not list**, and inventing navigation outside §14.1 is prohibited (§20 rule 16). A query
parameter keeps the view shareable and bookmarkable, and becomes a path the day the sitemap
says so. The same question will arise for every drill-down screen still to be built.

### Category order is editorial, not data

Categories always render **الكبار → اليافعون → الطفل**. That is the association's own
progression, and it is neither alphabetical nor `display_order` — so it is a constant in the
page with unrecognised categories sorted **last rather than dropped**, because a category added
later must still appear.

### Academic years sort as strings, safely

`YYYY-YYYY` is constrained by TD-6, so `2026-2027 > 2025-2026` lexicographically *and*
chronologically. Newest-first therefore needs no date parsing.

> **A divergence, reported rather than resolved:** §5.2 pins the `is_current` year at top,
> while this sorts strictly newest-first. They coincide for every ordinary year and differ only
> if a future year is recorded ahead of the current one. §5.2 also specifies a **Subject** tier
> beneath Branch, which is rendered here as a **badge on the card** rather than a fourth
> grouping level — see [the gap analysis](../reference/api-endpoints.md#specified-not-yet-built).

### Filtering locally is right here and would be wrong on the calendar

The content filters narrow **the response the page already holds**. The calendar's
category→level dependency instead re-requests, because §4.4 requires *that* narrowing to happen
server-side — the level list is reference data the server owns.

The distinction is the object being filtered: **filtering a list you were handed as reference
data is forbidden; filtering your own already-fetched result set is not.** Every filter option
is also derived from the content actually present, so a control can never offer a year, branch
or type that yields nothing.

### The preview architecture

One viewer implements the whole §14.6 table, so preview behaviour is defined once:

| Kind | Behaviour |
|---|---|
| PDF | Inline `<iframe>` + download |
| Video / Audio | Native `<video>` / `<audio controls>` + download |
| Image | Shown full-width + download |
| Office document | **Download only** — no in-browser rendering in the MVP |

**Native elements, not a player library.** A `<video>` gives keyboard control, captions and
picture-in-picture for free, and the CSP admits no external script host anyway — the same call
the `<select>` and the native `<dialog>` got.

**The URL is fetched when the dialog opens, never with the list.** Private content is reachable
only through a short-lived presigned GET minted after a server-side permission check (§3.1,
TD-12). A ten-minute URL attached to every card would be expired before most were clicked, and
would mint permission checks for content nobody opened.

> **A consequence, not a bug:** a long recording can outlive its URL — a 40-minute video opened
> at minute nine of its URL's life will stall. The viewer offers a retry that re-mints. Whether
> the client should refresh pre-emptively is a Document Owner decision, not an implementation
> detail.

## The active role drives the whole interface (R60)

**One rule: presentation reads `activeRoles`, never `me.roles`.**

`/me` reports every assigned role on purpose (R60.9) — the switcher's menu is
built from it, so narrowing it would let a person trap themselves in a lesser
role. That full list is therefore available everywhere, and **using it to decide
what the interface shows was the defect**: it answers *what could this account
do*, where the question is *what is it doing now*.

`useActiveRole()` exposes both, and the names say which is which:

| | Use it for |
|---|---|
| `roles` | The switcher's menu. Nothing else |
| `activeRole` | Labels — "you are working as …" |
| `activeRoles` | **Everything else**: navigation, dashboards, route guards, write affordances |

`activeRoles` is the active role as a one-element array, because the helpers that
decide these things (`visibleModules`, `roleHomePath`, `canAccess`) all take a
role *list* — they predate R60 and were written against `me.roles`. Handing them
`[activeRole]` makes them correct with no change to their signatures, and gives
every caller **one obvious thing to read** instead of a choice between two lists
where only one is right.

> **The two defects this fixed, and why neither was a routing bug.** `لوحة
> التحكم` resolved most-privileged-first from the full list, so a Super Admin
> working as مؤطِّرة was sent to `/admin` — a portal her active role does not own
> — and met the wrong-role screen instead of her dashboard. And the back-office
> sidebar listed Super Admin modules to somebody acting as Admin: a menu of
> things the server would refuse. Both were `me.roles` read where the active role
> was meant, in thirteen places.

### The rule is enforced, not documented

`scripts/ci/check-active-role-presentation.sh` scans the frontend and fails on
any presentation read of the account's full list. It catches three forms — the
direct read, destructuring it out of `me`, and taking `roles` from the context
that publishes both — because the second and third are the obvious ways around
the first.

**A source scan rather than an ESLint rule**, deliberately: the project has no
ESLint plugin configuration and twelve guards of this exact shape already wired
into CI. A custom rule would mean a new dependency to pin (§3.1a) to catch a
pattern that is a grep.

**Four files may read the full list**, each for a stated reason: the context that
owns the distinction, the session that fetches `/me`, the switcher whose menu
*is* that list, and `hasMultipleRoles` — which asks whether there is a choice to
offer, a switcher question.

**A screen that needs to know what the person could switch to asks by name.**
`switchableTo(candidates)` exists so the wrong-role screen never destructures
`roles`; reading the list there would be indistinguishable, to a reader and to
the guard, from the mistake R60 shipped.

> **What it cannot catch, stated rather than implied.** A value laundered through
> an intermediate — `const s = me; s.roles` — is beyond a regex. What it does
> catch is every direct read and every destructuring, which is how all thirteen
> sites were written and how a fourteenth would be.

**Write affordances follow it too.** A Super Admin working as مؤطِّرة is not
offered a control the server will refuse — the affordance follows the authority,
which is the whole point of R60 reaching the client.

**And the same rule governs DATA, not only roles: a selector feeding a
validated pair must be populated from that pair's own source.** `حلقات المواد`
listed its Subjects from `listSubjects` — every Subject on the platform,
independent of the chosen Level — while the server requires the `(Level,
Subject)` pair to exist before a Circle can split it (§4.4c). A Level teaching
nothing therefore showed a full dropdown whose every option produced
`SUBJECT_NOT_IN_LEVEL`. The fix is `listLevelSubjects(levelId)`, never a looser
validation:

> **A control that can only be refused is the defect.** When the server rejects
> a combination the interface offered, the interface is wrong — read the
> refusal as a statement about the *options*, not about the rule.

The second half of that repair is what a screen does when the correct list is
**empty**. An empty selector is not an answer; a Level that teaches nothing has
nothing to split, so the screen says so and links to `مواد المستوى`, the node
that fixes it. That is the same shape as the Levels table's `لا مواد` state —
a named empty state carrying the one action that helps.

**The wrong-role screen survives, for deep links only.** A bookmark or a shared
URL into a portal the active role does not own still needs an answer, and §14.4
forbids a blank page. Nothing *inside* the application navigates there any more.

## Scheduling is one screen (R56)

`الجدولة` (`/admin/schedules`) is the single scheduling entry point. An
administrator schedules *something* and picks its kind on the form; they never
have to know whether it is stored as an `Event` or a `RecurringCourseSchedule`.

**The models are not merged** (§20 rule 22): Events are computed on read while
Sessions are materialized as rows (TD-4.6c), which is what lets §4.4 compute
conflicts against real occurrences and lets R50 split a schedule. The divergence
lives in `adapters/scheduling.ts` and nowhere else — every screen above that line
deals in `SchedulingItem` and `SchedulingType`.

### Two views, one question each

* **List** — the *definitions*. One weekly class is **one row**, not forty,
  because that is what an administrator created and what edit and delete act on.
* **Calendar** — the *occurrences*, from `GET /calendar`, rendered by the same
  `CalendarGrid` the public calendar uses.

**That distinction is the substantive one.** The two former pages listed *rules*
and *expanded occurrences* respectively — not two styles of one screen but two
different questions, which is why no amount of restyling made them feel alike.
The view is a query parameter, not a second navigation node (§20 rule 16).

### The form is a shell, and that is what makes Exams cheap

`SchedulingForm` owns **only what every schedulable item has** — a name, an
optional description, when it starts and ends, and how it repeats. The
type-specific fields arrive as `children`: `ClassSection` (§4.4c — subject,
target, room, teacher, assistants), `ActivitySection` (§4.4 — visibility and
scope) or `ExamSection` (§4.6 — see below). A `type === 'class'` ladder inside it
would be how a "generic" form quietly becomes three forms sharing a wrapper, and
the parity guard asserts there is none.

**The claim was tested by cashing it.** R58 added Exams, and the shell, the
recurrence editor, the list and the calendar grid were unchanged: what moved was
one registry entry (`SCHEDULING_TYPE_SPECS.exam`), one section component and one
arm in `saveSchedulingItem`. That is the whole cost of a third kind.

### Physical exams (R58)

`ExamSection` asks `نوع الامتحان` first. `حضوري` is built; `عن بُعد` is **offered
and disabled with its reason stated** (§14.4) — and the server refuses it too,
with `STATE_CONFLICT` / `ONLINE_NOT_AVAILABLE`, so the block is not a client
courtesy that a curl request walks past. **No online field is rendered at all,
disabled or otherwise**: that mode needs an exam link, a selected-student
audience, an open/close window and submission rules, and drawing any of them now
would promise a shape nobody has decided.

The physical fields reuse the shared dependent selectors (R55): branch → level →
subject → year, with the room narrowed to the chosen branch and the group to that
Level at that branch. **An empty group means the whole Level sits together** — it
is an answer, not a gap, and the DTO carries the `null` rather than omitting it.

**Editing is arrangements only.** Date, time, room, group, staff, title and
description change; `mode`, `level_id`, `subject_id`, `academic_year_id` and
`branch_id` are refused by a `.strict()` schema, because each would change *what
is examined, for whom, or where* while keeping the grades already recorded
against the old answer. Moving an exam to another Level is a new exam.

> **`SchedulingItem.ids` exists because of this.** `PATCH /exams` sends the group
> and the staff unconditionally, so an edit form that opened with them blank
> would silently clear the audience of every exam anybody merely re-titled. The
> list row already carries the ids beside the names, so the form seeds itself
> with no second request.

### The exam colour

An exam is the one item on a timetable a reader must not mistake for an ordinary
class, so it gets a **third hue** — `--color-exam`, violet — rather than
borrowing the zellij green that means *class* or the brass that means *activity*.
It is deliberately far from the red that means *danger*: an exam is significant,
not an error.

One token, four surfaces: the calendar chip (`event-chip--exam`), the list badge
(`badge--exam`), the details dialog and the type indicator all read it, so they
cannot drift. **Colour is never the only signal** — the chip carries a
full-strength edge and the badge a ring, and every surface prints `امتحان` in
words.

### One recurrence editor, and how the two `weekly`s were reconciled

The editor carried two variants because the expanders disagreed: `expandEvent`
repeats **every seven days from the start date** and ignores weekdays;
`expandSchedule` repeats **on the weekdays listed**.

**They describe the same rule** whenever `weekdays = [the start date's weekday]`.
The divergence was never in the domain — it was in what each caller sent. One
editor emits one meaning and the adapter fills the weekday set for a class, so
no backend change was needed: the schedule expander already produces the event's
behaviour given that set.

Eight patterns map onto the `RecurrenceType` enum **in one place**. *Every two
weeks* and *every two weeks on chosen days* share an enum value and are told
apart by whether a weekday set was given — a distinction the interface must make
because they are different questions, and the database need not because they are
one rule with a fuller argument. A round-trip test pins that a chosen pattern
reopens as itself.

**`allowOnce={false}` for classes**: the database refuses `none` on a schedule,
because a non-recurring occurrence *is* an Event.

### Capacity is shown, never enforced

BR-23 and §20 rule 22 forbid enforcing room capacity. The form has a slot for it
as a **read-only hint** beside the room — but `RoomDto` publishes no `capacity`,
so it renders nothing today; putting it on that wire is a further contract change
and is recorded rather than smuggled in.

### Historical: how the two pages drifted before R56 merged them

*(Retained because the failure mode generalises. `/admin/calendar` no longer
exists.)* `الأنشطة` and `الحصص` drifted three separate times, and never in a way either page looked wrong for on its own. What
was wrong was always **the difference**:

| | Events | Sessions (before) |
|---|---|---|
| Page lede | layout prop | a `<p className="lede">` in the body, so the first line sat at a different height |
| Create button | `variant="primary"` in the layout's action slot | no variant — the page's main action was not the emphasised one |
| Result message | shared `.admin-notice` | bare `<p role="status">`, carrying no spacing or colour |
| Filter row | present | **none**, though the endpoint accepts branch, subject and year |
| Form fields | wrapped in `.form` | **no wrapper** — every field's spacing differed |
| Save button | `variant="primary"` | default, so *cancel* and *save* looked equally weighted |
| List dialogs | — | two hand-written `<Dialog>` + `<ul>` blocks |

**The frame was shared and the contents were not**, which is the whole story:
`Dialog` gave the outline, and each form assembled the rest by hand.
`components/ui/form-dialog.tsx` closes that — a form supplies its **fields**, and
the component owns the wrapper, the notice, and the two buttons that end every
form the same way. `ListDialog` beside it does the same for a dialog whose whole
content is a set, and owns the part worth sharing: **an empty list means *there
are none***, which for conflicts is a reassuring answer and must not render as an
empty `<ul>` a reader mistakes for a failure to load.

### A table shows names, and that is a contract property

The sessions table looked foreign long after its shell matched, because it led
with a clock time and printed a **raw UUID** for the room. No component could
have fixed that: `CourseScheduleDto` published five ids and no labels, so no
client could render a timetable without five further requests.

The DTO now resolves `subject_name`, `target_name`, `branch_name` and
`room_name` — the precedent `libraryItemDto` set, for the reason it states:
**labels, never identifiers**, with the ids remaining what a client filters and
links by. `target_name` is whichever of the three the mode names (§4.4c), so a
reader is not asked to resolve *who this class is for* from three nullable ids.

**Presence is not absence.** The first parity test asserted the shared
components were *used*, which a page can satisfy while still carrying custom UI
beside them — and one did, for a whole revision. The guard now also asserts what
must not be there: no bare `<Dialog>`, no raw `<ul>`, no raw `<select>`, no
`r.*_id` in a table cell.

### Where the primary action lives

**In the layout's `actions` slot, never the table's toolbar.** The toolbar is for
narrowing what is listed; creating a record is not a filter. Mixing them put the
same button in two places depending on which screen you were on.

### What genuinely differs, and why it should

Only the **fields the domain requires**: a class has a Subject, a Room, a primary
teacher and assistants; an Event has a visibility and a four-way scope. The
recurrence control is one component with two variants because `lib/recurrence.ts`
states the shapes are *deliberately not merged* — an Event is anchored on a start
date, a class happens **on Tuesdays**. The control is identical, which is what an
administrator notices; the fields differ, because the models do.

`scheduling-parity.test.tsx` pins this **structurally** rather than
per-difference: it asserts both files reach for the same primitives and that
neither contains the hand-rolled equivalents. A per-difference test would have to
be remembered for each new divergence, which is the discipline that already
failed three times.

## Every selector is dependent, and one module says how

**The defect this exists for.** Each screen's selectors were independent: a form offered all 21
Levels and all 3 Subjects and let an administrator pick any pair, while a Subject reaches a Level
only through `LevelSubject` (§4.4b, R43). The interface was offering combinations the domain does
not contain, and then reporting them as the user's mistake.

`hooks/use-scope-options.ts` states the graph once:

```
Category ──< Level ──< LevelSubject >── Subject
                │
                └──< AdministrativeGroup >── Branch
```

Two rules a screen must never re-implement:

1. **Changing a parent reloads every child** — not just the next one. A Level change invalidates
   Subjects *and* Groups.
2. **A selection no longer offered is cleared, not kept.** A stale id left in state is precisely
   what reaches the server as an impossible pair; clearing it is what makes *"the UI cannot
   express an invalid combination"* true rather than aspirational.

**Why one module and not one chain per screen.** Six screens ask overlapping versions of the
same question, and six copies of *"when the Level changes, reload the Subjects and clear the
stale one"* is exactly the duplication that drifts here — the copy that forgets to clear still
passes its own tests.

**Academic Year is deliberately unchained.** The platform's years are global (§4.10). Inventing
a dependency so the set looks uniform would be a lie about the model.

### The field list is a dependency by content, never by identity

`useScopeOptions` takes the fields a screen wants. That list is keyed by
**content** (`scopeFieldKey`), not by array identity, and the reason is a defect:

a page passed the list as an inline literal → a new reference every render →
`wants` was keyed on it → the loading effects were keyed on `wants` → those
effects set state → re-render. Four steps, closed loop. The requests then
started failing, which looked like a server fault and was the **rate limiter
working correctly** against a client defect (TD-13).

**Every other caller happened to pass a module constant**, which is exactly why
it survived review: the convention concealed a hook that punished anyone who did
the obvious thing. So the fix is not *"always pass a constant"* — that is the
convention that already failed. Identity simply cannot matter now.

**A hook that takes an array or object prop must key on its content**, or
document why the caller is required to memoise it. The test asserts both halves:
that the key is content-based, and that the hook *uses* it — the second because
the first alone would pass while the bug was back.

### An empty list is never a bare empty dropdown

`components/scope/scope-selectors.tsx` owns *how they look and what they say*, and three states
are worded differently because they are different:

| State | What it says |
|---|---|
| Parent not chosen | *choose a level first* — an instruction |
| List loading | the field is `busy`; the label does not flicker |
| Genuinely empty | *this level teaches no subjects* — a fact about the curriculum, naming the screen that changes it |

The third is the one that mattered: it is the state that used to reach the server as
`SUBJECT_NOT_IN_LEVEL`.

**Global / بدون فرع is passed in, not built in.** `branch_id = null` is a real scope (§4.9) that
no branch list can contain, so it travels as `extraOptions` from the screens that mean it —
rather than teaching a shared component why a branch selector sometimes offers a non-branch.

## Content upload, and why one screen serves two portals

`/admin/content` (§5.6) and `/teacher/content` (§5.5) render **the same component**. The
capability is identical — attach a file to a Subject within a Level, replace it, delete it —
and what differs between the audiences is **what the server will accept**, not what the client
offers: a Teacher cannot choose the Global scope and is confined to the branches of the
schedules they staff (§4.9). Building two screens would put that difference in the client,
which is exactly where it must not live.

So the page **renders refusals rather than pre-empting them**, with one deliberate exception:
the Global option is not offered to a Teacher at all, because an option that always fails is
worse than no option. Everything else the server decides, and the uploader turns each refusal
into a sentence someone can act on — *"a teacher cannot publish without a branch"* rather than
*"upload failed"*.

### A teacher's branch list comes from their schedules

Revision 30 forbids a teacher browsing reference data, and the admin branch list would in any
case offer branches every upload would then be refused for. The list is therefore derived from
**the schedules they staff** — the same §4.4c derivation the server uses to decide — with the
*names* coming from the public branch list the landing page already serves anonymously.

### Progress is a contract, not a flourish

MVP uploads are single-shot with no resume: a failure restarts from zero (Risk R-9), and §4.9
accepts that risk **in exchange for** visible progress and a clear retry. That is why the
uploader uses `XMLHttpRequest` for the PUT and nothing else does: `fetch` reports download
progress and not upload progress, and streamed request bodies are not supported across §14.7's
matrix. One older API, in one place, for the one thing it can do.

**Retry re-runs the whole flow** — a new ticket, a new key, a new hash segment — never a
resumption. There is nothing to resume, and pretending otherwise is how a half-written object
gets completed as though it were whole.

### The list is `GET /library`, not a new endpoint

TD-3.13's route is already tier-aware and shows staff all three visibilities including
`hidden`, which is exactly the management view. A parallel admin listing would have been a
second expression of the §4.9 tiers — the duplication that drifts. **Branch is the one filter
applied client-side**, because TD-3.13 publishes no `branch_id` parameter and widening a public
contract for a back-office convenience is the wrong trade.

### Session materials link, never own

The materials dialog on `/admin/schedules/{id}/sessions` is built around Revision 43's rule
that content is **referenced** by a session and never owned by it. Linking an existing item is
the primary action, because the semester PDF belongs to the Subject and is referenced by every
session that uses it; uploading is a shortcut that creates the library item and then links it.
**Removing unlinks and never deletes** (TD-3.12) — destroying a file for every other session
that references it is not what *"remove from this session"* means.

## The CRUD framework

Branches was the first CRUD module, and the deliverable was **not a branches screen** — it was
the framework every later module configures (constitution §0.1, *build systems, not pages*).

| Capability | What it owns |
|---|---|
| `DataTable` | §14.2's list standard and all of §14.4's states, once |
| Field primitives | Label association, error wiring, required marking, hints |
| `ConfirmDialog` | Every destructive action, plus TD-8's mandatory justification |
| `Pagination` | TD-10's envelope, stepped the same way everywhere |
| `Badge` | A status label — state in words, never colour alone |
| `ApprovalCard` | §14.3's bundle-aware queue item: who is in the bundle, and what approving it changes |
| `BranchSelector` | §14.3's branch picker — one component, filtering *and* required-choice modes |

**There is no `BranchTable` and there never will be** (§2.1). The next module passes different
columns and actions; if it ever needs to *edit* `DataTable` rather than configure it, the
component is drawn wrongly and that is the signal to redraw it (§2.3).

### The second module tested the claim

The approval queue (`/admin/approvals`) was built next, and `DataTable` and the field
primitives took it **as configuration** — different columns, different actions, no edit.

Two components were **improved rather than forked**, which is the §2.5 path when a shared
component *almost* fits:

- **`ConfirmDialog` gained configurable reason bounds.** It had hard-coded TD-9's
  consent-override floor of 10 characters, but a §5.6 rejection is 1–500. A client refusing
  what the server accepts is a bug in the client (§1.1), so the bounds became parameters with
  the consent values as defaults — no existing caller changed behaviour.
- **`Badge` was extracted** from the inline `className="badge badge--warn"` the Hijri screen had
  been carrying. Extracted on the second use, not the third (§2.7).

Neither was a `RejectDialog` or an `ApprovalBadge`. That distinction is the whole framework.

### The registration form found three selectors that were one

Revision 39 gave the registration form a required Branch choice, and the calendar already had
a `BranchSelector`. Copying it would have been the obvious move; it was also the wrong one,
because that component had three defects the shared registry exists to prevent:

1. **A hardcoded `id="branch-filter"`** — two on one page produce duplicate ids and a label
   pointing at the wrong control. The same literal-id bug as `Dialog`, and its two calendar
   siblings (`CategorySelector`, `LevelSelector`) had it too.
2. **Its own markup and `.branch-selector` styles**, so it inherited none of `field.tsx`'s
   error wiring, hint association or required marking.
3. **An always-present "all branches" option** — right for a filter, wrong for a required
   choice. Registration must not let someone submit *"all branches"* as their branch.

All three selectors are now thin configurations of `SelectField`, ids come from `useId`, and
`BranchSelector` carries an `allowAll` variant rather than having a `RequiredBranchSelector`
grown beside it (§2.5). `SelectField` gained a `busy` prop so the Level selector's
"options are loading" state stayed a primitive's concern rather than a caller's.

**Three consumers, one component**: the calendar filter, the approvals filter, the registration
choice.

### What the table refuses to do

It does not fetch, does not sort server data, and does not know what a Branch is (§3.2). The
page owns the data and the decisions.

Three behaviours are worth knowing because they are easy to get wrong and impossible to see
once wrong:

- **The first column is a `<th scope="row">`.** Without it a screen reader announces "3" with
  no idea which branch it belongs to.
- **Empty and no-results are different states.** Only one of them offers a way out.
- **A row action that does not apply is hidden, not disabled** — a permanently dead control
  teaches nothing.

### Field primitives close a real gap

§14.3's registry listed selectors and a file uploader but **no form primitives at all**. That
mattered: a hand-rolled `<input>` is one missing `for` attribute away from an unlabelled
control, and nobody notices until someone using a screen reader does.

Each field generates its own id with `useId`, so two instances on one page cannot collide —
**the exact bug the shared `Dialog` shipped with**, prevented here by construction rather than
by remembering. Errors are wired through `aria-describedby` and `role="alert"` so they are
*announced*, not merely displayed; hints go in `aria-describedby` too, because a limit a reader
learns by tripping over it was stated too late.

### Mirrored validation is courtesy; the server is the rule

The branch form checks TD-9's limits for immediate feedback. That is **not** redundant with the
server's checks and does not replace them (§1.1): one is responsiveness, the other is
correctness. A client skipping a check the server enforces is a bug in the client.

### What an adapter is for, and what it is not for

`GET /admin/branches` used to return **raw Prisma rows**: row fields in `camelCase` while `meta`
was `snake_case`, `operationalStartDate` as an *instant* where TD-11 says a branch's operational
start is a **date**, and four internal columns (`createdAt`, `updatedAt`, `deletedAt`,
`deletedById`) that no screen had any use for.

`adapters/branches-admin.ts` absorbed all of it behind a parallel set of wire types and a
truncating date converter. That was the wrong repair, and the Document Owner rejected it:

> Do not keep an inconsistent API and compensate in the frontend adapter. The backend contract
> is the source of truth.

**SRS Revision 38 fixed the endpoint.** Every response is now an explicit contract DTO — see
[api.md](api.md#the-contract-is-an-interface-not-a-serialisation) — and the adapter collapsed to
typed calls with no mapping at all.

The distinction is worth keeping, because both things look like "adapter work" from inside the
adapter:

| | |
|---|---|
| **Adapting** | Turning a contract into what the UI needs — paging arguments, a `Page<T>` wrapper, an endpoint the screen shouldn't know the URL of. Legitimate; that is the seam's job. |
| **Repairing** | Normalising a shape the backend got wrong. Illegitimate — it leaves the contract broken for the next client, and hides *that* it is broken from everyone, because the one place the symptom was visible now silently handles it. |

A repair is a defect report, not a code change. When you find one: stop, report it, and fix the
contract.

## The back office: one registry drives nav, routing and permissions

`lib/admin-modules.ts` holds §14.1's back-office hierarchy **as data**. The sidebar, the
router and the role guard all read that one list.

§14.1 is emphatic — *"implement exactly this navigation hierarchy, no invented sections, no
reshuffling"* — and holding it as data is what makes that **checkable rather than reviewed by
eye**. Three failures become impossible by construction:

- a menu entry with no route,
- a route with no permission,
- a module visible to a role TD-2 excludes.

Adding a module is **one entry**. A test asserts the registry's paths against §14.1's list, so
inventing a route fails the build rather than passing review.

### `status` is part of the contract

A module whose endpoints do not exist renders a **named** "not built" state saying *what* is
missing — not "coming soon", which tells nobody whether the wait is a day or a milestone. The
same badge appears in the sidebar, so a reader deciding where to click learns before the click
rather than after.

This is also the honest signal about where the back office stands: **seven of eleven modules are
ready; four are blocked on endpoints that do not exist.**

### Path resolution: longest match, separator-aware

`/admin/groups/{id}/roster` resolves to the groups module. A module owns its internal views
**without registering each as a navigation node §14.1 does not list** — the same reasoning
that put the library's level view behind `?level=`.

Matching requires an exact hit or a `/` separator, so `/admin/groupsomething` does not resolve
to `/admin/groups`. A bare `startsWith` would.

### Role gating is a UX layer, and says so

The layout renders the §14.4 no-permission state for a module the session's roles do not
admit. **The server enforces TD-2 on every endpoint regardless** — the URL prefix is not the
permission boundary, which is why the routes stay under `/admin/*` even where only a Super
Admin may write (Revision 26).

The whole back office mounts **inside `PendingGuard`**: a sidebar and headings are exactly the
"empty skeleton layout" that guard exists to prevent a Pending user from glimpsing.

### The dashboard is a launcher, not a statistics screen

§5.6 asks for pending-approval counts and overview stats. **No endpoint serves them**, and
inventing a number would be worse than omitting one — so it lists the modules the session may
open, with blocked ones marked, and becomes a dashboard when there is something true to count.

## The child section is one component, not one per entry point

`components/registration/children.tsx` owns the child fields, the add/remove
behaviour, the cap and the validation. `/register` and `/profile/register-child`
both compose it.

**They diverged twice before this.** R62 unified the *service* and left the
*forms* separate; R64 then found that the parent-facing one collected no branch
and no stage, so approvers received requests missing the two things §4.1 step 1
and Revision 39 exist to give them. R65 moved the page and the personal copy
still had no repeatable section — a parent of three submitted three requests
from one page while the other took them in a single one.

What stays with each page is the *request-level* answer: `/register` asks one
branch and one stage for the whole family, the personal page asks them per
submission. Those belong to the surrounding form. A **child** belongs to the
shared component.

## Dates read in Arabic, and where that stops being possible

`lib/format-date.ts` is the one formatter — `١٢ يونيو ٢٠٢٦`, month names from
the catalogue the calendar already uses. Every `<time>` on the platform goes
through it; before, the same day printed three ways depending on the screen
(`2026-06-12`, `created_at.slice(0, 10)`, or a private helper inside one card).

**`<input type="date">` is the boundary.** Its placeholder and its value render
in the **user agent's** locale — `lang`, `dir` and CSS cannot change it, which is
why the fields read `mm/dd/yyyy`. Only abandoning the native control could fix
that, at the cost of the platform picker, the mobile keyboard, and the keyboard
and screen-reader behaviour that comes with it. So `DateField` keeps the native
input and makes the rest Arabic: `lang="ar-MA"`, a hint naming the expected
order, and the chosen date echoed underneath through `formatDate`.

Stored and transmitted values are untouched — `YYYY-MM-DD` (TD-11).

## The footer sits at the bottom, or after the content

`#root` is a flex column of `min-height: 100dvh`; `#root > main` and
`#root > .admin` take the slack with `flex: 1 0 auto`.

A short page used to leave the footer floating mid-screen with background below
it. This is a layout, not a margin and not `position: fixed`: on a long page the
body is already taller than the slack, nothing stretches, and the footer follows
the content exactly as before. There is no threshold to tune. `dvh` rather than
`vh` so mobile browser chrome collapsing does not tuck the footer under a
toolbar.

## Every table shows every field its own form collects (R64)

**The rule, stated once.** A management table exposes **every field the entity's
own create/edit form collects**, minus two exceptions:

* **operational metadata** — `version`, `created_at`/`updated_at`, `deleted_*` —
  which belongs to the mechanism, not to the entity;
* **a relation the row already names another way**, so it is not printed twice.

§14.2 calls its column list *"the minimum set"*, and that was read as a ceiling.
The audit that produced this rule found two tables silently short:

| Table | Collected by its form, absent from the table |
|---|---|
| `/admin/branches` | `phone`, `email`, `opening_hours_ar`, `google_maps_url` |
| `/admin/levels` | `display_order` |

Neither omission was a decision. An administrator who entered a branch's phone
number and opening hours could not see either again without reopening the
editor, so the screen could not answer *is this branch's public information
complete* — the question Revision 35 makes worth asking, since exactly those
fields are published to anonymous visitors.

**A URL renders as an affordance, not as text**: the map column is a link
labelled «فتح الخريطة», because ninety characters of query string is not
information. Everything else renders its value or the shared *not set* marker.

Checked and already complete: `/admin/groups`, `/admin/users`, `/admin/subjects`
and `/admin/categories`. `/admin/trash`, `/admin/schedules` and the occurrences
list are composite views rather than one entity's CRUD, and the rule does not
reach them.

## One form pattern: `FormDialog` (R64)

Every create/edit dialog is a `FormDialog`, and every control inside it is a
`field.tsx` primitive. The component exists precisely to end drift — its own doc
comment records the Events-versus-Sessions divergence that produced it — and
`إضافة مجموعة` was the last screen that had not adopted it:

| | `إضافة مجموعة` before | Everything else |
|---|---|---|
| Selects | raw `<label><select>` | `SelectField` |
| Buttons | its own `dialog__actions` row | the shared pair |
| Save emphasis | default (secondary) | `primary` |

Beside `إضافة مستوى` the difference was visible at a glance, and none of it was
a decision anybody took. A hand-rolled `<select>` also has no label association,
no placeholder handling, no required marking and no error announcement except
what that screen remembers to add, which is the accessibility half of the same
problem.

## The personal section is role-independent (R65)

**`/profile` carries what concerns the person; a portal carries what concerns a
role.** The line is not stylistic — it decides who can reach a screen at all.

§5.2 has listed `Profile (/profile)` under *Shared / Cross-Role* since long
before the portals existed, and it was never built. So when R64 needed somewhere
to put child registration it hung the page off `/dashboard/student/` — and **a
مؤطِّرة who is nobody's student then had no way to register her own child**, even
though `POST /child-applications` had never required a role and never checked
one. The capability was there; only the door was missing.

The test for whether something belongs here: **would you still want it if the
account's only role were `teacher`?** Your own details, editing your contact
info, registering a child, and the status of requests you have made — yes, all
of them. A roster, a schedule, a grade — no.

**The account menu (`الحساب`) is the entry**, because it is the one header
control that never depends on a role.

**One entry point, not one per role.** R64 exists because a dialog reachable only
by parents carried fewer fields than the public form, and approvers received
requests naming no branch and no stage. A second door invites a second form.

**`ولي الأمر` stays about already-approved children.** Selecting it → a child is
how you enter that child's Student Dashboard, and no registration action lives
inside it.

### What is deliberately absent

**No account-deletion control**, though §4.10 says *"two-step account
self-deletion"*. Those five words have no route, no state and no screen;
`docs/SRS-PROPOSAL-R54.md` drafted the whole thing and **has never been
approved**, because it reverses R52's prohibition on permanent deletion.
Shipping an irreversible action because a page now exists to host it would be
the worst possible reading of R65. When the Owner takes that decision, the
screen belongs here.

### The write surface is two fields

`PATCH /profile` accepts `phone` and `nickname`. The exclusions are the
specification, not an oversight:

| Excluded | Why |
|---|---|
| names | **Identity.** §1.1 composes them server-side from parts collected once; a rename is a staff act on §14.2 where it is reviewable |
| `sex` | Feeds §4.4b's `gender_restriction` — self-editing it moves a person past an admission rule |
| `email` | The Google identity the account is keyed to (§4.1b) |
| `account_status` | An approver's decision (TD-1) |

They are **refused, not ignored**: the schema is `.strict()`, so a client that
tried to rename someone learns it failed rather than believing it worked. The
read shows them anyway — a person should see the name and email staff will use
to find them.

## The family surface: one switcher, one dashboard (R62)

**`ولي الأمر` is not a destination — it is a group.** A parent's home is a *child's*
dashboard, so selecting the bare role would arrive somewhere with nobody selected. The
account switcher's `parent` entry therefore expands into the approved children plus a
persistent **«＋ تسجيل طفل»** action, and picking a child sets the active role and the
active child **in one action**.

That is why there is no longer a second child dropdown beside the role switcher. Two menus
made one decision into two, and left two places to be wrong about who is currently active.

**A parent-only account still gets the switcher.** The old rule hid it below two roles,
which for a parent holding exactly one role hid the entire family surface — the children
and the registration action are inside that menu.

**R64 moved «＋ تسجيل طفل» out of the switcher onto its own page, and R65 moved
that page out of the student dashboard** to `/profile/register-child`. A switcher lists the *contexts* a person may
work in and registering is a task — and, more concretely, a dialog opened from a
menu could only ever carry a subset of what the public form collects. That subset
is exactly how the two registration paths diverged: a parent adding a second child
supplied **no branch and no stage**, so the approver received a request missing the
two things §4.1 step 1 and Revision 39 exist to give them. The page asks what
`/register`'s child section asks and nothing more. It posts a single child — the
public form is the multi-child one, because a family arrives at once.

**`ولي الأمر` is offered only once a child is approved.** The entry expands into
the children and nothing else, so with none approved it would open an empty menu:
an entry onto nothing is the same defect as a button that renders a blank page.

### `/dashboard/student` serves two contexts, and says which

The same route renders the caller's own record when they act as a student and the active
child's when they act as a parent, because `GET /students/me` resolves the **acting**
student server-side (§4.3, R63). The client sends the child header and renders whatever
comes back; it never decides whose data this is.

**A persistent banner names the child** (R62.10) — not a toast and not a subtitle. A parent
looking at the wrong child's schedule must find that out by reading the screen, not by
noticing something is off.

Its scope is R62.10's and stops there: the identity block, today's and upcoming sessions.
Quran progress, grades and exams are later milestones and are **not** stubbed — an empty
section promising a feature is a §14.4 problem, not a placeholder.

**The sessions list passes the access token to `GET /calendar`.** That endpoint is public
and optionally authenticated, so it returns the *caller's* visibility tier; the public
calendar page passes nothing and gets the public tier, which is right for it. On this
screen a session restricted to the student's own Level is exactly what is wanted.

## Toasts

| Kind | Treatment |
|---|---|
| Success | Green, auto-dismiss 4 s |
| Validation failure | Amber, or inline field errors — **field errors preferred** — sticky until corrected |
| Permission denied / consent lock | Red, the message key text, auto-dismiss 6 s |
| Job queued | Blue "queued", then a status indicator; completion raises a success toast |

**Toasts never contain PII beyond first names, and never raw error internals.**

## Browser support

| Browser | Minimum |
|---|---|
| Chrome / Edge, desktop and Android | Last 2 majors |
| iOS Safari / WebView | **iOS 16+** |
| macOS Safari, Firefox | Last 2 majors |
| Anything older | Best-effort rendering; download-link fallback; **upload always works** |

**No support for browsers without ES2020** — no legacy transpilation targets, no IE.
Responsive layout is tested at **360 px minimum**.

## Verifying a styling change

Two tools, and **neither alone is sufficient**:

- `scripts/dev/css-resolve.py` resolves every `var()` to literals and reports one line per
  declaration — this catches changed **values**.
- Diffing the built `dist/assets/*.css` before and after catches changed **order**.

The lesson is recorded because it was learned the hard way: during a file split the resolver
reported zero change, while the built CSS showed 52 chunks had moved. In a stylesheet where
every rule has single-class specificity, **order is the cascade**, and a value-level check
cannot see a rule moving past another.

> [Design system](design-system.md)

---

**Next:** [Design system](design-system.md) · **Related:**
[API](api.md), [Internationalization](internationalization.md)
