import { describe, expect, it } from "vitest";

import {
  calendarDay,
  intervalsOverlap,
  withinScheduleLife,
} from "./effective-staffing.js";

/**
 * **The interval arithmetic R91 rests on**, tested exhaustively without a
 * database or a clock — the same reasoning `teaching-profile.ts` records for the
 * availability rules.
 *
 * The boundary cases are the whole point. Every defect this class of code has is
 * an off-by-one at an inclusive edge or a mishandled open end.
 */
const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("intervals are INCLUSIVE at both ends, and NULL is open-ended", () => {
  it("two periods sharing a single day overlap", () => {
    // **Touching IS overlapping here**, unlike availability ranges. Two
    // assignments that share a day mean two people are the main teacher on that
    // day, which is exactly what §6 forbids.
    expect(
      intervalsOverlap(
        { from: d("2026-09-01"), until: d("2026-11-30") },
        { from: d("2026-11-30"), until: d("2027-06-30") },
      ),
    ).toBe(true);
  });

  it("consecutive periods with no shared day do not", () => {
    // The rest-of-semester handover: A until the 30th, B from the 1st.
    expect(
      intervalsOverlap(
        { from: d("2026-09-01"), until: d("2026-11-30") },
        { from: d("2026-12-01"), until: d("2027-06-30") },
      ),
    ).toBe(false);
  });

  it("the Owner's overlapping example is refused", () => {
    // Safa Sep 1 → Dec 15 against Amina Dec 1 → Jun 30: December 1–15.
    expect(
      intervalsOverlap(
        { from: d("2026-09-01"), until: d("2026-12-15") },
        { from: d("2026-12-01"), until: d("2027-06-30") },
      ),
    ).toBe(true);
  });

  it("an open start reaches back forever", () => {
    expect(
      intervalsOverlap(
        { from: null, until: d("2026-09-01") },
        { from: d("1990-01-01"), until: d("1990-01-02") },
      ),
    ).toBe(true);
  });

  it("an open end reaches forward forever", () => {
    expect(
      intervalsOverlap(
        { from: d("2026-09-01"), until: null },
        { from: d("2099-01-01"), until: null },
      ),
    ).toBe(true);
  });

  it("two fully open periods always overlap — which is the pre-R91 row", () => {
    // Both bounds NULL is what every assignment written before R91 carries, and
    // two of them on one schedule are two main teachers for all time.
    expect(
      intervalsOverlap({ from: null, until: null }, { from: null, until: null }),
    ).toBe(true);
  });

  it("a single-day period is a period", () => {
    const day = { from: d("2026-11-05"), until: d("2026-11-05") };
    expect(intervalsOverlap(day, day)).toBe(true);
    expect(
      intervalsOverlap(day, { from: d("2026-11-06"), until: d("2026-11-06") }),
    ).toBe(false);
  });
});

describe("an assignment must touch the schedule's own life (§5)", () => {
  const schedule = { anchorDate: d("2026-09-01"), effectiveUntil: d("2027-06-30") };

  it("accepts a period inside it", () => {
    expect(
      withinScheduleLife({ from: d("2026-11-01"), until: d("2026-11-30") }, schedule),
    ).toBe(true);
  });

  it("accepts a period that merely touches its last day", () => {
    expect(
      withinScheduleLife({ from: d("2027-06-30"), until: null }, schedule),
    ).toBe(true);
  });

  it("accepts a period that merely touches its FIRST day", () => {
    // The symmetric case to the one above, and the boundary the Owner's report
    // sat one day outside of: an assignment on the very day the class begins is
    // inside. Only the upper bound was pinned, so an off-by-one here would have
    // refused a legitimate first-day assignment with nothing to catch it.
    expect(
      withinScheduleLife({ from: d("2026-09-01"), until: d("2026-09-01") }, schedule),
    ).toBe(true);
  });

  it("refuses one entirely before it", () => {
    expect(
      withinScheduleLife({ from: d("2026-01-01"), until: d("2026-08-31") }, schedule),
    ).toBe(false);
  });

  it("refuses one entirely after it", () => {
    expect(
      withinScheduleLife({ from: d("2027-07-01"), until: null }, schedule),
    ).toBe(false);
  });

  it("accepts anything against a schedule with no bounds of its own", () => {
    // `daily`, `monthly` and `yearly` recurrences carry no anchor, and an
    // open-ended series carries no `effective_until`. Refusing an assignment
    // against a life nobody bounded would refuse every assignment on them.
    expect(
      withinScheduleLife(
        { from: d("2026-11-01"), until: d("2026-11-30") },
        { anchorDate: null, effectiveUntil: null },
      ),
    ).toBe(true);
  });
});

describe("calendarDay anchors to UTC midnight, like every @db.Date column", () => {
  it("strips the time of day", () => {
    expect(calendarDay(new Date("2026-11-05T23:59:59.999Z")).toISOString()).toBe(
      "2026-11-05T00:00:00.000Z",
    );
  });

  it("does not mutate its argument", () => {
    const at = new Date("2026-11-05T13:00:00.000Z");
    calendarDay(at);
    expect(at.toISOString()).toBe("2026-11-05T13:00:00.000Z");
  });
});

/**
 * **`calendarDay` answers Morocco's date** (codex review, 2026-09-22; R167 §2).
 * At 23:30 UTC on 19 January it is 00:30 on 20 January in Casablanca, and an
 * assignment ending on the 19th must have ended.
 */
describe('calendarDay is Morocco’s calendar date, as a UTC-midnight value', () => {
  it('rolls over at Morocco’s midnight, not UTC’s', () => {
    expect(calendarDay(new Date('2026-01-19T23:30:00.000Z')).toISOString()).toBe('2026-01-20T00:00:00.000Z');
    expect(calendarDay(new Date('2026-01-19T22:30:00.000Z')).toISOString()).toBe('2026-01-19T00:00:00.000Z');
  });

  it('leaves a value that is already a calendar date exactly where it is', () => {
    for (const iso of ['2026-01-19', '2026-03-15', '2026-09-22']) {
      expect(calendarDay(new Date(`${iso}T00:00:00.000Z`)).toISOString()).toBe(`${iso}T00:00:00.000Z`);
    }
  });

  it('an assignment ending today is no longer in force in Morocco’s first hour of tomorrow', () => {
    const endsOn19 = new Date('2026-01-19T00:00:00.000Z');
    // The comparison every caller makes: `effective_until < calendarDay(now)`.
    expect(endsOn19 < calendarDay(new Date('2026-01-19T22:59:00.000Z'))).toBe(false);
    expect(endsOn19 < calendarDay(new Date('2026-01-19T23:30:00.000Z'))).toBe(true);
  });
});
