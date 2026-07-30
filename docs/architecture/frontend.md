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
  dependency, not a drive-by addition.
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
