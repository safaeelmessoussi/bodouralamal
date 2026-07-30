[Documentation](../README.md) › [Architecture](README.md) › **Design system**

# Design system

Plain CSS, three layers, no framework. RTL-first, mobile-first, **light theme only**.

## The palette comes from the association's own world

Not a template: the **deep green of Moroccan zellij**, brass as the single accent, and
neutrals biased warm-green so nothing reads as unconsidered grey.

A pure mid-grey reads as unchosen. The neutrals here have a slight hue bias toward the
accent, which is the difference between a palette that was picked and one that was
inherited.

### The brand colours, and a contrast decision recorded rather than hidden

The association's two official values: **orange `#f39200`** and **green `#8dc63f`**. The dual
calendar uses them to tell the two date systems apart — orange is Gregorian, green is Hijri,
in the title and in every day cell, so a reader learns the pairing once.

**Both fall below the contrast floors, and are used anyway — by decision.**

| Token | Value | Contrast on white | WCAG |
|---|---|---|---|
| `--color-gregorian` | `#f39200` | **2.35:1** | below 4.5:1 body text **and** 3:1 large text |
| `--color-hijri` | `#8dc63f` | **2.02:1** | below both |
| `--color-gregorian-ink` | `#a86206` | 4.71:1 | passes body text |
| `--color-hijri-ink` | `#64791a` | 4.91:1 | passes body text |

The Document Owner decided to use the brand values on the calendar: the day numbers are
**decorative labels inside a calendar rather than body text**, and matching the association's
visual identity takes priority on this surface.

**One property makes that defensible, and it is worth knowing before reusing these tokens:**
the numbers are **not the only way the date is conveyed**. Every day cell is a `<button>`
whose accessible name carries the full ISO date, so a screen-reader user receives the date
regardless of the rendered colour. The residual risk falls on **low-vision sighted** users,
and it is accepted knowingly rather than overlooked.

**The `-ink` variants remain, and are the correct choice anywhere these hues must carry text
a reader depends on** — a form label, an error, a data value with no other representation.
Which pair applies is a **decision, not a detail**: do not silently swap one for the other,
in either direction. If a new surface needs the brand hue on text that has no alternative
representation, raise it rather than resolving it in CSS.

**Changing any of the four values means re-measuring.** The ratios are recorded beside the
tokens because they are the reason those values are what they are.

**A colour that carries meaning must not be overwritten by a state.** Today's cell originally
marked itself with a *filled* green disc on the Gregorian number — which erased the orange that
now says "this is the Gregorian calendar", making today's cell the one place the colour
language broke. It was redesigned to a **ring in `currentcolor`** plus a soft cell wash: the
familiar "today circle" convention survives, the number keeps its own colour by construction,
and nothing is filled, so it stays light beside a busy day.

`currentcolor` rather than a repeated token is the point — the ring **cannot** drift from the
numeral it encircles.

The semantic names say *what the colour means* — a date system — rather than naming a hue, so
a rebrand moves them in one place. This is the same discipline the brass accent got: it was
chosen dark enough to carry text at 4.5:1, not chosen and then tested.

## No web font, and that is the right answer

The content security policy is `default-src 'self'` with no font host, so a linked face
would be **blocked and silently fall back**. Inlining an Arabic face costs 200 KB–1 MB,
which the connectivity constraint rules out.

So the system Arabic stack is used — and the typographic character comes from **scale,
weight, spacing, and rhythm** instead. This is a constraint that turned out to be correct on
its own merits, not a concession.

## Light only

There is no dark theme and no `prefers-color-scheme` branch. `color-scheme: light` is part
of that decision and is **not cosmetic**: it is what stops the browser rendering **native**
controls — selects, scrollbars, date and form widgets — in dark on a dark operating system,
which is the mismatch that actually looks broken. Removing the media query alone would have
left those.

The tokens stay structured, so reintroducing a dark theme later is one block of overrides
rather than a rewrite.

## Three layers

```
tokens/       definitions only — no rules render from these
  primitives    raw values: the actual greens, the actual pixel sizes
  semantic      MEANING: --color-primary, --color-surface, --color-backdrop
  spacing · radius · elevation · motion · typography · layout

base/         reset · element defaults · layout primitives · utilities

components/   one file per component
              button · header · hero · card · footer · status-pages
              branch-card · calendar · dialog
```

