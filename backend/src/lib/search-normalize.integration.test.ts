import { afterAll, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "./prisma.js";
import { normalizePhone, normalizeSearchText } from "./search-normalize.js";

/**
 * TD-10 parity: the TypeScript normalizer must produce **byte-identical** output
 * to the `normalize_search_text` / `normalize_phone` functions in the TD-6a
 * migration.
 *
 * This is the test that makes the duplication safe. TD-10 requires normalization
 * to be applied identically to the query and the stored value; the stored side
 * runs in Postgres and the query side runs in Node, so if these two ever drift,
 * searches silently stop matching — no error, just missing people. Asserting the
 * two implementations agree is the only way to know they do.
 *
 * The raw SQL here is test-only: it verifies a database function rather than
 * serving application queries, so §16.2's raw-SQL rule (row locks and pg-boss
 * inserts only) is not in play.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

afterAll(async () => {
  await prisma.$disconnect();
});

/** Realistic inputs plus the awkward edges the folding rules exist for. */
const TEXT_CORPUS = [
  // Arabic names as staff would actually type them.
  "سعاد",
  "أم سعاد",
  "آمنة",
  "إبراهيم",
  "فاطمة الزهراء",
  "خديجة بنت خويلد",
  // Alef variants that must all fold together.
  "أحمد",
  "احمد",
  "إحمد",
  "آحمد",
  "ٱحمد",
  // Ta marbuta and alef maqsura.
  "فاطمة",
  "فاطمه",
  "ليلى",
  "ليلي",
  // Tashkeel and tatweel, which must vanish entirely.
  "مُحَمَّد",
  "محمد",
  "مـــحـــمـــد",
  "سُعَادٰ",
  // French names with accents, mixed case.
  "Aïcha",
  "AÏCHA",
  "Zoé",
  "Frédéric",
  "François",
  "Noël",
  "Bénédicte",
  "Angèle",
  "Jérôme",
  "Anaïs",
  // Whitespace handling.
  "  سعاد   بنت   علي  ",
  "Marie   Claire",
  "\tمحمد\n",
  // Mixed script and punctuation.
  "أم Aïcha",
  "O'Brien",
  "Ben-Ali",
  // Degenerate cases.
  "",
  " ",
  "a",
  "123",
];

const PHONE_CORPUS = [
  "+212 6 12 34 56 78",
  "0612345678",
  "+212612345678",
  " 06 12 34 56 78 ",
  "+212-6-12-34-56-78",
  "",
];

describe("TD-10 normalization parity between TypeScript and PostgreSQL", () => {
  it("normalize_search_text agrees on every corpus entry", async () => {
    const rows = await prisma.$queryRaw<{ input: string; sql: string }[]>`
      SELECT t.input, normalize_search_text(t.input) AS sql
      FROM unnest(${TEXT_CORPUS}::text[]) AS t(input)
    `;
    expect(rows).toHaveLength(TEXT_CORPUS.length);

    const disagreements = rows
      .map((row) => ({
        input: row.input,
        sql: row.sql,
        ts: normalizeSearchText(row.input),
      }))
      .filter((r) => r.sql !== r.ts);

    expect(disagreements).toEqual([]);
  });

  it("normalize_phone agrees on every corpus entry", async () => {
    const rows = await prisma.$queryRaw<{ input: string; sql: string }[]>`
      SELECT t.input, normalize_phone(t.input) AS sql
      FROM unnest(${PHONE_CORPUS}::text[]) AS t(input)
    `;

    const disagreements = rows
      .map((row) => ({
        input: row.input,
        sql: row.sql,
        ts: normalizePhone(row.input),
      }))
      .filter((r) => r.sql !== r.ts);

    expect(disagreements).toEqual([]);
  });

  it("the folding actually collapses the variants staff will type", async () => {
    // Not a parity check but a behaviour check: TD-10's whole point is that
    // `سعاد` finds `أم سعاد`, and that alef and ta-marbuta spellings unify.
    expect(normalizeSearchText("أحمد")).toBe(normalizeSearchText("احمد"));
    expect(normalizeSearchText("آحمد")).toBe(normalizeSearchText("ٱحمد"));
    expect(normalizeSearchText("فاطمة")).toBe(normalizeSearchText("فاطمه"));
    expect(normalizeSearchText("ليلى")).toBe(normalizeSearchText("ليلي"));
    expect(normalizeSearchText("مُحَمَّد")).toBe(normalizeSearchText("محمد"));
    expect(normalizeSearchText("مـــحـــمـــد")).toBe(
      normalizeSearchText("محمد"),
    );
    expect(normalizeSearchText("AÏCHA")).toBe(normalizeSearchText("aicha"));
    expect(normalizeSearchText("Zoé")).toBe("zoe");
    // Substring, not prefix: the stored value contains the query.
    expect(normalizeSearchText("أم سعاد")).toContain(
      normalizeSearchText("سعاد"),
    );
  });

  it("phone normalization unifies the formats a person may enter", async () => {
    expect(normalizePhone("+212 6 12 34 56 78")).toBe("212612345678");
    expect(normalizePhone(" 06 12 34 56 78 ")).toBe("0612345678");
  });
});
