import { describe, expect, it } from "vitest";

import { splitComposedName } from "./person-name.js";

/**
 * **Why a derivation exists at all** (2026-08-28).
 *
 * `تعديل بيانات المستخدم` opened with الاسم الشخصي and الاسم العائلي blank on
 * every account that predates Revisions 40–41, and `حفظ` then refused in
 * silence because two required fields were empty. The cause was data, not
 * mapping: those rows carry only the composed `nameArabic`, and the part
 * columns are NULL.
 *
 * The fix reads the parts back out of the composed name **for display only**.
 * Splitting a person's name is a guess — «محمد بن عبد الله» has no mechanical
 * answer — so the guess is offered to the administrator in a form she can
 * correct, and only what she saves is written. Nothing here ever rewrites a
 * stored row.
 */
describe("splitComposedName", () => {
  it("splits at the FIRST space — the rest is the family name", () => {
    // Not the last space: «عبد الله» is one given name in two words far more
    // often than «الرحمن» is a family name on its own.
    expect(splitComposedName("سعاد المسوسي")).toEqual({
      first: "سعاد",
      last: "المسوسي",
    });
    expect(splitComposedName("محمد بن عبد الله")).toEqual({
      first: "محمد",
      last: "بن عبد الله",
    });
  });

  it("gives a single token to the FIRST name, leaving the family name unknown", () => {
    // `null`, never `''` — the form must show an empty required field the
    // administrator has to complete, not a blank it believes is filled.
    expect(splitComposedName("مريم")).toEqual({ first: "مريم", last: null });
  });

  it("treats absent, empty and whitespace-only as no name at all", () => {
    for (const input of [null, "", "   "]) {
      expect(splitComposedName(input)).toEqual({ first: null, last: null });
    }
  });

  it("does not leak the separator into either part", () => {
    expect(splitComposedName("  سعاد   المسوسي  ")).toEqual({
      first: "سعاد",
      last: "المسوسي",
    });
  });
});