**Components consume the semantic layer only.** `--color-primary`, never
`--brand-green-700`. `--space-4`, never `1rem`.

Rebranding is therefore an edit to the semantic mappings and **to nothing else** — which is
the property the layering exists to buy.

`scripts/ci/check-design-tokens.sh` fails the build on a raw colour, on a component reaching
past the semantic layer, and on a stylesheet nobody imports.

> That guard caught one of its author's own violations two commits after it was added: a
> hardcoded `rgb(7 56 38 / 45%)` dialog backdrop, fixed with a proper `--color-backdrop`
> token. A guard that only ever catches other people's mistakes is not being tested.

## Import order **is** the cascade

`styles.css` is an index of imports, and that list is **load-bearing**.

Every rule in this system has single-class specificity by design. Which declaration wins is
therefore decided by **which file loads last** — not by selector weight. Reordering two lines
can change the rendered page without touching a single declaration.

```
1. TOKENS      definitions only. Nothing renders, so relative order is free;
               they come first because everything below resolves against them.
2. BASE        reset, element defaults, layout primitives, utilities.
3. COMPONENTS  one file per component. These may override base, never each
               other — two components fighting is a naming problem.
```

Adding a component means adding a file **and** a line to the index. A file nobody imports is
invisible, which is a far quieter failure than a missing rule.

**The architecture is documented once, at the top of that index**, where it cannot drift from
the code it describes.

### The bug that made this explicit

The header burger was re-declared *after* the media query that hides it, at equal
specificity — so it was visible at every width. `check-header-nav-exclusive.sh` exists
because of it, and was proven by reintroducing the bug.

### State layering: order encodes priority

The calendar's day cell is the clearest example of the general pattern. Three states share
identical `0,2,0` specificity, so **the winner is whichever is declared last** — which makes
the order load-bearing rather than stylistic:

```css
.cal-day.is-today    { … }  /* weakest — a standing marker, overridable */
.cal-day:hover       { … }  /* must beat it, or pointing at today gives no feedback */
.cal-day.is-selected { … }  /* must beat both, or selecting today looks unselected */
```

**Write equal-specificity states in ascending order of priority, and say so in a comment.**
Reordering those three lines changes behaviour without touching a declaration — and the bug
above is what this project has to show for learning that the hard way.

This was caught during review of the change that introduced it: `is-today` was appended at the
end of the file, where it silently overrode both hover and selection.

### The near-miss during a refactor

Splitting the monolithic stylesheet into files, an unrequested tidy-up moved the utilities
block. The value-level resolver reported **zero change**. Comparing the **built** CSS showed
**52 chunks had moved**. The change was reverted.

Hence the standing note in the index: the utilities and reduced-motion imports sit in the
position they held in the monolith, and although they could arguably sit last, **reordering
rules is a visual change** in a stylesheet with uniform specificity — so any move is its own
separately verified commit.

## Verifying a styling change

Two checks, and **neither is sufficient alone**:

| Tool | Catches |
|---|---|
| `scripts/dev/css-resolve.py` | Changed **values** — resolves every `var()` to literals, follows imports, normalises hex shorthand, reports one line per declaration |
| Diffing built `dist/assets/*.css` | Changed **order** — which the resolver cannot see |

## RTL

The document sets `lang="ar" dir="rtl"` **in the HTML**, not by script. A right-to-left
layout that reflows after hydration reads as broken, so the very first paint is correct.

Layout uses logical properties and flex/grid with `gap` rather than directional margins, so
a future LTR locale is a `dir` change rather than a stylesheet fork.

## Conventions

- **Layout does the spacing.** Flex/grid with `gap`, not per-element margins that collapse
  or double.
- **Wide content scrolls in its own container.** Tables, code, diagrams get
  `overflow-x: auto`; the page body never scrolls sideways.
- **Keyboard focus is always visible.**
- **`prefers-reduced-motion` is respected**, with the override kept in its established
  cascade position.
- **Tabular numerals** wherever digits line up in columns.

---

**Next:** [Internationalization](internationalization.md) · **Related:**
[Frontend](frontend.md), [CI/CD](../development/ci-cd.md#the-guards)
