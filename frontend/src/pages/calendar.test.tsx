import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CalendarDayCell } from '../components/calendar/calendar-day-cell.js';
import { CalendarGrid } from '../components/calendar/calendar-grid.js';
import { CalendarTitle } from '../components/calendar/calendar-title.js';
import { CategorySelector } from '../components/calendar/category-selector.js';
import { DayEventsDialog } from '../components/calendar/day-events-dialog.js';
import { EventChip } from '../components/calendar/event-chip.js';
import { EventDetailsDialog } from '../components/calendar/event-details-dialog.js';
import { CalendarNav } from '../components/calendar/calendar-nav.js';
import { LevelSelector } from '../components/calendar/level-selector.js';
import type { HijriDay, Occurrence, PrefilledFilters } from '../adapters/calendar.js';
import { tList } from '../i18n/index.js';
import { leadingBlanks, monthGrid, toIsoDate } from '../lib/dates.js';
import CALENDAR_PAGE_SOURCE from './calendar.tsx?raw';

/**
 * The calendar's structure, its date arithmetic, and the rules that would fail
 * silently if broken.
 *
 * The page itself fetches, so these cover what a visitor actually sees: the
 * grid's shape, the Monday week start (BR-17), the dual-calendar rendering, and
 * — most importantly — that **no Hijri value is ever invented** when the backend
 * did not supply one (Revision 31, §20 rule 14).
 */
const occurrence = (over: Partial<Occurrence> = {}): Occurrence => ({
  kind: 'session',
  id: 'g1',
  title: 'حلقة تحفيظ',
  date: '2026-06-15',
  start_time: '09:00',
  end_time: '10:30',
  // R97 — a session carries a delivery; an Event and an Exam send null.
  delivery_mode: 'in_person',
  online_media_mode: null,
  visibility: null,
  branch_id: null,
  description: null,
  recurrence: null,
  branch_name: null,
  room_name: null,
  category_id: null,
  category_name: null,
  level_id: null,
  level_name: null,
  // Revision 43 session fields. The factory carries them so the fixture is a
  // real occurrence rather than a subset that happens to compile.
  subject_id: null,
  subject_name: null,
  teaching_mode: null,
  audience_label: null,
  status: null,
  instructors: [],
  hijri_date: null,
  hijri_month_ar: null,
  ...over,
});

const hijriDay = (over: Partial<HijriDay> = {}): HijriDay => ({
  date: '2026-06-15',
  hijri_date: '1447-12-29',
  hijri_day: 29,
  hijri_month: 12,
  hijri_month_ar: 'ذو الحجة',
  hijri_year: 1447,
  ...over,
});

