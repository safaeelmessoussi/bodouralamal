import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { HijriMonthRow, HijriYear } from '../../adapters/hijri-calendar.js';
import { MonthRow, summariseYear } from './hijri-calendar.js';

/**
 * `/superadmin/hijri-calendar` — the regression suite for a **blank white page**.
 *
 * **What happened.** The adapter's declared types named three fields the API has
 * never sent: `hijri_year`/`months`/`hijri_month_ar` against the real
 * `year`/`data`/`month_name_ar`. The page did `data?.months.filter(...)`; the
 * `?.` guarded `data` being null but not `months` being `undefined`, so
 * `.filter()` threw a TypeError, React unmounted the tree, and the screen went
 * blank with no error visible anywhere.
 *
 * **Why nothing caught it.** `api<T>()` is an **unchecked cast** — the generic
 * asserts a shape and nothing verifies it at runtime — so a wrong type compiles
 * perfectly and fails only in a browser. `curl` could never see it either: the
 * server's bytes were always correct.
 *
 * **The two guards, deliberately on both sides of the contract:**
 *
 * 1. **Server** — `hijri-calendar.http.integration.test.ts` pins the EXACT key
 *    set of the envelope and of a month row, so the API cannot drift silently.
 *    `toMatchObject` could not have caught this: it checks a subset and is blind
 *    to a field that is missing.
 * 2. **Client — this file.** `WIRE` below is written with the key set that test
 *    pins. Because it is typed as `HijriMonthRow`, **renaming a field in the
 *    adapter breaks the typecheck here**, which is the check the unchecked cast
 *    cannot perform. The render assertions then prove the page actually reads
 *    those names rather than merely accepting them.
 */

/**
 * One month row, keyed EXACTLY as `GET /admin/hijri-calendar?year=` returns it.
 *
 * Kept as an explicit literal rather than a factory: this is a **copy of the
 * wire contract**, and its value is that it is boring and legible next to the
 * server test that pins the same six keys.
 */
const WIRE: HijriMonthRow = {
  hijri_month: 1,
  month_name_ar: 'محرم',
  gregorian_start_date: '2026-06-17',
  status: 'published',
  version: 1,
  source: 'manual',
};

const month = (over: Partial<HijriMonthRow> = {}): HijriMonthRow => ({ ...WIRE, ...over });

/** A blank month — the Ministry has not announced it yet, so every value that
 *  depends on the announcement is null (Revision 31: no computed guess). */
const blank = (n: number): HijriMonthRow => ({
  hijri_month: n,
  month_name_ar: `شهر ${n}`,
  gregorian_start_date: null,
  status: null,
  version: null,
  source: null,
});

const year = (rows: HijriMonthRow[]): HijriYear => ({ year: 1448, data: rows });

describe('the wire shape the page reads', () => {
  it('the envelope is { year, data } — NOT { hijri_year, months }', () => {
    const y = year([WIRE]);
    // Written as an exact key set on purpose. A test that only read `y.data`
    // would still pass if someone re-added `months` alongside it, and two names
    // for one field is how the original defect survived review.
    expect(Object.keys(y).sort()).toEqual(['data', 'year']);
    expect(Object.keys(WIRE).sort()).toEqual([
      'gregorian_start_date',
      'hijri_month',
      'month_name_ar',
      'source',
      'status',
      'version',
    ]);
  });

  it('summariseYear survives a null year instead of throwing', () => {
    // The original crash was `.filter()` on undefined. Nothing the screen
    // derives may throw on an absent or empty payload — a screen that throws
    // during render has no error state, it just disappears.
    expect(summariseYear(null)).toEqual({ drafts: 0, recorded: [], lastRecorded: null });
    expect(summariseYear(year([]))).toEqual({ drafts: 0, recorded: [], lastRecorded: null });
  });
});

describe('summariseYear', () => {
  it('counts only draft months', () => {
    const { drafts } = summariseYear(
      year([
        month({ hijri_month: 1, status: 'published' }),
        month({ hijri_month: 2, status: 'draft' }),
        month({ hijri_month: 3, status: 'draft' }),
        blank(4),
      ]),
    );
    expect(drafts).toBe(2);
  });

  it('treats a month with no announcement as NOT recorded', () => {
    const { recorded } = summariseYear(
      year([month({ hijri_month: 1 }), blank(2), blank(3)]),
    );
    expect(recorded.map((m) => m.hijri_month)).toEqual([1]);
  });

  it('flags the LAST recorded month — the one that resolves only 29 days', () => {
    // This is the screen's single most useful warning: knowing when a month
    // began says nothing about when it ended, so the tail month is half-dark on
    // the public calendar until its successor is recorded (§4.4).
    const { lastRecorded } = summariseYear(
      year([
        month({ hijri_month: 1 }),
        month({ hijri_month: 2, gregorian_start_date: '2026-07-16' }),
        blank(3),
        blank(4),
      ]),
    );
    expect(lastRecorded?.hijri_month).toBe(2);
  });

  it('has no last-recorded month when nothing has been announced', () => {
    expect(summariseYear(year([blank(1), blank(2)])).lastRecorded).toBeNull();
  });
});

describe('MonthRow renders the contract’s field names', () => {
  const render = (m: HijriMonthRow, isLastRecorded = false): string =>
    renderToStaticMarkup(
      <table>
        <tbody>
          <MonthRow month={m} busy={false} isLastRecorded={isLastRecorded} onRecord={() => {}} />
        </tbody>
      </table>,
    );

  it('shows the month name from month_name_ar', () => {
    // The assertion that fails if anyone reverts to `hijri_month_ar`: the field
    // would be undefined and the name would simply vanish from the row.
    expect(render(WIRE)).toContain('محرم');
  });

  it('puts the month name in the row’s accessible label too', () => {
    expect(render(WIRE)).toContain('محرم');
    expect(render(WIRE)).toMatch(/aria-label="[^"]*محرم[^"]*"/u);
  });

  it('pre-fills the date input with the recorded start date', () => {
    expect(render(WIRE)).toContain('value="2026-06-17"');
  });

  it('renders an unannounced month as an empty input, never an invented date', () => {
    // §20 rule 14 / Revision 32: where the official answer is not yet known the
    // platform says nothing. A placeholder date here would look authoritative.
    const html = render(blank(5));
    expect(html).toContain('value=""');
    expect(html).not.toMatch(/value="\d{4}-\d{2}-\d{2}"/u);
  });

  it('marks the tail month so the half-dark month is explainable', () => {
    const html = render(WIRE, true);
    expect(html.length).toBeGreaterThan(render(WIRE, false).length);
  });
});
