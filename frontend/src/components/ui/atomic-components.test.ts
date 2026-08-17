import { describe, expect, it } from 'vitest';

import { ADD_GLYPH } from './button.js';

/**
 * **The atomic-component guards** — *one concept → one atomic component*, made
 * checkable (2026-08-17).
 *
 * ## Why these are source scans
 *
 * The rule they enforce is *"there is exactly one implementation of X"*, and that
 * is a statement about the **codebase**, not about any one rendered output. A
 * behavioural test can prove that `<Button>` looks right; only a scan can prove
 * that nobody rendered a second one beside it. This project has paid for the
 * difference repeatedly — every duplicated rule here has drifted, and *the copy
 * that drifts still passes its own tests*.
 *
 * ## Why they are not CSS-class assertions
 *
 * They deliberately do **not** assert that a component emits particular classes.
 * That would pin the design system's internals and break on every restyle while
 * catching nothing. What they assert is the **absence of a second
 * implementation**: a hand-written `btn` class outside the button, a `<table>`
 * outside the table, a Level option built without the shared label.
 *
 * ## Every allowlist entry states its reason
 *
 * An allowlist without a reason becomes the place exceptions go to be forgotten.
 * Each entry below says why it is exempt and what would end the exemption.
 *
 * ## Read through Vite, never through `node:fs`
 *
 * `scheduling-parity.test.tsx` set this precedent and states the reason: the
 * production build typechecks the tests too, so pulling Node's types in for one
 * test would put them on the whole application's type surface. `import.meta.glob`
 * gives the same sweep with none of that — and, unlike a directory walk, it
 * cannot silently miss a file the bundler *does* see.
 */

const RAW = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every application source file, keyed by its path relative to `src/`. */
const FILES: { path: string; text: string }[] = Object.entries(RAW)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))
  .map(([path, text]) => ({ path: path.replace('/src/', ''), text }))
  .sort((a, b) => a.path.localeCompare(b.path));

/** The Arabic catalogue, read once — several guards scan it. */
const CATALOGUE = RAW['/src/i18n/ar.ts'] ?? '';

