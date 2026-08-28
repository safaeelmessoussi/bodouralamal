import { describe, expect, it } from "vitest";

import { assertUmmAlQuraAvailable, ummAlQuraMonthStarts } from "./umm-al-qura.js";

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * **The baseline the Hijri screen prefills from** (Owner, 2026-08-30).
 *
 * These pin the derivation against dates that can be checked against any
 * published Umm al-Qura calendar. They are **not** a claim about the Moroccan
 * calendar: Umm al-Qura is calculated, Morocco announces by sighting, and the
 * two differ by a day with some regularity. That difference is exactly why the
 * imported rows land as `draft` for a Super Admin to correct.
 */
describe("ummAlQuraMonthStarts", () => {
  it("is available in this build, and refuses rather than approximating", () => {
    // A Node without full ICU resolves the locale to a DIFFERENT Islamic
    // calendar and returns plausible dates that are simply wrong — the worst
    // failure mode here, because nobody notices until a Ramadan.
    expect(() => assertUmmAlQuraAvailable()).not.toThrow();
  });

  it("gives twelve months for a year, numbered 1–12 with no gaps", () => {
    const months = ummAlQuraMonthStarts(1447, 1447);
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.hijriMonth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(months.every((m) => m.hijriYear === 1447)).toBe(true);
  });

  it("places 1 Muharram 1447 on 2025-06-26", () => {
    const first = ummAlQuraMonthStarts(1447, 1447)[0]!;
    expect(iso(first.gregorianStartDate)).toBe("2025-06-26");
  });

  it("places 1 Ramadan 1447 on 2026-02-18", () => {
    const ramadan = ummAlQuraMonthStarts(1447, 1447).find((m) => m.hijriMonth === 9)!;
    expect(iso(ramadan.gregorianStartDate)).toBe("2026-02-18");
  });

  it("returns strictly ascending dates, which is the invariant the table enforces", () => {
    // `assertOrdered` refuses a month beginning before its predecessor, so a
    // derivation that produced them out of order would import nothing and look
    // like a permissions problem.
    const months = ummAlQuraMonthStarts(1446, 1448);
    for (let i = 1; i < months.length; i += 1) {
      expect(months[i]!.gregorianStartDate.getTime()).toBeGreaterThan(
        months[i - 1]!.gregorianStartDate.getTime(),
      );
    }
  });

  it("spans a multi-year range without dropping or duplicating a month", () => {
    const months = ummAlQuraMonthStarts(1446, 1448);
    expect(months).toHaveLength(36);
    const keys = months.map((m) => `${m.hijriYear}-${m.hijriMonth}`);
    expect(new Set(keys).size).toBe(36);
  });

  it("returns UTC midnight, matching the @db.Date column (TD-11)", () => {
    // A value carrying a time of day would land in the wrong day for anyone
    // reading it in a negative offset.
    for (const m of ummAlQuraMonthStarts(1447, 1447)) {
      expect(m.gregorianStartDate.toISOString().slice(10)).toBe("T00:00:00.000Z");
    }
  });

  it("refuses a descending range rather than returning nothing", () => {
    // Silence would look like "that year has no months", which is a very
    // different statement from "you asked for something impossible".
    expect(() => ummAlQuraMonthStarts(1448, 1446)).toThrow();
  });
});
