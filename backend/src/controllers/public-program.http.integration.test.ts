import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * `GET /programs` — the public programme overview (Revision 144, TD-3.16, §5.1).
 *
 * The property that matters most, on the same reasoning
 * `public-branch.http.integration.test.ts` already states: this is an
 * anonymous endpoint over otherwise staff-only entities (`Category`,
 * `Level`, `Subject`, `QuranSurah`), so the projection IS the security
 * boundary. A test that only checked the fields it wants would pass just as
 * happily if `enrollment_count`, `gender_restriction` or `display_order`
 * came along too.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[public-program-test]";

interface Row {
  id: string;
  name: string;
  description: string | null;
  levels: {
    id: string;
    name: string;
    description: string | null;
    subjects: { id: string; name: string }[];
    surahs: { id: number; name: string }[];
  }[];
}
interface Body {
  error?: { code?: string };
  data?: Row[];
}

const call = (path: string) => httpCall<Body>(BASE, "GET", path);
const mine = (b: Body): Row[] => (b.data ?? []).filter((r) => r.name.startsWith(TAG));

async function clear(): Promise<void> {
  const categories = await prisma.category.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const categoryIds = categories.map((c) => c.id);
  const levels = await prisma.level.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.levelSurah.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { categoryId: { in: categoryIds } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error("API not reachable");
});

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("GET /programs — public access", () => {
  it("is reachable with NO credentials at all, and returns the seeded tree", async () => {
    const category = await prisma.category.create({
      data: { name: `${TAG} فئة`, description: "وصف الفئة", displayOrder: 1 },
    });
    const level = await prisma.level.create({
      data: {
        name: `${TAG} مستوى`,
        description: "وصف المستوى",
        categoryId: category.id,
        displayOrder: 1,
      },
    });
    const subject = await prisma.subject.create({
      data: { name: `${TAG} مادة`, displayOrder: 1 },
    });
    await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: subject.id } });
    // الفاتحة — real production-seeded reference data (§15.1), not invented.
    await prisma.levelSurah.create({ data: { levelId: level.id, surahId: 1 } });

    const res = await call("/programs");
    expect(res.status).toBe(200);
    const rows = mine(res.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("وصف الفئة");
    expect(rows[0]!.levels).toHaveLength(1);
    expect(rows[0]!.levels[0]!.description).toBe("وصف المستوى");
    expect(rows[0]!.levels[0]!.subjects).toEqual([{ id: subject.id, name: subject.name }]);
    expect(rows[0]!.levels[0]!.surahs).toEqual([{ id: 1, name: "الفاتحة" }]);
  });

  it("exposes NOTHING beyond the documented projection", async () => {
    // The decisive assertion, matching public-branch's own: an anonymous
    // endpoint over a staff entity is one careless `select` away from
    // leaking operational metadata (enrolment counts, gender restriction,
    // visibility defaults, optimistic versions).
    const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id },
    });

    const rows = mine((await call("/programs")).body);
    expect(Object.keys(rows[0]!).sort()).toEqual(["description", "id", "levels", "name"].sort());
    expect(Object.keys(rows[0]!.levels[0]!).sort()).toEqual(
      ["description", "id", "name", "subjects", "surahs"].sort(),
    );
    for (const leaked of [
      "enrollment_count",
      "enrollmentCount",
      "gender_restriction",
      "genderRestriction",
      "display_order",
      "displayOrder",
      "default_visibility",
      "defaultVisibility",
      "version",
    ]) {
      expect(rows[0]).not.toHaveProperty(leaked);
      expect(rows[0]!.levels[0]).not.toHaveProperty(leaked);
    }
  });

  it("never lists a soft-deleted Category, Level or Subject pairing", async () => {
    const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
    const level = await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: category.id },
    });
    const subject = await prisma.subject.create({ data: { name: `${TAG} مادة` } });
    await prisma.levelSubject.create({ data: { levelId: level.id, subjectId: subject.id } });

    expect(mine((await call("/programs")).body)[0]!.levels[0]!.subjects).toHaveLength(1);

    await prisma.subject.update({ where: { id: subject.id }, data: { deletedAt: new Date() } });
    expect(mine((await call("/programs")).body)[0]!.levels[0]!.subjects).toHaveLength(0);

    await prisma.level.update({ where: { id: level.id }, data: { deletedAt: new Date() } });
    expect(mine((await call("/programs")).body)[0]!.levels).toHaveLength(0);

    await prisma.category.update({ where: { id: category.id }, data: { deletedAt: new Date() } });
    expect(mine((await call("/programs")).body)).toHaveLength(0);
  });

  it("orders Levels within their Category by display_order, nulls last (§2.2)", async () => {
    const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
    await prisma.level.create({
      data: { name: `${TAG} بلا ترتيب`, categoryId: category.id, displayOrder: null },
    });
    await prisma.level.create({
      data: { name: `${TAG} ثانٍ`, categoryId: category.id, displayOrder: 2 },
    });
    await prisma.level.create({
      data: { name: `${TAG} أول`, categoryId: category.id, displayOrder: 1 },
    });

    const levels = mine((await call("/programs")).body)[0]!.levels;
    expect(levels.map((l) => l.name)).toEqual([
      `${TAG} أول`,
      `${TAG} ثانٍ`,
      `${TAG} بلا ترتيب`,
    ]);
  });

  it("renders a Level with no Subjects or Surahs honestly — an empty list, never invented", async () => {
    const category = await prisma.category.create({ data: { name: `${TAG} فئة` } });
    await prisma.level.create({ data: { name: `${TAG} مستوى`, categoryId: category.id } });

    const level = mine((await call("/programs")).body)[0]!.levels[0]!;
    expect(level.subjects).toEqual([]);
    expect(level.surahs).toEqual([]);
  });
});