/**
 * Comments cite the platform's history and must not be mistaken for code.
 *
 * `scheduling-parity.test.tsx` learned this the hard way: a guard that scans
 * source text and does not strip comments fails on the note explaining the very
 * rule it enforces.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('one Button', () => {
  /**
   * `data-table.tsx` renders the row-action buttons with the class list directly.
   * That is the **one** exemption and it is bounded: those buttons live inside
   * the shared table, so they cannot drift independently of it — there is no
   * second table to disagree with. It would be removed by having `DataTable`
   * compose `<Button variant="ghost">`, which is worth doing and is not this
   * slice's scope.
   */
  const ALLOWED = new Set(['components/ui/button.tsx', 'components/ui/data-table.tsx']);

  /**
   * **Both class vocabularies, because there were two.**
   *
   * The first sweep looked only for `btn` and passed — while ten call sites on the
   * registration, status and profile pages rendered `className="button primary"`,
   * a **complete second button system** with its own CSS block, its own padding
   * and no `ghost`, `danger` or `add` variant at all. A guard that knows one
   * spelling of the thing it forbids is a guard that certifies the other.
   *
   * The pattern excludes hyphenated compounds: `link-button` in
   * `consent-notice.tsx` is a **link inside a sentence**, a different concept
   * with a different element, and flagging it would be flagging correct code.
   */
  const HAND_ROLLED = /className=(["'{])[^"'}]*(?<![\w-])(btn|button)(?![\w-])/;

  it('nothing hand-writes a button class list', () => {
    const offenders = FILES.filter(
      (f) => !ALLOWED.has(f.path) && HAND_ROLLED.test(stripComments(f.text)),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('no stylesheet defines a second button system', () => {
    // The CSS half of the same rule. `.button` was the one that existed; asserting
    // its absence is what stops it being reintroduced by a page that needs "just
    // a link that looks like a button".
    const css = import.meta.glob('/src/styles/**/*.css', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    for (const [path, text] of Object.entries(css)) {
      if (path.endsWith('button.css')) continue;
      expect(text, path).not.toMatch(/^\.button\b/m);
    }
  });
});

describe('one add/create convention', () => {
  /**
   * **The `＋` belongs to `variant="add"` and to nothing else.**
   *
   * The inconsistency the Owner reported was one create button carrying the glyph
   * and the next one not. Both halves are guarded: a caller may not type the
   * glyph into a label (it would be a second convention), and the variant always
   * emits it (so adopting the variant is sufficient).
   *
   * `multi-select.tsx` adds an option to a selection with the same glyph, which
   * is the same *act* at a smaller scale; it is exempt because it is inside a
   * shared atomic component, which is where a convention is allowed to live.
   */
  const ALLOWED = new Set(['components/ui/button.tsx', 'components/ui/multi-select.tsx']);

  it('no source file writes the add glyph by hand', () => {
    const offenders = FILES.filter(
      (f) => !ALLOWED.has(f.path) && stripComments(f.text).includes(ADD_GLYPH),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('no catalogue string carries the add glyph', () => {
    // This is where it hid: `admin.enrollments.add` read «＋ تسجيل مستفيدة» while
    // six other create labels did not, so the convention was applied in the
    // translation file for exactly one screen.
    for (const line of stripComments(CATALOGUE).split('\n')) {
      expect(line, line.trim()).not.toContain(ADD_GLYPH);
    }
  });
});

describe('one table', () => {
  /**
   * **The exempt tables all hold live form controls in their cells**, bound to
   * per-row draft state that the reader edits before saving:
   *
   * | File | What is editable |
   * |---|---|
   * | `grading/grade-sheet.tsx` | the mark and the absence checkbox, per student |
   * | `pages/teacher/quran.tsx` | the log being corrected |
   * | `pages/admin/hijri-calendar.tsx` | each month's Gregorian start date |
   *
   * `DataTable`'s `Column.cell` *can* render an input, but its row model assumes
   * a row is a value to be read and acted on — not a form field with its own
   * dirty state, validation and save. Forcing these three through it would put
   * form state inside a presentation component, which §3.2 is explicit about.
   *
   * The exemption ends if the platform gains an editable-table primitive; three
   * screens is the point at which that becomes worth building, and this list is
   * the record that we are at three.
   */
  const ALLOWED = new Set([
    'components/ui/data-table.tsx',
    'components/grading/grade-sheet.tsx',
    'pages/teacher/quran.tsx',
    'pages/admin/hijri-calendar.tsx',
    /**
     * **The calendar month grid is a table, and not a list.**
     *
     * A month is genuinely tabular data — weekdays across, weeks down, and a
     * cell addressed by both — so `<table>` is the correct element and a screen
     * reader announces the row and column headers for each day because of it.
     * `DataTable` models *rows of records with actions*, which a month is not.
     * This is a different concept, not a second implementation of the same one,
     * so it is exempt permanently rather than pending work.
     */
    'components/calendar/calendar-grid.tsx',
  ]);

  it('nothing renders a table element outside the shared primitive', () => {
    const offenders = FILES.filter(
      (f) => !ALLOWED.has(f.path) && /<table\b/.test(stripComments(f.text)),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('one Level label', () => {
  /**
   * §4.4b: Level names are **not unique across Categories**, so a bare name does
   * not identify a Level. The format `{Category} — {Level}` therefore lives in
   * `levelLabel` and every Level selector and Level column goes through it.
   *
   * ## What is scanned for, and what is deliberately not
   *
   * The signal is **a selector option whose label is a Level's bare name** —
   * `label: level.name`, which is precisely what `calendar/level-selector.tsx`
   * and `pages/admin/groups.tsx` each had. A broader *"maps over levels"* scan
   * was tried first and flagged two legitimate call sites, which is worth
   * recording because both are the documented exception:
   *
   * * **`pages/resources.tsx`** renders Level *cards* under a `<h2>` naming their
   *   Category, so the Category is stated by the grouping — the prefix would
   *   repeat the heading immediately above it.
   * * **`pages/admin/approvals.tsx`** derives **Category** options from a Level
   *   list. Its labels are Category names; no Level is being labelled at all.
   *
   * A guard that fires on either would be a guard people learn to work around.
   */
  it('no selector labels a Level by its bare name', () => {
    const BARE = /label:\s*(level|l)\.name\b/;
    const offenders = FILES.filter(
      (f) => f.path !== 'components/scope/level-select.tsx' && BARE.test(stripComments(f.text)),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('the shared label is the only place the em-dash format is written', () => {
    // The format itself, so a second implementation of `{Category} — {Level}`
    // cannot appear beside the one that owns it.
    const offenders = FILES.filter(
      (f) =>
        f.path !== 'components/scope/level-select.tsx' &&
        /`\$\{[\w.]*category_name\}\s*—/.test(stripComments(f.text)),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('no engineering reference reaches a user-facing string', () => {
  /**
   * **The «66» the Owner could not identify.** `admin.enrollments.groupHint`
   * read *"…وهو تسجيل صحيح بعد المراجعة 66"* — an SRS revision number on a form
   * hint. A reader of that screen has no way to look it up, and it is the kind of
   * leak that arrives one string at a time.
   *
   * The scan covers **string values only**. Comments citing `§4.4c` or `R66` are
   * correct and load-bearing: they are how a maintainer finds the rule, and this
   * codebase's documentation depends on them.
   */
  const FORBIDDEN = [
    { pattern: /§\s*\d/, what: 'an SRS section reference' },
    { pattern: /\bTD-\d/, what: 'a TD- identifier' },
    { pattern: /\bBR-\d/, what: 'a BR- identifier' },
    { pattern: /\bR\d{2}\b/, what: 'a revision number' },
    { pattern: /مراجعة\s*\d/, what: 'a revision number in Arabic' },
  ];

  it('the Arabic catalogue exposes none', () => {
    for (const line of stripComments(CATALOGUE).split('\n')) {
      // Only the VALUE side of `key: 'value'` — a key named `refused_BR_21`
      // would be an identifier, not text anybody reads.
      const value = /:\s*(['"])([\s\S]*?)\1\s*,?\s*$/.exec(line)?.[2];
      if (value === undefined) continue;
      for (const { pattern, what } of FORBIDDEN) {
        expect(pattern.test(value), `${what} in: ${value}`).toBe(false);
      }
    }
  });
});

describe('no page gates its data behind a dropdown', () => {
  /**
   * **The rule:** a management page shows the data it manages immediately;
   * filters narrow it. The defect has recurred four times — `حلقات المواد` twice,
   * `نقاط الامتحانات`, and the roster's student picker — so it is guarded.
   *
   * ## The signal, and why it is the copy rather than the code
   *
   * A gate always leaves the same trace: **a string telling the reader to choose
   * something IN ORDER TO SEE something** — «اختاري امتحانًا **لعرض** ورقة
   * النقاط», «اختاري مستوى **لعرض** المواد». A page that renders its data has no
   * reason to write that sentence, and the sentence is far more stable than any
   * structural property of the component that shows it.
   *
   * **A field label is not a gate**, which is why the pattern requires the
   * purpose clause. `admin.enrollments.pickStudent` («اختاري المستفيدة») is a
   * form asking a question, and forms legitimately ask questions — an earlier,
   * looser version of this guard flagged it, and a guard that fires on a correct
   * label is a guard people learn to work around.
   */
  it('no catalogue string tells the reader to choose something in order to see data', () => {
    // «اختاري X لعرض Y» / «اختاري X لعرض تفاصيل Y» — choose, in order to display.
    const GATE = /اخت[اي]ر\S*\s+[^']*?\bلعرض\b/;
    const gates = stripComments(CATALOGUE)
      .split('\n')
      .filter((line) => GATE.test(line))
      .map((line) => line.trim());
    expect(gates).toEqual([]);
  });
});

describe('the grade sheet carries no pass/fail verdict', () => {
  /**
   * The Owner's decision of 2026-08-17: a mark is a fact, «راسبة» is a verdict
   * about a person, and the platform states the fact.
   *
   * **The model is untouched** — `Grade.passed`, `manual_pass_fail_override`,
   * BR-12 and `POST …/override` all remain and still decide retakes and
   * progression. This guards the *presentation*, which is a one-line regression:
   * re-adding two catalogue keys and one badge would restore it silently.
   */
  it('the catalogue holds no passed/failed strings under admin.grades', () => {
    const block = /grades:\s*\{([\s\S]*?)\n {4}\},/.exec(CATALOGUE)?.[1] ?? '';
    expect(block).not.toMatch(/^\s*passed:/m);
    expect(block).not.toMatch(/^\s*failed:/m);
  });

  it('the sheet component reads no passed/failed key', () => {
    const sheet = stripComments(RAW['/src/components/grading/grade-sheet.tsx'] ?? '');
    expect(sheet).not.toContain('admin.grades.passed');
    expect(sheet).not.toContain('admin.grades.failed');
  });
});

describe('the users page offers no account creation', () => {
  /**
   * The Owner's decision of 2026-08-17: an account comes into existence through
   * §4.1's registration and its approval. **`POST /admin/users` is untouched** —
   * it serves §4.1b's pre-provisioning — so what is guarded is that no *entry
   * point* reappears, here or anywhere else, which is what "do not create an
   * alternative account-creation UI elsewhere" means.
   */
  it('no source file calls the createUser adapter', () => {
    const offenders = FILES.filter(
      (f) => f.path !== 'adapters/users.ts' && /\bcreateUser\s*\(/.test(stripComments(f.text)),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('the account-creation strings are gone, not merely unreferenced', () => {
  /**
   * **A dead catalogue entry is not harmless.**
   *
   * Removing the button and the dialog left `admin.users.create` («إضافة حساب»)
   * in `ar.ts` — unrendered, but shipped in the bundle. A bundle probe found it
   * and read it as the control still being there; it was not, but the entry is
   * exactly what a future screen picks up and renders, which is how *"do not
   * create an alternative account-creation UI elsewhere"* gets defeated by
   * convenience rather than by disagreement.
   *
   * `POST /admin/users` and the `createUser` adapter remain — the capability is
   * §4.1b's pre-provisioning and is untouched. What is guarded is the absence of
   * an *entry point*, in code **and** in the catalogue.
   */
  const DEAD = ['create', 'created', 'emailHint', 'emailInvalid', 'noRole', 'createRoleHint'];

  it('no admin.users key exists for a create form', () => {
    const block = /users:\s*\{([\s\S]*?)\n {4}\},/.exec(CATALOGUE)?.[1] ?? '';
    expect(block.length).toBeGreaterThan(0);
    for (const key of DEAD) {
      expect(new RegExp(`^\\s+${key}:`, 'm').test(stripComments(block)), key).toBe(false);
    }
  });
});
