[Documentation](../README.md) › [Architecture](README.md) › **Design system**

# Design system

Plain CSS, three layers, no framework. RTL-first, mobile-first, **light theme only**.

## The palette comes from the association's own world

Not a template: the **deep green of Moroccan zellij**, brass as the single accent, and
neutrals biased warm-green so nothing reads as unconsidered grey.

A pure mid-grey reads as unchosen. The neutrals here have a slight hue bias toward the
accent, which is the difference between a palette that was picked and one that was
inherited.

### The logo's two colours, and why each exists twice

Sampled from the logo itself: the arch and wordmark are **orange `#e89018`**, the seedling
mark a fresh yellow-green **`#a8c838`**. The dual calendar uses them to tell the two date
systems apart — orange is Gregorian, green is Hijri, in the title and in every day cell, so
a reader learns the pairing once.

**Neither can carry text.** On the white calendar surface the orange measures **2.5:1** and
the green **1.9:1**, far below the 4.5:1 body-text floor — and the day numbers are small text
on white.

So each colour exists twice: the **true logo value** for fills and marks, and a **darkened
same-hue variant** for text.

| Token | Value | Contrast on white |
|---|---|---|
| `--color-gregorian` | `#a86206` | **4.71:1** |
| `--color-hijri` | `#64791a` | **4.91:1** |
| `--color-gregorian-mark`, `--color-hijri-mark` | the raw logo values | fills only |

Same hue family, so the identity survives; enough luminance to be readable, so the screen
does. **Changing either value means re-measuring** — the numbers are the reason they are these
values and not prettier ones, and they are recorded beside the tokens for exactly that reason.

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
