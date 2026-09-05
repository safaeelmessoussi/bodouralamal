import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Button } from './button.js';
import { t, tList } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import {
  addDays,
  addMonths,
  addMonthsClamped,
  addYearsClamped,
  endOfMonth,
  isSameDay,
  monthGrid,
  parseIsoDate,
  startOfWeek,
  toIsoDate,
} from '../../lib/dates.js';

/**
 * **The platform's one date picker** — replacing every native
 * `<input type="date">`.
 *
 * ## Why the native control is gone, not merely dressed up
 *
 * `field.tsx` used to keep it deliberately, for a real reason: *"a native
 * `type="date"` gives the platform's own calendar, keyboard entry and locale
 * formatting for free… replacing it would cost the mobile keyboard and the
 * keyboard/screen-reader behaviour that comes with it — a bad trade for a
 * placeholder."* That trade was accepted anyway by Owner decision (2026-09-05):
 * the native control renders its popup and its `mm/dd/yyyy` placeholder in the
 * BROWSER's locale, which no page attribute can touch, and a platform that is
 * Arabic everywhere else showed an English date shape at the one place a
 * person enters her own birth date. This component is what pays for that
 * decision properly — real keyboard support and a real Arabic grid, not a
 * placeholder patched over a control we do not otherwise control.
 *
 * ## Two pieces, one atomic component
 *
 * `DatePicker` is the bare control — a trigger button and, once opened, a
 * calendar. `DateField` in `field.tsx` is `DatePicker` wrapped in the shared
 * `FieldShell` (label, hint, error) and is what every labelled form uses; this
 * is exported for the one place that has no visible label of its own — a table
 * cell naming itself via `aria-label`, the same shape its native predecessor
 * used there.
 *
 * ## Why a click-through grid and not a typed/segmented input
 *
 * A day/month/year is chosen, never typed. Building three synchronised text
 * segments (auto-advance, backspace-to-previous, per-month day limits, paste of
 * a whole date) is a second date parser this platform would then have to keep
 * correct forever, for a control whose entire job is to make typing
 * unnecessary. The Arabic placeholder ("يوم / شهر / سنة") states the format so
 * the reader is never guessing; choosing is what actually enters it.
 *
 * ## Easy year selection, without a decade of month clicks
 *
 * The header is one drill-down control: in day view it reads the month and
 * year and opens the MONTH grid; in month view it reads the year alone and
 * opens the YEAR grid. Reaching a birth year decades back is open → year →
 * month → day — four clicks regardless of how far back, never a chain of
 * "previous month".
 *
 * ## Inline, not floating
 *
 * The calendar expands in normal document flow below the trigger — the same
 * shape `SearchableSelect` and `MultiSelectField` already use for "a field with
 * more underneath it" — rather than an absolutely-positioned popover. This
 * platform has never built floating-panel positioning/clipping logic
 * (`SearchableSelect`'s own docstring says so), and an inline panel cannot be
 * clipped by a dialog's `overflow-y: auto` body the way a floating one could.
 * It also means the layout below the field simply moves down, which is exactly
 * what already happens when a hint or an error appears.
 *
 * ## The value is unchanged
 *
 * Selecting a day computes `YYYY-MM-DD` from local date parts through the same
 * `toIsoDate` every other calendar surface uses (TD-11) — never
 * `toISOString`, which is UTC and can shift the date near midnight. Nothing
 * about what is stored, sent, or validated changes; only how it is chosen.
 */

export interface DatePickerProps {
  /** `''` or `YYYY-MM-DD` — the same representation the native control used. */
  value: string;
  onChange: (value: string) => void;
  /** Supplied by `FieldShell` so the wrapping `<label htmlFor>` targets the
   *  trigger exactly as it targeted the native input. A bare `DatePicker` with
   *  no visible label may omit it and pass `ariaLabel` instead. */
  id?: string;
  /** For the one bare usage with no visible `<label>` (a table cell). Never
   *  pass this alongside `id` from `FieldShell` — `aria-label` would outrank
   *  the `<label for>` association and silently disconnect the visible text. */
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  /** Native bounds are gone with the native control; a day/month/year outside
   *  `[min, max]` is greyed out and unpickable here instead — the same
   *  courtesy, not validation (the caller's `error` still does that job). */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
}

type Mode = 'days' | 'months' | 'years';

/** 4 columns × 3 rows — short enough to read as one glance, long enough that
 *  paging by a page (below) crosses a decade in three presses. */
const YEARS_PER_PAGE = 12;
const YEARS_COLUMNS = 4;
const MONTHS_COLUMNS = 3;

