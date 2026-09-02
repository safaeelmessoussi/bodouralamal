import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * `GET /calendar` over real HTTP — the one public read (TD-3.4, §4.4).
 *
 * What only an HTTP test can show: that the route is genuinely reachable
 * **without a token**, that a Pending token is served rather than refused, and
 * that a malformed token is IGNORED rather than refused (Revision 34).
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[cal-http-test]";
/** Reserved fixture coordinate: deliberately outside the Production seed. */
const TEST_HIJRI_YEAR = 1547;

interface Row {
  kind: string;
  title: string;
  date: string;
  start_time: string | null;
  visibility: string | null;
  hijri_date: string | null;
  hijri_month_ar: string | null;
  /** R97 — `null` for an Event and an Exam, which have no delivery model. */
  delivery_mode: string | null;
  online_media_mode: string | null;
}
interface Body {
  error?: { code?: string };
  data?: Row[];
  prefilled_filters?: Record<string, string | null> | null;
}

const call = (path: string, token?: string) =>
  httpCall<Body>(BASE, "GET", path, { token });

const bearer = (
  userId: string,
  roles: string[],
  accountStatus = "active",
): string =>
  issueAccessToken(
    {
      userId,
      roleScopes: roles.map((role) => ({ role, branches: null })),
      accountStatus: accountStatus as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;

const mine = (b: Body): Row[] =>
  (b.data ?? []).filter((r) => r.title.startsWith(TAG));

async function person(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${label}`,
      accountStatus: "active",
    },
  });
  return u.id;
}

async function clear(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = events.map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: ids } } });
  // R71 — `event_staff` is RESTRICT like the other event children, so it
  // goes before the event it points at.
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: ids } } });
  // R82 — notices RESTRICT the event they are about; teardown clears them first.
  await prisma.notification.deleteMany({ where: { event: { id: { in: ids } } } });
  await prisma.event.deleteMany({ where: { id: { in: ids } } });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.hijriMonthStart.deleteMany({ where: { hijriYear: TEST_HIJRI_YEAR } });
}

/** Events created directly: this suite tests the READ path, not creation. */
async function seedEvent(
  visibility: "public" | "private" | "hidden",
): Promise<void> {
  await prisma.event.create({
    data: {
      title: `${TAG} ${visibility}`,
      visibility: visibility as never,
      // Both coordinates are fixture-owned: a reserved Hijri year and a remote
      // Gregorian date outside the local official catalogue's timeline.
      startDate: new Date("2036-06-15T00:00:00.000Z"),
      startTime: new Date(Date.UTC(1970, 0, 1, 14, 0)),
      recurrenceType: "none" as never,
    },
  });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) throw new Error("API not reachable");
});

beforeEach(async () => {
  await clear();
  await seedEvent("public");
  await seedEvent("private");
  await seedEvent("hidden");
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const RANGE = "from=2036-06-01&to=2036-06-30";

describe("GET /calendar — public access", () => {
  it("is reachable with NO token and returns the public tier only", async () => {
    const res = await call(`/calendar?${RANGE}`);

    expect(res.status).toBe(200);
    const rows = mine(res.body);
    expect(rows.map((r) => r.visibility)).toEqual(["public"]);
    // Wall-clock time survives the boundary (TD-11).
    expect(rows[0]!.start_time).toBe("14:00");
    // Revision 31: with no official month recorded, the overlay is absent
    // rather than computed. The Gregorian date still renders.
    expect(rows[0]!.date).toBe("2036-06-15");
    expect(rows[0]!.hijri_date).toBeNull();
    expect(rows[0]!.hijri_month_ar).toBeNull();
  });

  it("carries the official Hijri overlay once the month is published", async () => {
    // A published database coordinate is the authority. The deliberately
    // non-seeded year also proves the test owns the row it later removes.
    await prisma.hijriMonthStart.create({
      data: {
        hijriYear: TEST_HIJRI_YEAR,
        hijriMonth: 12,
        gregorianStartDate: new Date("2036-05-18T00:00:00.000Z"),
        status: "published",
      },
    });

    const rows = mine((await call(`/calendar?${RANGE}`)).body);

    expect(rows[0]!.hijri_date).toBe(`${TEST_HIJRI_YEAR}-12-29`);
    expect(rows[0]!.hijri_month_ar).toBe("ذو الحجة");
  });

  it("a PENDING token is served the public tier, not refused", async () => {
    // The guarded router rejects non-active accounts outright; §4.4 requires the
    // calendar to serve them the public tier instead.
    const pending = bearer(
      await person("قيد الموافقة"),
      ["student"],
      "pending",
    );
    const res = await call(`/calendar?${RANGE}`, pending);

    expect(res.status).toBe(200);
    expect(mine(res.body).map((r) => r.visibility)).toEqual(["public"]);
  });

  it("an approved student adds the private tier but never hidden", async () => {
    const student = bearer(await person("طالبة"), ["student"]);
    const rows = mine((await call(`/calendar?${RANGE}`, student)).body);

    expect(rows.map((r) => r.visibility).sort()).toEqual(["private", "public"]);
  });

  it("an active account with no authorised calendar role remains public-only", async () => {
    const roleless = bearer(await person("حساب بلا دور"), []);
    const rows = mine((await call(`/calendar?${RANGE}`, roleless)).body);

    expect(rows.map((r) => r.visibility)).toEqual(["public"]);
  });

  /**
   * **R109 over real HTTP — the one place the revision REMOVES reach.**
   *
   * §4.4 read *"and to ALL Admins regardless of branch scope"*, and the filter
   * short-circuited an all-branches Admin to `{}` — every hidden Event in the
   * platform. This assertion fails on that filter, which is what makes it a test
   * of the change rather than of the code around it.
   */
  it("R109: an Admin no longer sees a hidden activity she is not responsible for", async () => {
    const admin = bearer(await person("إدارية"), ["admin"]);
    const rows = mine((await call(`/calendar?${RANGE}`, admin)).body);

    expect(rows.map((r) => r.visibility)).not.toContain("hidden");
    // The private tier is untouched by R109 — asserted so a future change that
    // over-narrows is caught here rather than reported as a missing activity.
    expect(rows.map((r) => r.visibility).sort()).toEqual(["private", "public"]);
  });

  it("a Super Admin sees every tier", async () => {
    const su = bearer(await person("مشرف عام"), ["super_admin"]);
    const rows = mine((await call(`/calendar?${RANGE}`, su)).body);

    expect(rows.map((r) => r.visibility).sort()).toEqual([
      "hidden",
      "private",
      "public",
    ]);
  });

  it("Revision 34: a token that does NOT verify is IGNORED, not refused", async () => {
    // A public endpoint never returns 401. The landing page (§5.1) renders this
    // calendar, so refusing a request that merely carries a stale token would
    // serve an error on a page with no login requirement — and a client
    // treating 401 as "redirect to login" would login-wall a public page.
    const corrupt = `${bearer(await person("س"), ["student"])}x`;
    const res = await call(`/calendar?${RANGE}`, corrupt);

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  it("an ignored credential yields EXACTLY the anonymous response", async () => {
    // Not merely "also 200": a credential that fails verification carries no
    // identity, so the caller must be indistinguishable from one who sent no
    // token at all. A richer tier leaking through would mean the token was
    // partly trusted.
    const student = await person("طالبة معتمدة");
    const expired = `${bearer(student, ["student"])}tampered`;

    const ignored = await call(`/calendar?${RANGE}`, expired);
    const anonymous = await call(`/calendar?${RANGE}`);

    expect(ignored.status).toBe(anonymous.status);
    expect(mine(ignored.body)).toEqual(mine(anonymous.body));
    // And specifically: the private tier a valid student token would have
    // unlocked is absent.
    expect(mine(ignored.body).every((r) => r.visibility === "public")).toBe(
      true,
    );
    expect(mine(ignored.body).length).toBeGreaterThan(0);
  });

  it("a garbage Authorization header is anonymous, not a 500", async () => {
    // The header is attacker-controllable, so every shape has to be survivable.
    for (const authorization of [
      "Bearer",
      "Bearer ...",
      "Basic abc",
      "nonsense",
    ]) {
      const res = await httpCall<Body>(BASE, "GET", `/calendar?${RANGE}`, {
        rawAuthorization: authorization,
      });
      expect(res.status, `Authorization: ${authorization}`).toBe(200);
    }
  });
});

describe("GET /calendar — query validation", () => {
  it("requires from and to as YYYY-MM-DD", async () => {
    expect((await call("/calendar")).status).toBe(400);
    expect((await call("/calendar?from=2026-06-01")).status).toBe(400);
    expect((await call("/calendar?from=01-06-2026&to=2026-06-30")).status).toBe(
      400,
    );
  });

  it("refuses an inverted range and one longer than a year", async () => {
    expect((await call("/calendar?from=2026-06-30&to=2026-06-01")).status).toBe(
      400,
    );
    expect((await call("/calendar?from=2026-01-01&to=2028-01-01")).status).toBe(
      400,
    );
  });
});

/* ── TD-3.4 filter set + prefilled_filters (Revision 43) ─────────────────── */

describe("the TD-3.4 filter set is accepted in full", () => {
  it("accepts every documented filter, including administrative_group_id", async () => {
    // `group_id` shipped instead of the name TD-3.4 spells out. Because the
    // schema refuses unknown keys, a specification-following client received a
    // 400 from an endpoint claiming to implement the clause — the same defect
    // class as CHANGES.log M3b-14b.
    const id = "00000000-0000-4000-8000-000000000000";
    const res = await call(
      `/calendar?${RANGE}&academic_year_id=${id}&category_id=${id}&level_id=${id}` +
        `&subject_id=${id}&branch_id=${id}&administrative_group_id=${id}&teacher_id=${id}`,
    );
    expect(res.status).toBe(200);
  });

  it("a filter no Event can satisfy narrows the grid to Sessions", async () => {
    // Silently ignoring it would return Events that do not match what was
    // asked — the seeded public Event has no subject at all.
    const id = "00000000-0000-4000-8000-000000000000";
    const withSubject = await call(`/calendar?${RANGE}&subject_id=${id}`);
    expect(withSubject.status).toBe(200);
    expect(mine(withSubject.body).some((r) => r.kind === "event")).toBe(false);

    const unfiltered = await call(`/calendar?${RANGE}`);
    expect(mine(unfiltered.body).some((r) => r.kind === "event")).toBe(true);
  });

  it("still refuses a malformed filter rather than ignoring it", async () => {
    const res = await call(`/calendar?${RANGE}&teacher_id=not-a-uuid`);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("prefilled_filters changes where the dropdowns start, nothing else", () => {
  it("is null for an anonymous caller, not an object of nulls", async () => {
    // "There is nothing to prefill" and "nothing was unambiguous" are different
    // answers; an object of nulls would conflate them.
    const res = await call(`/calendar?${RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.prefilled_filters).toBeNull();
  });

  it("is present for an authenticated caller with the documented keys", async () => {
    const token = bearer(await person("عضوة"), []);
    const res = await call(`/calendar?${RANGE}`, token);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.prefilled_filters!).sort()).toEqual([
      "academic_year_id",
      "branch_id",
      "category_id",
      "level_id",
      "subject_id",
      "teacher_id",
    ]);
  });

  it("is null for a Pending account, exactly as for an anonymous visitor (TD-1)", async () => {
    const token = bearer(await person("قيد الانتظار"), [], "pending");
    const res = await call(`/calendar?${RANGE}`, token);
    expect(res.body.prefilled_filters).toBeNull();
  });

  it("is RETURNED, not APPLIED — the grid is not narrowed by it", async () => {
    // The distinction that matters. `academic_year_id` is prefilled for every
    // active caller (the `is_current` year is unambiguous), and it is a
    // session-only filter: if the server applied its own suggestion, Events
    // would vanish from the response. They must not.
    //
    // Deliberately NOT asserted here: that a signed-in caller sees the same
    // rows as an anonymous one. They do not, and should not — §4.4's tiers give
    // an active account the private tier. Conflating "prefilling changes
    // nothing" with "signing in changes nothing" is what an earlier version of
    // this test got wrong.
    const token = bearer(await person("بلا تسجيل"), []);
    const res = await call(`/calendar?${RANGE}`, token);

    expect(res.status).toBe(200);
    expect(res.body.prefilled_filters!["academic_year_id"]).not.toBeUndefined();
    expect(mine(res.body).some((r) => r.kind === "event")).toBe(true);
  });
});

