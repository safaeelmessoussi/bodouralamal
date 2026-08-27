import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * `GET /branches` — the public branch directory (SRS Revision 35, TD-3.9, §5.1).
 *
 * The property that matters most is **what the response does not contain**: this
 * is an anonymous endpoint over an otherwise staff-only entity, so the
 * projection is the security boundary. A test that only checked the fields it
 * wants would pass just as happily if `version` and `deleted_at` came along too.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[public-branch-test]";

interface Row {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  opening_hours_ar: string | null;
  google_maps_url: string | null;
  display_order: number | null;
}
interface Body {
  error?: { code?: string };
  data?: Row[];
  meta?: { page: number; page_size: number; total: number };
}

const call = (path: string) => httpCall<Body>(BASE, "GET", path);
const mine = (b: Body): Row[] =>
  (b.data ?? []).filter((r) => r.name.startsWith(TAG));

async function makeBranch(
  name: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const row = await prisma.branch.create({
    data: {
      name: `${TAG} ${name}`,
      address: "تجزئة الزيتون رقم 5، مراكش",
      phone: "0524292925",
      email: "branch@example.com",
      openingHoursAr: "الاثنين - السبت\n09:00 - 12:30",
      googleMapsUrl: "https://maps.google.com/?q=test",
      operationalStartDate: new Date("2020-01-01"),
      ...over,
    },
  });
  return row.id;
}

async function clear(): Promise<void> {
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
});

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("GET /branches — public access", () => {
  it("is reachable with NO credentials at all", async () => {
    await makeBranch("أمرشيش", { displayOrder: 1 });
    const res = await call("/branches");

    expect(res.status).toBe(200);
    expect(mine(res.body)).toHaveLength(1);
  });

  it("returns every public field the landing page needs", async () => {
    await makeBranch("أمرشيش", { displayOrder: 1 });
    const branch = mine((await call("/branches")).body)[0]!;

    expect(branch.address).toBe("تجزئة الزيتون رقم 5، مراكش");
    expect(branch.phone).toBe("0524292925");
    expect(branch.email).toBe("branch@example.com");
    // Multiline free text, delivered verbatim — never parsed (§7).
    expect(branch.opening_hours_ar).toContain("\n");
    expect(branch.google_maps_url).toBe("https://maps.google.com/?q=test");
    expect(branch.display_order).toBe(1);
  });

  it("exposes NOTHING beyond the documented projection", async () => {
    // The decisive assertion. Revision 35 lists the fields exactly, and an
    // anonymous endpoint over a staff entity is one careless `select` away from
    // leaking operational metadata.
    await makeBranch("أمرشيش");
    const branch = mine((await call("/branches")).body)[0]!;

    expect(Object.keys(branch).sort()).toEqual(
      [
        "address",
        "display_order",
        "email",
        "google_maps_url",
        "id",
        "name",
        "opening_hours_ar",
        "phone",
        // NEW I — a deliberate ADDITION to the §5.1 allowlist, not a column
        // that arrived by widening a `select`. R35 published the contact
        // details so a visitor can reach the branch; a branch that answers on
        // its mobile is exactly this field's case.
        "phone_secondary",
      ].sort(),
    );
    for (const leaked of [
      "version",
      "operational_start_date",
      "deletedAt",
      "deleted_at",
      "createdAt",
      "created_at",
    ]) {
      expect(branch).not.toHaveProperty(leaked);
    }
  });

  it("never lists a soft-deleted branch", async () => {
    // A closed premises must not keep advertising an address and a phone.
    const id = await makeBranch("مغلق");
    expect(mine((await call("/branches")).body)).toHaveLength(1);

    await prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    expect(mine((await call("/branches")).body)).toHaveLength(0);
  });

  it("orders by display_order, with nulls last (§2.2)", async () => {
    await makeBranch("بلا ترتيب", { displayOrder: null });
    await makeBranch("ثانٍ", { displayOrder: 2 });
    await makeBranch("أول", { displayOrder: 1 });

    const ordered = mine((await call("/branches")).body);
    expect(ordered.map((b) => b.display_order)).toEqual([1, 2, null]);
  });

  it("serves a branch whose optional fields are absent, without inventing them", async () => {
    // The landing page must degrade gracefully; the API's part is to say `null`
    // plainly rather than omit the key or substitute a placeholder.
    await makeBranch("بلا خريطة", {
      googleMapsUrl: null,
      phone: null,
      email: null,
    });
    const branch = mine((await call("/branches")).body)[0]!;

    expect(branch.google_maps_url).toBeNull();
    expect(branch.phone).toBeNull();
    expect(branch.email).toBeNull();
    expect(branch.address).not.toBeNull();
  });

  it("carries the TD-10 envelope like every other list", async () => {
    await makeBranch("أمرشيش");
    const res = await call("/branches?page=1&page_size=1");

    expect(res.body.meta).toMatchObject({ page: 1, page_size: 1 });
    expect(typeof res.body.meta!.total).toBe("number");
    expect(res.body.data).toHaveLength(1);
  });
});