/** The page-start that contains `year`, keeping pages aligned to a fixed grid
 *  (…, -12, 0, 12, 24, …) so paging is stable regardless of where a person
 *  entered the sequence from. */
function pageStartFor(year: number): number {
  return Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
}

/** A day is unpickable once its OWN date falls outside `[min, max]`. String
 *  comparison is exact for `YYYY-MM-DD` — lexicographic order already IS
 *  chronological order for a zero-padded ISO date, so no `Date` parsing is
 *  needed for this check at all. */
export function dayDisabled(iso: string, min?: string, max?: string): boolean {
  return (min !== undefined && iso < min) || (max !== undefined && iso > max);
}

/** A month is unpickable only once its WHOLE span is outside range — its last
 *  day before `min`, or its first day after `max`. A month straddling the
 *  boundary stays pickable; the day grid is what narrows it from there. */
export function monthDisabled(year: number, month: number, min?: string, max?: string): boolean {
  const first = toIsoDate(new Date(year, month, 1));
  const last = toIsoDate(endOfMonth(new Date(year, month, 1)));
  return (max !== undefined && first > max) || (min !== undefined && last < min);
}

/** Same rule, one calendar year wide. */
export function yearDisabled(year: number, min?: string, max?: string): boolean {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  return (max !== undefined && first > max) || (min !== undefined && last < min);
}