/**
 * **The occurrence's WIRE key set** (§16.2, R97).
 *
 * ## Why this guard exists
 *
 * `occurrenceDto` lists its keys explicitly — which is correct — and returns
 * `Record<string, unknown>`, which means **no typecheck can see a field the
 * service carries and the wire drops**. R97 added `delivery_mode` to the
 * `Occurrence` interface, every calendar surface rendered nothing, the backend
 * and frontend both typechecked, and the gap was found only by driving a real
 * browser. That is rule P — a complete capability with no reach — and it is the
 * defect this project has shipped most often.
 *
 * Pinning the whole set rather than the two new keys is deliberate: the next
 * field added to the interface fails here, whatever it is called.
 */
const OCCURRENCE_KEYS = [
  "audience_label",
  "branch_id",
  "branch_name",
  "category_id",
  "category_name",
  "date",
  "delivery_mode",
  "description",
  "end_time",
  "hijri_date",
  "hijri_month_ar",
  "id",
  "instructors",
  "kind",
  "level_id",
  "level_name",
  "online_media_mode",
  "recurrence",
  "room_name",
  // R119 — which catalogue row this is, and its structural kind. `kind` says
  // `event` for both a نشاط and a عطلة; these are what tell them apart, and
  // they are how a client marks a holiday without matching an Arabic name.
  "scheduling_type_id",
  "scheduling_type_name",
  "start_time",
  "status",
  "structural_kind",
  "subject_id",
  "subject_name",
  "teaching_mode",
  "title",
  "visibility",
];

describe("the occurrence projection reaches the wire (§16.2, R97)", () => {
  it("publishes exactly the documented key set", async () => {
    const res = await call(`/calendar?${RANGE}`);
    expect(res.status).toBe(200);
    const row = mine(res.body)[0]!;
    expect(Object.keys(row).sort()).toEqual(OCCURRENCE_KEYS);
  });

  it("sends null delivery for an Event — never an invented حضوري (R97.10)", async () => {
    const res = await call(`/calendar?${RANGE}`);
    const events = mine(res.body).filter((r) => r.kind === "event");
    expect(events.length).toBeGreaterThan(0);
    // An Event is R43's non-teaching activity layer and has no delivery model.
    // The key is PRESENT and null, which is a different statement from absent.
    for (const e of events) {
      expect(e).toHaveProperty("delivery_mode");
      expect(e.delivery_mode).toBeNull();
      expect(e.online_media_mode).toBeNull();
    }
  });
});
