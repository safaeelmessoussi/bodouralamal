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

### The router must never return nothing

`/dashboard` rendered a **blank white page**, and it was reachable in one click by every
signed-in user.

Two mistakes met:

1. **The header's Dashboard button linked to `/dashboard`** — a path §14.1 does not define.
   The sitemap lists *role-specific homes*: `/dashboard/student`, `/dashboard/parent`,
   `/teacher`, `/admin`. §4.1b step 4a calls the post-login landing a "role-based dashboard
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
`ConsentStatusBadge` · `FileUploader` · `ChildContextSwitcher` · `ApprovalCard` ·
`ConfirmDialog` · `EmptyState` / `ErrorState` / `NoPermissionState` · `JobStatusIndicator`

`DualDateDisplay` carries a rule from the calendar design: it renders **the Gregorian date
alone** when the Hijri month has not been published. No placeholder, no computed guess.

`Dialog` takes a `wide` variant, for a dialog carrying a **list** rather than prose — the
default width is a reading measure, which is right for an event record and too narrow for a
day's timetable.

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

This is also the honest signal about where the back office stands: **six of eleven modules are
ready; five are blocked on endpoints that do not exist.**

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