export function DatePicker({
  value,
  onChange,
  id,
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid,
  min,
  max,
  required = false,
  disabled = false,
}: DatePickerProps): ReactNode {
  const generatedId = useId();
  const baseId = id ?? generatedId;

  const selected = useMemo(() => parseIsoDate(value), [value]);
  const today = useMemo(() => new Date(), []);
  const anchor = selected ?? today;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('days');
  const [viewYear, setViewYear] = useState(() => anchor.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => anchor.getMonth());
  const [yearsStart, setYearsStart] = useState(() => pageStartFor(anchor.getFullYear()));

  const [focusIso, setFocusIso] = useState<string>(() => toIsoDate(anchor));
  const [focusMonth, setFocusMonth] = useState<number>(() => anchor.getMonth());
  const [focusYear, setFocusYear] = useState<number>(() => anchor.getFullYear());

  const containerRef = useRef<HTMLDivElement>(null);
  const pendingFocusId = useRef<string | null>(null);

  const dayCellId = (iso: string): string => `${baseId}-d-${iso}`;
  const monthCellId = (m: number): string => `${baseId}-m-${m}`;
  const yearCellId = (y: number): string => `${baseId}-y-${y}`;

  // Moves real DOM focus to whichever cell keyboard navigation just targeted.
  // Runs after the commit that rendered it, which is the one moment its id is
  // guaranteed to exist.
  useEffect(() => {
    if (pendingFocusId.current === null) return;
    document.getElementById(pendingFocusId.current)?.focus();
    pendingFocusId.current = null;
  });

  function openAt(nextMode: Mode): void {
    const base = selected ?? today;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setYearsStart(pageStartFor(base.getFullYear()));
    setFocusIso(toIsoDate(base));
    setFocusMonth(base.getMonth());
    setFocusYear(base.getFullYear());
    setMode(nextMode);
    setOpen(true);
    pendingFocusId.current =
      nextMode === 'days'
        ? dayCellId(toIsoDate(base))
        : nextMode === 'months'
          ? monthCellId(base.getMonth())
          : yearCellId(base.getFullYear());
  }

  function close(refocusTrigger: boolean): void {
    setOpen(false);
    // **By id, like every cell** — `Button` is a plain function component, not
    // `forwardRef`, so a React ref to it would silently stay `null`. Looking the
    // trigger up by its own DOM id (already unique per instance, and already
    // what `FieldShell`'s `<label htmlFor>` targets) needs no change to the
    // shared component for one caller's focus-return.
    if (refocusTrigger) document.getElementById(baseId)?.focus();
  }

  function selectDay(date: Date): void {
    onChange(toIsoDate(date));
    close(true);
  }

  function pickMonth(year: number, month: number): void {
    setViewYear(year);
    setViewMonth(month);
    setMode('days');
    const candidate = selected && selected.getFullYear() === year && selected.getMonth() === month
      ? selected
      : new Date(year, month, 1);
    setFocusIso(toIsoDate(candidate));
    pendingFocusId.current = dayCellId(toIsoDate(candidate));
  }

  function pickYear(year: number): void {
    setViewYear(year);
    setMode('months');
    setFocusMonth(viewMonth);
    pendingFocusId.current = monthCellId(viewMonth);
  }

  function openMonths(): void {
    setMode('months');
    setFocusMonth(viewMonth);
    pendingFocusId.current = monthCellId(viewMonth);
  }

  function openYears(): void {
    setYearsStart(pageStartFor(viewYear));
    setMode('years');
    setFocusYear(viewYear);
    pendingFocusId.current = yearCellId(viewYear);
  }

  // Outside click closes without selecting — no focus trap, because nothing
  // here is modal: Escape and Tab already leave it, this only covers a click
  // landing elsewhere on the page.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: Date): void {
    let next: Date | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(current, -1);
        break;
      case 'ArrowRight':
        next = addDays(current, 1);
        break;
      case 'ArrowUp':
        next = addDays(current, -7);
        break;
      case 'ArrowDown':
        next = addDays(current, 7);
        break;
      case 'Home':
        next = startOfWeek(current);
        break;
      case 'End':
        next = addDays(startOfWeek(current), 6);
        break;
      case 'PageUp':
        next = event.shiftKey ? addYearsClamped(current, -1) : addMonthsClamped(current, -1);
        break;
      case 'PageDown':
        next = event.shiftKey ? addYearsClamped(current, 1) : addMonthsClamped(current, 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectDay(current);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setFocusIso(toIsoDate(next));
    pendingFocusId.current = dayCellId(toIsoDate(next));
  }

  function onMonthKeyDown(event: KeyboardEvent<HTMLButtonElement>, year: number, month: number): void {
    let nextYear = year;
    let nextMonth = month;
    switch (event.key) {
      case 'ArrowLeft':
        nextMonth -= 1;
        break;
      case 'ArrowRight':
        nextMonth += 1;
        break;
      case 'ArrowUp':
        nextMonth -= MONTHS_COLUMNS;
        break;
      case 'ArrowDown':
        nextMonth += MONTHS_COLUMNS;
        break;
      case 'PageUp':
        nextYear -= 1;
        break;
      case 'PageDown':
        nextYear += 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pickMonth(year, month);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    while (nextMonth < 0) {
      nextMonth += 12;
      nextYear -= 1;
    }
    while (nextMonth > 11) {
      nextMonth -= 12;
      nextYear += 1;
    }
    setViewYear(nextYear);
    setFocusMonth(nextMonth);
    pendingFocusId.current = monthCellId(nextMonth);
  }

  function onYearKeyDown(event: KeyboardEvent<HTMLButtonElement>, year: number): void {
    let next = year;
    switch (event.key) {
      case 'ArrowLeft':
        next -= 1;
        break;
      case 'ArrowRight':
        next += 1;
        break;
      case 'ArrowUp':
        next -= YEARS_COLUMNS;
        break;
      case 'ArrowDown':
        next += YEARS_COLUMNS;
        break;
      case 'PageUp':
        next -= YEARS_PER_PAGE;
        break;
      case 'PageDown':
        next += YEARS_PER_PAGE;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pickYear(year);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    setYearsStart(pageStartFor(next));
    setFocusYear(next);
    pendingFocusId.current = yearCellId(next);
  }

  const weekdays = tList('calendar.weekdaysShort');
  const months = tList('calendar.months');
  const monthStart = new Date(viewYear, viewMonth, 1);
  const grid = monthGrid(monthStart);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7));

  const displayValue = value ? formatDate(value) : '';

  return (
    <div className="date-picker" ref={containerRef}>
      <Button
        variant="secondary"
        id={baseId}
        className="date-picker__trigger field__control"
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
        onClick={() => (open ? close(true) : openAt('days'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            openAt('days');
          }
        }}
      >
        <span className={displayValue ? 'date-picker__value' : 'date-picker__placeholder'}>
          {displayValue || t('datePicker.placeholder')}
        </span>
      </Button>

      {open ? (
        <div className="date-picker__panel">
          {mode === 'days' ? (
            <>
              <div className="date-picker__head">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const prev = addMonths(monthStart, -1);
                    setViewYear(prev.getFullYear());
                    setViewMonth(prev.getMonth());
                  }}
                  aria-label={t('datePicker.previousMonth')}
                >
                  {t('calendar.navPrevious')}
                </Button>
                <Button
                  variant="ghost"
                  className="date-picker__head-title"
                  onClick={openMonths}
                  aria-label={`${t('datePicker.chooseMonth')} — ${months[viewMonth]} ${viewYear}`}
                >
                  {months[viewMonth]} {viewYear}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const next = addMonths(monthStart, 1);
                    setViewYear(next.getFullYear());
                    setViewMonth(next.getMonth());
                  }}
                  aria-label={t('datePicker.nextMonth')}
                >
                  {t('calendar.navNext')}
                </Button>
              </div>
              <table
                className="date-picker__grid"
                role="grid"
                aria-label={`${months[viewMonth]} ${viewYear}`}
              >
                <thead>
                  <tr>
                    {weekdays.map((day) => (
                      <th key={day} scope="col" className="date-picker__weekday">
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, weekIndex) => (
                    <tr key={`w-${weekIndex}`} role="row">
                      {week.map((date, dayIndex) => {
                        if (!date) {
                          return (
                            <td
                              key={`b-${weekIndex}-${dayIndex}`}
                              className="date-picker__cell date-picker__cell--blank"
                              aria-hidden="true"
                            />
                          );
                        }
                        const iso = toIsoDate(date);
                        const isToday = isSameDay(date, today);
                        const isSelected = selected !== null && isSameDay(date, selected);
                        const isDisabled = dayDisabled(iso, min, max);
                        const label = isToday ? `${t('datePicker.today')}، ${formatDate(iso)}` : formatDate(iso);
                        return (
                          <td key={iso} className="date-picker__cell" role="gridcell">
                            <Button
                              id={dayCellId(iso)}
                              variant="ghost"
                              className={
                                'date-picker__day' +
                                (isToday ? ' is-today' : '') +
                                (isSelected ? ' is-selected' : '')
                              }
                              disabled={isDisabled}
                              tabIndex={iso === focusIso ? 0 : -1}
                              aria-current={isToday ? 'date' : undefined}
                              aria-pressed={isSelected}
                              aria-label={label}
                              onClick={() => selectDay(date)}
                              onKeyDown={(event) => onDayKeyDown(event, date)}
                            >
                              {date.getDate()}
                            </Button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {mode === 'months' ? (
            <>
              <div className="date-picker__head">
                <Button
                  variant="ghost"
                  onClick={() => setViewYear((y) => y - 1)}
                  aria-label={t('datePicker.previousYear')}
                >
                  {t('calendar.navPrevious')}
                </Button>
                <Button
                  variant="ghost"
                  className="date-picker__head-title"
                  onClick={openYears}
                  aria-label={`${t('datePicker.chooseYear')} — ${viewYear}`}
                >
                  {viewYear}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setViewYear((y) => y + 1)}
                  aria-label={t('datePicker.nextYear')}
                >
                  {t('calendar.navNext')}
                </Button>
              </div>
              <ul
                className="date-picker__months"
                aria-label={`${t('datePicker.chooseMonth')} — ${viewYear}`}
              >
                {months.map((name, month) => {
                  const isDisabled = monthDisabled(viewYear, month, min, max);
                  return (
                    <li key={name}>
                      <Button
                        id={monthCellId(month)}
                        variant="ghost"
                        className={month === viewMonth ? 'is-selected' : ''}
                        disabled={isDisabled}
                        tabIndex={month === focusMonth ? 0 : -1}
                        onClick={() => pickMonth(viewYear, month)}
                        onKeyDown={(event) => onMonthKeyDown(event, viewYear, month)}
                      >
                        {name}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {mode === 'years' ? (
            <>
              <div className="date-picker__head">
                <Button
                  variant="ghost"
                  onClick={() => setYearsStart((y) => y - YEARS_PER_PAGE)}
                  aria-label={t('datePicker.previousYears')}
                >
                  {t('calendar.navPrevious')}
                </Button>
                <span className="date-picker__head-title">
                  {yearsStart}–{yearsStart + YEARS_PER_PAGE - 1}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => setYearsStart((y) => y + YEARS_PER_PAGE)}
                  aria-label={t('datePicker.nextYears')}
                >
                  {t('calendar.navNext')}
                </Button>
              </div>
              <ul className="date-picker__years" aria-label={t('datePicker.chooseYear')}>
                {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearsStart + i).map((year) => {
                  const isDisabled = yearDisabled(year, min, max);
                  return (
                    <li key={year}>
                      <Button
                        id={yearCellId(year)}
                        variant="ghost"
                        className={year === viewYear ? 'is-selected' : ''}
                        disabled={isDisabled}
                        tabIndex={year === focusYear ? 0 : -1}
                        onClick={() => pickYear(year)}
                        onKeyDown={(event) => onYearKeyDown(event, year)}
                      >
                        {year}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
