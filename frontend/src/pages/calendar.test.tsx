import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CalendarDayCell } from '../components/calendar/calendar-day-cell.js';
import { CalendarGrid } from '../components/calendar/calendar-grid.js';
import { MonthSelector } from '../components/calendar/month-selector.js';
import { SelectedDayCard } from '../components/calendar/selected-day-card.js';
import { UpcomingEvents } from '../components/calendar/upcoming-events.js';
import type { Occurrence } from '../adapters/calendar.js';
import { leadingBlanks, monthGrid, toIsoDate } from '../lib/dates.js';

/**
 * The calendar's structure and its date arithmetic.
 *
 * The page itself fetches, so these cover the parts that decide what a visitor
 * actually sees: the grid's shape, the Monday week start (BR-17), and the
 * panels' empty states.
 */
const occurrence = (over: Partial<Occurrence> = {}): Occurrence => ({
  kind: 'group',
  id: 'g1',
  title: 'حلقة تحفيظ',
  date: '2026-06-15',
  start_time: '09:00',
  end_time: '10:30',
  visibility: null,
  branch_id: null,
  hijri_date: null,
  hijri_month_ar: null,
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
      today={new Date(2026, 5, 10)}
      selected={new Date(2026, 5, 15)}
      onSelect={() => undefined}
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
});

describe('a day cell', () => {
  it('is a button, so it is reachable by keyboard', () => {
    const html = renderToStaticMarkup(
      <CalendarDayCell
        date={new Date(2026, 5, 15)}
        occurrences={[occurrence()]}
        isToday={false}
        isSelected={false}
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('<button');
    // The number alone would be announced as a bare digit.
    expect(html).toContain('aria-label="2026-06-15');
  });

  it('renders padding as an inert cell, not a dead control', () => {
    const html = renderToStaticMarkup(
      <CalendarDayCell date={null} occurrences={[]} isToday={false} isSelected={false} onSelect={() => undefined} />,
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('aria-hidden="true"');
  });

  it('summarises overflow instead of overflowing the cell', () => {
    const many = [occurrence({ id: 'a' }), occurrence({ id: 'b' }), occurrence({ id: 'c' }), occurrence({ id: 'd' })];
    const html = renderToStaticMarkup(
      <CalendarDayCell date={new Date(2026, 5, 15)} occurrences={many} isToday={false} isSelected={false} onSelect={() => undefined} />,
    );
    expect(html).toContain('+2');
  });
});

describe('the side panels', () => {
  it('the selected day states its emptiness rather than showing nothing', () => {
    const html = renderToStaticMarkup(<SelectedDayCard date={new Date(2026, 5, 15)} occurrences={[]} />);
    expect(html).toContain('لا توجد أنشطة في هذا اليوم');
  });

  it('shows the Hijri overlay only when the backend supplied one (Revision 31)', () => {
    const without = renderToStaticMarkup(<SelectedDayCard date={new Date(2026, 5, 15)} occurrences={[occurrence()]} />);
    expect(without).not.toContain('1447');

    const withHijri = renderToStaticMarkup(
      <SelectedDayCard date={new Date(2026, 5, 15)} occurrences={[occurrence({ hijri_date: '1447-12-29' })]} />,
    );
    expect(withHijri).toContain('1447-12-29');
  });

  it('upcoming lists only what is still ahead', () => {
    const html = renderToStaticMarkup(
      <UpcomingEvents
        occurrences={[
          occurrence({ id: 'past', title: 'ماضٍ', date: '2026-06-01' }),
          occurrence({ id: 'future', title: 'قادم', date: '2026-06-20' }),
        ]}
        from="2026-06-10"
      />,
    );
    expect(html).toContain('قادم');
    expect(html).not.toContain('ماضٍ');
  });

  it('upcoming says so when there is nothing ahead', () => {
    const html = renderToStaticMarkup(<UpcomingEvents occurrences={[]} from="2026-06-10" />);
    expect(html).toContain('لا توجد أنشطة قادمة');
  });
});

describe('month navigation', () => {
  it('names the month and announces changes politely', () => {
    const html = renderToStaticMarkup(
      <MonthSelector month={new Date(2026, 5, 1)} onPrevious={() => undefined} onNext={() => undefined} onToday={() => undefined} />,
    );
    expect(html).toContain('يونيو 2026');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('اليوم');
    // Icon-only controls need names.
    expect(html).toContain('aria-label="الشهر السابق"');
    expect(html).toContain('aria-label="الشهر التالي"');
  });
});