describe('date arithmetic (TD-11, BR-17)', () => {
  it('formats a local date without crossing a timezone boundary', () => {
    // `toISOString()` here would shift the day for anyone east of UTC.
    expect(toIsoDate(new Date(2026, 5, 1))).toBe('2026-06-01');
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('starts weeks on Monday', () => {
    // 1 June 2026 is a Monday → no leading blanks.
    expect(leadingBlanks(new Date(2026, 5, 1))).toBe(0);
    // 1 July 2026 is a Wednesday → Monday, Tuesday blank.
    expect(leadingBlanks(new Date(2026, 6, 1))).toBe(2);
    // 1 November 2026 is a Sunday → the last column, so six blanks precede it.
    expect(leadingBlanks(new Date(2026, 10, 1))).toBe(6);
  });

  it('produces whole weeks, with padding as null rather than neighbouring days', () => {
    for (const month of [new Date(2026, 5, 1), new Date(2026, 1, 1), new Date(2026, 10, 1)]) {
      const cells = monthGrid(month);
      expect(cells.length % 7).toBe(0);
      expect(cells.filter((c) => c !== null).length).toBe(
        new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
      );
    }
  });
});

describe('the month grid renders', () => {
  const html = renderToStaticMarkup(
    <CalendarGrid
      month={new Date(2026, 5, 1)}
      byDate={new Map([['2026-06-15', [occurrence()]]])}
      hijriByDate={new Map([['2026-06-15', hijriDay()]])}
      today={new Date(2026, 5, 10)}
      selected={new Date(2026, 5, 15)}
      onSelect={() => undefined}
      onOpenEvent={() => undefined}
    />,
  );

  it('labels the columns Monday-first', () => {
    expect(html.indexOf('الاثنين')).toBeGreaterThan(-1);
    // Sunday is the LAST column, not the first.
    expect(html.indexOf('الأحد')).toBeGreaterThan(html.indexOf('الاثنين'));
  });

  it('is a real grid for assistive technology', () => {
    expect(html).toContain('role="grid"');
    expect(html).toContain('role="gridcell"');
    expect(html).toContain('scope="col"');
  });

  it('places the occurrence on its own day and nowhere else', () => {
    expect(html).toContain('حلقة تحفيظ');
    expect(html.split('حلقة تحفيظ').length - 1).toBe(1);
  });

  it('marks today and the selection distinctly', () => {
    expect(html).toContain('is-today');
    expect(html).toContain('is-selected');
  });

  it('shows the Hijri day only on the day the backend supplied one for', () => {
    // One cell has a recorded Hijri day; the other 29 do not, and must not
    // acquire one by computation.
    expect(html.split('cal-day__hijri"').length - 1).toBe(1);
  });
});

describe('a day cell carries both calendars', () => {
  const withBoth = renderToStaticMarkup(
    <CalendarDayCell
      date={new Date(2026, 5, 15)}
      hijri={hijriDay()}
      occurrences={[occurrence()]}
      isToday={false}
      isSelected={false}
      onSelect={() => undefined}
      onOpenEvent={() => undefined}
    />,
  );

  it('is a button, so it is reachable by keyboard', () => {
    expect(withBoth).toContain('<button');
    // The two numerals alone would be announced as bare digits.
    expect(withBoth).toContain('aria-label="2026-06-15');
  });

  it('shows the Gregorian and the Hijri day number', () => {
    expect(withBoth).toContain('cal-day__gregorian');
    expect(withBoth).toContain('cal-day__hijri');
    expect(withBoth).toContain('>15<');
    expect(withBoth).toContain('>29<');
  });

  it('pins Hijri first/left and Gregorian second/right inside the RTL calendar', () => {
    expect(withBoth.indexOf('cal-day__hijri')).toBeLessThan(
      withBoth.indexOf('cal-day__gregorian'),
    );
    expect(withBoth).toContain('class="cal-day__select" dir="ltr"');
  });

  it('renders NO Hijri number when the month is not recorded (Revision 31)', () => {
    const html = renderToStaticMarkup(
      <CalendarDayCell
        date={new Date(2026, 5, 15)}
        hijri={null}
        occurrences={[]}
        isToday={false}
        isSelected={false}
        onSelect={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    // The slot is reserved for layout, but it is EMPTY — never a computed guess
    // and never a placeholder dash.
    expect(html).toContain('cal-day__hijri--absent');
    expect(html).not.toMatch(/cal-day__hijri"[^>]*>\d/);
  });

  it('renders padding as an inert cell, not a dead control', () => {
    const html = renderToStaticMarkup(
      <CalendarDayCell
        date={null}
        hijri={null}
        occurrences={[]}
        isToday={false}
        isSelected={false}
        onSelect={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('aria-hidden="true"');
  });

  it('lists every occurrence rather than truncating at a fixed count', () => {
    // The cells scroll now, so "how many fit" is a height question. A cap would
    // hide activities the taller cells were introduced to show.
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => occurrence({ id }));
    const html = renderToStaticMarkup(
      <CalendarDayCell
        date={new Date(2026, 5, 15)}
        hijri={null}
        occurrences={many}
        isToday={false}
        isSelected={false}
        onSelect={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    expect(html.split('event-chip__title').length - 1).toBe(7);
    expect(html).not.toContain('cal-day__more');
  });
});

describe('the public calendar preserves the authenticated visibility tier', () => {
  it('passes the current access token to the optional-auth calendar read', () => {
    expect(CALENDAR_PAGE_SOURCE).toContain('const { accessToken } = useSession()');
    expect(CALENDAR_PAGE_SOURCE).toMatch(/fetchOccurrences\(\{[\s\S]*?token: accessToken,/);
    expect(CALENDAR_PAGE_SOURCE).toContain('filters.value.type, accessToken]');
  });
});

describe('the dual-calendar title', () => {
  const JUNE = new Date(2026, 5, 1);

  it('renders Gregorian then Hijri, so RTL puts Gregorian on the right', () => {
    const html = renderToStaticMarkup(
      <CalendarTitle
        gregorianMonths={[{ month: 7, month_ar: 'يوليوز', year: 2026 }]}
        hijriMonths={[{ hijri_month: 1, hijri_month_ar: 'محرم', hijri_year: 1448 }]}
        month={JUNE}
      />,
    );
    expect(html.indexOf('cal-title__gregorian')).toBeLessThan(html.indexOf('cal-title__hijri'));
    expect(html).toContain('يوليوز 2026');
    expect(html).toContain('محرم 1448');
  });

  it('announces month changes, now that no control names the month', () => {
    const html = renderToStaticMarkup(
      <CalendarTitle
        gregorianMonths={[{ month: 7, month_ar: 'يوليوز', year: 2026 }]}
        hijriMonths={[]}
        month={JUNE}
      />,
    );
    // The removed month selector used to carry this; losing it would have made
    // keyboard navigation silent.
    expect(html).toContain('aria-live="polite"');
  });

  it('shows BOTH Hijri months when the Gregorian month spans two', () => {
    const html = renderToStaticMarkup(
      <CalendarTitle
        gregorianMonths={[{ month: 7, month_ar: 'يوليوز', year: 2026 }]}
        hijriMonths={[
          { hijri_month: 12, hijri_month_ar: 'ذو الحجة', hijri_year: 1448 },
          { hijri_month: 1, hijri_month_ar: 'محرم', hijri_year: 1448 },
        ]}
        month={JUNE}
      />,
    );
    expect(html).toContain('ذو الحجة / محرم 1448');
  });

  it('prints the year twice only when the two months differ in year', () => {
    const html = renderToStaticMarkup(
      <CalendarTitle
        gregorianMonths={[
          { month: 12, month_ar: 'دجنبر', year: 2026 },
          { month: 1, month_ar: 'يناير', year: 2027 },
        ]}
        hijriMonths={[]}
        month={JUNE}
      />,
    );
    expect(html).toContain('دجنبر 2026 / يناير 2027');
  });

  it('omits the Hijri side entirely when no month is recorded (Revision 31)', () => {
    const html = renderToStaticMarkup(
      <CalendarTitle
        gregorianMonths={[{ month: 7, month_ar: 'يوليوز', year: 2026 }]}
        hijriMonths={[]}
        month={JUNE}
      />,
    );
    expect(html).not.toContain('cal-title__hijri');
    // No orphaned divider either.
    expect(html).not.toContain('cal-title__divider');
  });

  it('falls back to the displayed month for the GREGORIAN side only', () => {
    // The chrome fetch can fail; the page must not lose its own heading. The
    // month on screen is client state, so naming it is not a computation.
    const html = renderToStaticMarkup(
      <CalendarTitle gregorianMonths={[]} hijriMonths={[]} month={JUNE} />,
    );
    expect(html).toContain('يونيو 2026');
  });

  it('has NO Hijri fallback — silence is the rule (Revision 31, §20 rule 14)', () => {
    const html = renderToStaticMarkup(
      <CalendarTitle gregorianMonths={[]} hijriMonths={[]} month={JUNE} />,
    );
    expect(html).not.toContain('cal-title__hijri');
  });
});

describe('the category and level filters', () => {
  it('renders categories from the backend, never a hardcoded list (§4.4b)', () => {
    const html = renderToStaticMarkup(
      <CategorySelector
        categories={[
          { id: 'c1', name: 'الكبار', display_order: 1 },
          { id: 'c2', name: 'اليافعون', display_order: 2 },
          { id: 'c3', name: 'الطفل', display_order: 3 },
        ]}
        value={null}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('الكبار');
    expect(html).toContain('اليافعون');
    expect(html).toContain('الطفل');
    expect(html).toContain('كل الفئات');
  });

  it('disables the level select while the narrowed list is in flight', () => {
    const html = renderToStaticMarkup(
      <LevelSelector
        levels={[]}
        categories={[]}
        value={null}
        busy={true}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
  });

  it('renders exactly the levels it was given — it does no filtering of its own', () => {
    // §4.4: the narrowing is server-side, "so the client never filters a list it
    // was handed". `categories` is passed for the LABEL only and never narrows
    // the list, which is what the option count asserts: two levels in, two
    // levels out, whatever the Category list contains.
    const html = renderToStaticMarkup(
      <LevelSelector
        levels={[
          { id: 'l1', name: 'المستوى 1', category_id: 'c1', display_order: 1 },
          { id: 'l2', name: 'المستوى 2', category_id: 'c1', display_order: 2 },
        ]}
        categories={[
          { id: 'c1', name: 'المرأة', display_order: 1 },
          // A Category with no Levels in the list, and a Level whose Category is
          // absent below: neither may add or remove an option.
          { id: 'c9', name: 'اليافعات', display_order: 2 },
        ]}
        value={null}
        busy={false}
        onChange={() => undefined}
      />,
    );
    expect(html.split('<option').length - 1).toBe(3); // "all" + two levels
  });

  it('labels each level {Category} — {Level}, the one platform format', () => {
    // §4.4b: Level names are not unique across Categories, so a bare name does
    // not identify one. This selector rendered bare names while every other
    // selector rendered the pair — the same Level read differently depending on
    // which screen you met it on (fixed 2026-08-17).
    const html = renderToStaticMarkup(
      <LevelSelector
        levels={[
          { id: 'l1', name: 'فرصة أمل', category_id: 'c1', display_order: 1 },
          { id: 'l2', name: 'فرصة أمل', category_id: 'c2', display_order: 1 },
        ]}
        categories={[
          { id: 'c1', name: 'المرأة', display_order: 1 },
          { id: 'c2', name: 'اليافعات', display_order: 2 },
        ]}
        value={null}
        busy={false}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('المرأة — فرصة أمل');
    expect(html).toContain('اليافعات — فرصة أمل');
  });

  it('degrades to the bare name when the Category is not in the list', () => {
    // A missing Category must not render a dangling em dash with nothing before
    // it — `levelLabel`'s own rule, asserted through its caller.
    const html = renderToStaticMarkup(
      <LevelSelector
        levels={[{ id: 'l1', name: 'فرصة أمل', category_id: 'c-unknown', display_order: 1 }]}
        categories={[]}
        value={null}
        busy={false}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('فرصة أمل');
    expect(html).not.toContain('— فرصة أمل');
  });
});

describe('the day dialog', () => {
  it('renders nothing until a day is chosen', () => {
    const html = renderToStaticMarkup(
      <DayEventsDialog
        date={null}
        hijri={null}
        occurrences={[occurrence()]}
        onClose={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    expect(html).not.toContain('حلقة تحفيظ');
  });

  it('lists every activity of the day in full, not collapsed', () => {
    const html = renderToStaticMarkup(
      <DayEventsDialog
        date={new Date(2026, 5, 15)}
        hijri={hijriDay()}
        occurrences={[occurrence({ id: 'a' }), occurrence({ id: 'b', title: 'درس تفسير' })]}
        onClose={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    expect(html).toContain('حلقة تحفيظ');
    expect(html).toContain('درس تفسير');
    expect(html.split('cal-dayrow__title').length - 1).toBe(2);
  });

  it('states emptiness rather than showing nothing', () => {
    const html = renderToStaticMarkup(
      <DayEventsDialog
        date={new Date(2026, 5, 15)}
        hijri={null}
        occurrences={[]}
        onClose={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    expect(html).toContain('لا توجد أنشطة في هذا اليوم');
  });

  it('shows the Hijri date only when recorded (Revision 31)', () => {
    const withHijri = renderToStaticMarkup(
      <DayEventsDialog
        date={new Date(2026, 5, 15)}
        hijri={hijriDay()}
        occurrences={[]}
        onClose={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    expect(withHijri).toContain('ذو الحجة');

    const without = renderToStaticMarkup(
      <DayEventsDialog
        date={new Date(2026, 5, 15)}
        hijri={null}
        occurrences={[]}
        onClose={() => undefined}
        onOpenEvent={() => undefined}
      />,
    );
    expect(without).not.toContain('cal-daydialog__hijri');
  });
});

describe('month navigation', () => {
  const html = renderToStaticMarkup(
    <CalendarNav
      onPrevious={() => undefined}
      onToday={() => undefined}
      onNext={() => undefined}
    />,
  );

  it('is exactly three buttons', () => {
    expect(html.split('<button').length - 1).toBe(3);
  });

  it('shows the short labels the design calls for', () => {
    expect(html).toContain('>السابق<');
    expect(html).toContain('>اليوم<');
    expect(html).toContain('>التالي<');
  });

  it('orders them previous · today · next in source, so RTL reads right to left', () => {
    expect(html.indexOf('السابق')).toBeLessThan(html.indexOf('اليوم'));
    expect(html.indexOf('اليوم')).toBeLessThan(html.indexOf('التالي'));
  });

  it('emphasises exactly one of the three, and «اليوم» is it', () => {
    // **Restated 2026-08-18, not deleted.** The property is *one emphasis, not
    // three* — it was pinned to `btn--primary` because that was how the emphasis
    // happened to be spelled. The three buttons are now one compact segmented
    // group, so the emphasis is a modifier on an otherwise uniform row; the
    // property it was written for is unchanged and still asserted.
    expect(html.split('is-emphasis').length - 1).toBe(1);
    expect(html.indexOf('is-emphasis')).toBeGreaterThan(html.indexOf('السابق'));
    expect(html.indexOf('is-emphasis')).toBeLessThan(html.indexOf('التالي'));
    // And no button in the group is a call to action any more.
    expect(html).not.toContain('btn--primary');
  });

  it('is one segmented control rather than three loose buttons', () => {
    // The complaint this answers: five large scattered CTAs on a calendar page.
    // The grouping is the fix, so the grouping is what is guarded.
    expect(html).toContain('class="cal-segmented"');
    expect(html.split('btn--ghost').length - 1).toBe(3);
  });

  it('carries accessible names that CONTAIN the visible label (WCAG 2.5.3)', () => {
    // "previous" alone is ambiguous when announced out of context, but the long
    // name must contain the short one or voice control breaks.
    expect(html).toContain('aria-label="الشهر السابق"');
    expect(html).toContain('aria-label="الشهر التالي"');
    expect('الشهر السابق').toContain('السابق');
    expect('الشهر التالي').toContain('التالي');
  });

  it('is a labelled navigation landmark', () => {
    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="تنقّل بين الأشهر"');
  });

  it('does NOT name the month — that belongs to the title alone', () => {
    // The removed month selector carried its own copy of the Gregorian month
    // beside the title's; two renderings of one fact is the duplication this
    // project removes rather than syncs.
    for (const name of tList('calendar.months')) expect(html).not.toContain(name);
  });
});

describe('event details', () => {
  it('an event chip is a button, so focus can return to it', () => {
    const html = renderToStaticMarkup(
      <EventChip occurrence={occurrence()} onOpen={() => undefined} />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('عرض التفاصيل');
  });

  it('a chip with no handler is inert text, not a dead control', () => {
    const html = renderToStaticMarkup(<EventChip occurrence={occurrence()} />);
    expect(html).not.toContain('<button');
  });

  it('leads with the title and puts the time after it', () => {
    const html = renderToStaticMarkup(<EventChip occurrence={occurrence()} />);
    expect(html.indexOf('event-chip__title')).toBeLessThan(html.indexOf('event-chip__time'));
  });

  it('the dialog renders nothing until an event is chosen', () => {
    const html = renderToStaticMarkup(
      <EventDetailsDialog occurrence={null} branchNames={new Map()} onClose={() => undefined} />,
    );
    // The element exists (the native dialog must be in the DOM to be opened)
    // but carries no event content.
    expect(html).not.toContain('حلقة تحفيظ');
  });

  it('labels every field the backend supplied, and omits the rest', () => {
    const html = renderToStaticMarkup(
      <EventDetailsDialog
        occurrence={occurrence({
          visibility: 'public',
          hijri_date: '1447-12-29',
          description: 'حلقة أسبوعية لحفظ جزء البقرة.',
          recurrence: 'weekly',
          branch_name: 'مقر أمرشيش',
          room_name: 'القاعة 2',
          category_name: 'الكبار',
          level_name: 'المستوى 3',
          instructors: [{ id: 'u1', display_name: 'أم عبد الله' }],
        })}
        branchNames={new Map()}
        onClose={() => undefined}
      />,
    );
    for (const label of [
      'التاريخ',
      'التوقيت',
      'النوع',
      'التكرار',
      'الفئة',
      'المستوى',
      'الفرع',
      'القاعة',
      'المؤطِّرات',
      'مستوى الظهور',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('حلقة أسبوعية لحفظ جزء البقرة.');
    expect(html).toContain('أسبوعي');
    expect(html).toContain('القاعة 2');
    expect(html).toContain('أم عبد الله');
    expect(html).toContain('<dl');
  });

  it('renders the instructor display name VERBATIM (§20 rule 21)', () => {
    // The type carries no other name field, so there is nothing here to choose
    // between — the backend already decided which name is public.
    const html = renderToStaticMarkup(
      <EventDetailsDialog
        occurrence={occurrence({ instructors: [{ id: 'u1', display_name: 'أم عبد الله' }] })}
        branchNames={new Map()}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('أم عبد الله');
  });

  it('omits recurrence entirely when it is `none`', () => {
    // Every event carries `none` by default; printing it on all of them is noise.
    const html = renderToStaticMarkup(
      <EventDetailsDialog
        occurrence={occurrence({ recurrence: 'none' })}
        branchNames={new Map()}
        onClose={() => undefined}
      />,
    );
    expect(html).not.toContain('التكرار');
  });

  it('falls back to the raw value for a recurrence it does not know', () => {
    // A pattern added server-side must be visible, not invisible.
    const html = renderToStaticMarkup(
      <EventDetailsDialog
        occurrence={occurrence({ recurrence: 'quarterly' })}
        branchNames={new Map()}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('quarterly');
  });

  it('omits the Hijri line when the backend supplied none (Revision 31)', () => {
    const html = renderToStaticMarkup(
      <EventDetailsDialog occurrence={occurrence()} branchNames={new Map()} onClose={() => undefined} />,
    );
    expect(html).not.toContain('details__hijri');
  });
});

/* ── prefilled_filters (TD-3.4, R43) ─────────────────────────────────────── */

describe('prefilled_filters is a suggestion, never a scope', () => {
  it('is null for an anonymous caller, not an object of nulls', () => {
    // "There is nothing to prefill" and "nothing was unambiguous" are different
    // answers; an object of nulls would conflate them, and the page uses the
    // null to decide whether to prefill at all.
    const anonymous: PrefilledFilters | null = null;
    expect(anonymous).toBeNull();
  });

  it('carries the same keys as the filter set it prefills', () => {
    // The point of the contract: a client can apply it directly. A key here
    // that no filter accepts would be a suggestion nothing could act on.
    const prefilled: PrefilledFilters = {
      academic_year_id: null,
      category_id: 'c1',
      level_id: null,
      branch_id: 'b1',
      subject_id: null,
      teacher_id: null,
    };
    expect(Object.keys(prefilled).sort()).toEqual([
      'academic_year_id',
      'branch_id',
      'category_id',
      'level_id',
      'subject_id',
      'teacher_id',
    ]);
    // A plural profile yields null rather than an arbitrary first choice —
    // opening a student's calendar on one of three enrolled Levels would show a
    // third of their timetable while looking like all of it.
    expect(prefilled.level_id).toBeNull();
  });
});
