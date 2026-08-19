import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **Guard: a group-less enrolment is a valid enrolment (R66).**
 *
 * ## The bug class this exists to stop
 *
 * Revision 66 made `administrative_group_id` nullable. A Prisma **relation
 * filter never matches a NULL relation**, so every query that resolves *is this
 * student enrolled in this Level* by requiring `administrativeGroup: { … }`
 * silently excludes students enrolled directly in an unsubdivided Level — and
 * silently is the problem: no error, no empty-state, just a person missing from
 * a list she belongs on.
 *
 * It has now been introduced **five times**, in three separate slices, and twice
 * the `select` was migrated to `Enrollment.branch_id` while the `where` beside
 * it was left behind. That pattern is why this is a guard and not a code review
 * note.
 *
 * ## What it accepts, and why
 *
 * An enrolment query naming the group relation is fine when it is **about a
 * particular group** — the roster, un-enrolment by group, a group's own
 * membership. Those name `administrativeGroupId` explicitly. What is refused is
 * a query that asks an **enrolment-resolution** question while requiring the
 * optional half of the answer to exist.
 *
 * ## What it deliberately does NOT cover
 *
 * Only direct `enrollment.find*|count` calls. A nested
 * `level: { enrollments: { some: … } }` — which is where the P0 consent defect
 * lived — is not a call this can see, so the semantic tests beside it carry
 * that case. A guard that claimed to catch everything would be worse than one
 * whose blind spot is written down.
 */

/**
 * Queries that legitimately require a live group, with the reason.
 *
 * **Empty, and that is the point** (2026-08-19). It held one entry — the
 * calendar's scope prefill, recorded as the audit's P2 and deliberately scoped
 * out — and the guard then failed, because the query had drifted from line 676
 * to line 836 and no longer matched its own exemption. **An allowlist keyed by
 * LINE NUMBER expires whenever the file above it changes**, which is a guard
 * that fails for a reason unrelated to what it guards. The occasion was used to
 * fix the query instead: a beneficiary enrolled directly in an unsubdivided
 * Level now gets her scope prefill, which is the sixth instance of this class.
 *
 * If a genuinely group-specific enrolment query ever needs exempting here,
 * **key it by something the file cannot invalidate** — a nearby marker comment
 * or the query's own shape — rather than adding another line number.
 */
const GROUP_SPECIFIC_BY_DESIGN: Record<string, string> = {};

function blockAt(source: string, from: number): string {
  let depth = 0;
  let i = from;
  while (i < source.length) {
    if ("({[".includes(source[i]!)) depth += 1;
    else if (")}]".includes(source[i]!)) {
      depth -= 1;
      if (depth === 0) break;
    }
    i += 1;
  }
  return source.slice(from, i);
}

describe("R66 — enrolment resolution must accept a group-less enrolment", () => {
  it("no enrolment query requires a live Administrative Group", () => {
    const dir = new URL(".", import.meta.url).pathname;
    const offenders: string[] = [];

    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.includes(".test."),
    )) {
      const source = readFileSync(`${dir}${file}`, "utf8");

      for (const match of source.matchAll(
        /\b(?:tx|prisma)\.enrollment\.(findMany|findFirst|count)\(/g,
      )) {
        const block = blockAt(source, match.index! + match[0]!.length - 1);
        if (!block.includes("administrativeGroup")) continue;

        // The null arm: the correct predicate.
        if (block.includes("administrativeGroupId: null")) continue;
        // Group-specific by intent — `administrativeGroupId: <id>` or the
        // object shorthand `{ administrativeGroupId, … }`.
        if (
          /administrativeGroupId\s*[,:}]/.test(
            block.replace(/administrativeGroupId:\s*null/g, ""),
          )
        )
          continue;

        const line = source.slice(0, match.index).split("\n").length;
        const key = `${file}:${line}`;
        if (GROUP_SPECIFIC_BY_DESIGN[key]) continue;
        offenders.push(key);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("names its own blind spot, so nobody trusts it further than it reaches", () => {
    // The P0 consent defect lived in a NESTED `level.enrollments.some`, which
    // this scanner cannot see. The integration tests beside it cover that path,
    // and this assertion exists so the limitation is read rather than assumed.
    const self = readFileSync(new URL(import.meta.url).pathname, "utf8");
    expect(self).toContain("deliberately does NOT cover");
  });
});
