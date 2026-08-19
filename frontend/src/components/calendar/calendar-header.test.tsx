import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CalendarHeader } from './calendar-header.js';

/**
 * The header's *structure*; its geometry is measured in Chrome
 * (`verify-calendar-header.mjs`), because centred is a fact about boxes.
 *
 * What matters here is the rule that lets one component serve a surface with a
 * month and one without: the shape follows the DATA, not a per-caller flag.
 */
const render = (props: Parameters<typeof CalendarHeader>[0]): string =>
  renderToStaticMarkup(<CalendarHeader {...props} />);

const base = {
  view: 'calendar' as const,
  onView: () => undefined,
  month: new Date(Date.UTC(2026, 7, 1)),
  onPrevious: () => undefined,
  onToday: () => undefined,
  onNext: () => undefined,
};

describe('CalendarHeader', () => {
  it('renders the three regions in RTL source order: switch, title, stepping', () => {
    const html = render(base);
    expect(html.indexOf('cal-header__start')).toBeLessThan(html.indexOf('cal-header__centre'));
    expect(html.indexOf('cal-header__centre')).toBeLessThan(html.indexOf('cal-header__end'));
  });

  /**
   * **Restated by R84, and the premise is what changed.**
   *
   * This asserted the stepping is absent in the LIST view, on the reasoning
   * that *a month step means nothing* there. True of the back office's list —
   * which shows every matching definition and passes no month — and false of
   * every other one: the public, beneficiary and مؤطرة lists are *this month's
   * occurrences*, and stepping is how a reader moves through them.
   *
   * So the property is now stated where it actually lives: **the stepping
   * follows the month**, and a surface that is not month-scoped withholds the
   * month itself. The test below already asserts that half.
   */
  it('keeps the month stepping in the list view when the list IS month-scoped', () => {
    const html = render({ ...base, view: 'list' });
    expect(html).toContain('تنقّل بين الأشهر');
    expect(html).toContain('cal-header__start');
  });

  it('omits BOTH the title and the stepping when the surface has no month', () => {
    // The back office's list is a table of recurring schedules, not a month.
    // Naming a month above it would assert a scope the list does not have.
    const html = render({ view: 'list', onView: () => undefined });
    expect(html).not.toContain('cal-title');
    expect(html).not.toContain('cal-segmented" aria-label="تنقّل');
  });

  it('omits the filter row entirely when a surface has none', () => {
    // Not an empty row: an empty group states that filters exist and are blank.
    expect(render(base)).not.toContain('cal-header__filters');
    expect(render({ ...base, filters: <span>x</span> })).toContain('cal-header__filters');
  });

  it('renders the dual title through CalendarTitle, doing no date work itself', () => {
    const html = render({
      ...base,
      gregorianMonths: [{ month: 8, month_ar: 'غشت', year: 2026 }],
      hijriMonths: [{ hijri_month: 2, hijri_month_ar: 'صفر', hijri_year: 1448 }],
    });
    expect(html).toContain('غشت 2026');
    expect(html).toContain('صفر 1448');
  });
});
