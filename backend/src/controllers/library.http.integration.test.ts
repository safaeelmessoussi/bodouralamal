import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueAccessToken } from "../lib/access-token.js";
import { loadConfig } from "../lib/config.js";
import { clearTestContentRetirements } from '../test-support/storage-retirement.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { httpCall } from "../test-support/http-client.js";

/** R66 — an enrolment carries its own branch, taken from the group so the
 *  composite FK `(administrative_group_id, branch_id)` holds. */
async function branchOf(groupId: string): Promise<string> {
  const g = await prisma.administrativeGroup.findUniqueOrThrow({
    where: { id: groupId },
    select: { branchId: true },
  });
  return g.branchId;
}

/**
 * `GET /library` over real HTTP (TD-3.13, §5.2, §4.9, Revision 43).
 *
 * **The two claims this endpoint makes are both only checkable here.** That
 * signing in *reorders and never unlocks* is a statement about two responses to
 * the same URL with different credentials. And that the endpoint **never
 * answers `401`** is a property of the middleware chain, not of the service —
 * a public surface that can `401` is not public, and only a real request
 * through the real router can show which it is.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = "[http-library-test]";
const YEAR_LABEL = "2097-2098";

/**
 * The exact wire shape. The **labels** joined it when the §5.2 library screen
 * was built: that view groups Category → Level → Academic Year → Branch, and
 * **no public endpoint publishes Subject or Academic Year names** —
 * `/admin/subjects` and `/admin/academic-years` are Admin-only by design (R30).
 * Carrying them makes the response self-sufficient, which TD-3.4 already
 * requires of the calendar; the alternatives were widening that cached payload
 * for an unrelated screen, or a public reference surface exposing the whole
 * curriculum to anonymous callers.
 *
 * They are **labels, never identifiers** — the ids remain what a client filters
 * and links by, and both are asserted below.
 */
const ITEM_KEYS = [
  "academic_year_id",
  "academic_year_label",
  // R169 §10 — the item's OTHER Levels (`level_id` is its home).
  "additional_levels",
  "branch_id",
  "branch_name",
  "category_id",
  "category_name",
  "created_at",
  "description",
  "id",
  "level_id",
  "level_name",
  // R170 §3 — the consent WARNING: a boolean for staff, `null` for everyone
  // else. It replaced the withheld `consent_forced_private`.
  "media_consent_missing",
  "mime_type",
  /* R99.12 — «هذا تسجيل حصة». It joined the projection with the edit dialog
     that seeds its control from it (2026-09-02) and this exact-key guard was
     not updated with it, so the gate was red on develop before R119 touched
     anything. It states what the file IS, never consent state. */
  "origin",
  "size_bytes",
  "subject_id",
  "subject_name",
  "title",
  "visibility",
  // R167 §5 — addressed to every Level of its Category.
  "whole_category",
];

interface Res {
  status: number;
  body: Record<string, unknown> & {
    error?: { code?: string };
    data?: Record<string, unknown>[];
  };
}

async function call(path: string, token?: string): Promise<Res> {
  return httpCall<Res["body"]>(BASE, "GET", path, { token });
}

function bearer(
  userId: string,
  scopes: { role: string; branches: string[] | null }[],
  accountStatus = "active",
): string {
  return issueAccessToken(
    {
      userId,
      roleScopes: scopes as never,
      accountStatus: accountStatus as never,
    },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeUser(label: string): Promise<string> {
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

let branchA: string;
let branchB: string;
let categoryId: string;
let levelId: string;
let otherLevelId: string;
let subjectId: string;
let academicYearId: string;
let studentToken: string;
let strangerToken: string;
let pendingToken: string;
let teacherToken: string;
let parentToken: string;

/** Declared with its keys so an indexing typo is a compile error, not a
 *  runtime `undefined` that quietly makes an assertion vacuous. */
const ids = {
  publicA: "",
  publicB: "",
  global: "",
  privateOwn: "",
  privateOther: "",
  hidden: "",
  forced: "",
};

async function content(
  label: string,
  over: {
    visibility?: string;
    branchId?: string | null;
    levelId?: string;
    forced?: boolean;
    wholeCategory?: boolean;
  } = {},
): Promise<string> {
  const row = await prisma.educationalContent.create({
    data: {
      title: `${TAG} ${label}`,
      levelId: over.levelId ?? levelId,
      subjectId,
      academicYearId,
      branchId: over.branchId === undefined ? branchA : over.branchId,
      visibility: (over.visibility ?? "public") as never,
      mediaConsentMissing: over.forced ?? false,
      wholeCategory: over.wholeCategory ?? false,
      storageBucket: "content",
      storageKey: `${TAG}/${label}-${Date.now()}-${Math.random()}`,
      originalFilename: `${label}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
    },
    select: { id: true },
  });
  return row.id;
}

async function clear(): Promise<void> {
  const levels = await prisma.level.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await clearTestContentRetirements(prisma, { levelId: { in: levelIds } });
  await prisma.educationalContent.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  const groups = await prisma.administrativeGroup.findMany({
    where: { levelId: { in: levelIds } },
    select: { id: true },
  });
  await prisma.enrollment.deleteMany({
    where: { administrativeGroupId: { in: groups.map((g) => g.id) } },
  });
  await prisma.administrativeGroup.deleteMany({
    where: { id: { in: groups.map((g) => g.id) } },
  });
  await prisma.levelSubject.deleteMany({
    where: { levelId: { in: levelIds } },
  });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.academicYear.deleteMany({ where: { label: YEAR_LABEL } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.familyLink.deleteMany({
      where: { parentId: { in: userIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: userIds } },
    });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(
    () => null,
  );
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: ` +
        "docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build api",
    );
  }
  await clear();

  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } }))
    .id;
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId, genderRestriction: "any" },
    })
  ).id;
  otherLevelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى آخر`, categoryId, genderRestriction: "any" },
    })
  ).id;
  subjectId = (await prisma.subject.create({ data: { name: `${TAG} مادة` } }))
    .id;
  await prisma.levelSubject.create({ data: { levelId, subjectId } });
  academicYearId = (
    await prisma.academicYear.create({ data: { label: YEAR_LABEL } })
  ).id;

  ids.publicB = await content("عام-ب", { branchId: branchB });
  ids.global = await content("عالمي", { branchId: null });
  ids.publicA = await content("عام-أ", { branchId: branchA });
  ids.privateOwn = await content("خاص", { visibility: "private" });
  ids.privateOther = await content("خاص-آخر", {
    visibility: "private",
    levelId: otherLevelId,
  });
  ids.hidden = await content("مخفي", { visibility: "hidden" });
  // R170 §3: a public recording whose audience lacks a media release — WARNED
  // to staff, served like any public item.
  ids.forced = await content("مسجّل-بتنبيه", { forced: true });

  const groupA = await prisma.administrativeGroup.create({
    data: { name: `${TAG} مجموعة`, levelId, branchId: branchA },
  });

  // Enrolled at branch A, in `levelId` — so branch A sorts first for them and
  // the private item for that Level is theirs to see.
  const studentId = await makeUser("طالبة");
  await prisma.enrollment.create({
    data: {
      studentId,
      administrativeGroupId: groupA.id,
      levelId,
      branchId: await branchOf(groupA.id),
    },
  });
  studentToken = bearer(studentId, []);

  // Signed in, active, enrolled nowhere: the public tier and no first bucket.
  strangerToken = bearer(await makeUser("غريبة"), []);
  pendingToken = bearer(await makeUser("قيد الانتظار"), [], "pending");
  teacherToken = bearer(await makeUser("أستاذة"), [
    { role: "teacher", branches: [branchB] },
  ]);

  const parentId = await makeUser("ولي");
  await prisma.familyLink.create({
    data: { parentId, studentId, status: "approved" },
  });
  parentToken = bearer(parentId, []);
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const MINE = `/library?level_id=`;
/** Only this suite's rows, so a shared database cannot perturb an assertion. */
const scoped = `/library?academic_year_id=`;

async function titlesFor(token?: string): Promise<string[]> {
  const res = await call(`${scoped}${academicYearId}&page_size=100`, token);
  expect(res.status).toBe(200);
  return res.body.data!.map((r) => String(r.id));
}

describe("the endpoint is public and never answers 401", () => {
  it("serves an anonymous caller", async () => {
    const res = await call(`${scoped}${academicYearId}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data![0]!).sort()).toEqual(ITEM_KEYS);
    // Every label resolves to something a heading can render: an id echoed as
    // its own name would satisfy the key set and be useless on screen.
    const item = res.body.data![0]! as Record<string, unknown>;
    for (const label of [
      "category_name",
      "level_name",
      "subject_name",
      "academic_year_label",
    ]) {
      expect(typeof item[label]).toBe("string");
      expect(item[label]).not.toBe(
        item[label.replace(/_(name|label)$/, "_id")],
      );
    }
  });

  it("IGNORES an invalid credential rather than refusing it", async () => {
    // A public surface that can 401 is not public (Revision 34 posture).
    const res = await call(`${scoped}${academicYearId}`, "not-a-real-token");
    expect(res.status).toBe(200);
  });

  it("never publishes the object location, and the retired forced flag", async () => {
    // storage_key on a PUBLIC endpoint would hand every anonymous visitor the
    // one input the §4.9 permission check exists to protect. The consent
    // WARNING is published to staff only (R170 §3) and is asserted above.
    const res = await call(`${scoped}${academicYearId}`);
    for (const row of res.body.data!) {
      for (const leak of [
        "storage_key",
        "storage_bucket",
        "original_filename",
        "consent_forced_private",
        "storageKey",
        "deleted_at",
      ]) {
        expect(row).not.toHaveProperty(leak);
      }
    }
  });
});

describe("§4.9 tiers filter every result set", () => {
  it("anonymous sees public only — never private, never hidden", async () => {
    const seen = await titlesFor();
    expect(seen).toContain(ids.publicA);
    expect(seen).toContain(ids.global);
    expect(seen).not.toContain(ids.privateOwn);
    expect(seen).not.toContain(ids.hidden);
  });

  it("R170 §3: a WARNED item is as visible as its visibility says — the warning reaches staff, and nobody else", async () => {
    // The Owner retired BR-2's forced-private exclusion: nothing is forced, and
    // the public tier is the row's own `visibility`. What differs by reader is
    // the WARNING: a boolean for staff, `null` for an anonymous reader.
    expect(await titlesFor()).toContain(ids.forced);
    const anonymous = (await call(`${scoped}${academicYearId}&page_size=100`)).body.data!;
    const teacher = (await call(`${scoped}${academicYearId}&page_size=100`, teacherToken)).body.data!;
    const anonRow = anonymous.find((r) => r.id === ids.forced) as Record<string, unknown> | undefined;
    const staffRow = teacher.find((r) => r.id === ids.forced) as Record<string, unknown> | undefined;
    expect(anonRow?.["media_consent_missing"]).toBeNull();
    expect(staffRow?.["media_consent_missing"]).toBe(true);
    const plainStaffRow = teacher.find((r) => r.id === ids.publicA) as Record<string, unknown> | undefined;
    expect(plainStaffRow?.["media_consent_missing"]).toBe(false);
  });

  it("a Pending account sees exactly what an anonymous visitor sees (TD-1)", async () => {
    // The account exists and grants nothing.
    expect(new Set(await titlesFor(pendingToken))).toEqual(
      new Set(await titlesFor()),
    );
  });

  it("an enrolled student sees private content for THEIR level and no other", async () => {
    const seen = await titlesFor(studentToken);
    expect(seen).toContain(ids.privateOwn);
    expect(seen).not.toContain(ids.privateOther);
    // Hidden is excluded from Student directories (§4.9 tier 3).
    expect(seen).not.toContain(ids.hidden);
  });

  it("R167 §5 — «كل مستويات الفئة»: filed under ANOTHER Level of her Category, it is hers; of another Category, it is not", async () => {
    // `privateOther` is the control: same Level, same tier, NOT whole-category.
    const shared = await content("خاص-كل-المستويات", {
      visibility: "private",
      levelId: otherLevelId,
      wholeCategory: true,
    });
    const foreignCategory = await prisma.category.create({ data: { name: `${TAG} فئة أخرى` } });
    const foreignLevel = await prisma.level.create({
      data: { name: `${TAG} مستوى فئة أخرى`, categoryId: foreignCategory.id, genderRestriction: "any" },
    });
    const foreign = await content("خاص-فئة-أخرى", {
      visibility: "private",
      levelId: foreignLevel.id,
      wholeCategory: true,
    });

    const seen = await titlesFor(studentToken);
    expect(seen).toContain(shared);
    expect(seen).not.toContain(ids.privateOther);
    expect(seen).not.toContain(foreign);
    // The tier is unchanged for everybody else: it widens WHICH Levels, never who.
    expect(await titlesFor()).not.toContain(shared);
    expect(await titlesFor(strangerToken)).not.toContain(shared);
    expect(await titlesFor(parentToken)).toContain(shared);

    // Her own Level's shelf holds it — filtering by her Level must not hide
    // exactly what was made for everybody — and the row says why it is there.
    const shelf = await call(`/library?level_id=${levelId}&page_size=100`, studentToken);
    const row = (shelf.body.data as { id: string; whole_category: boolean; level_id: string }[]).find(
      (item) => item.id === shared,
    );
    expect(row).toMatchObject({ whole_category: true, level_id: otherLevelId });
    const foreignShelf = await call(`/library?level_id=${levelId}&page_size=100`, teacherToken);
    expect((foreignShelf.body.data as { id: string }[]).map((item) => item.id)).not.toContain(foreign);
  });

  it("R169 §10 — an item that ALSO belongs to her Level is hers, on her Level's shelf, and says every Level it belongs to", async () => {
    // Home Level: the OTHER one. Her Level is named as an additional Level —
    // the recording of a class that addressed both.
    const both = await content("خاص-لمستويين", { visibility: "private", levelId: otherLevelId });
    await prisma.educationalContentLevel.create({ data: { contentId: both, levelId } });

    const seen = await titlesFor(studentToken);
    expect(seen).toContain(both);
    // The control: same home Level, same tier, no additional Level — not hers.
    expect(seen).not.toContain(ids.privateOther);
    // It widens WHICH Levels, never who: nobody outside them gains anything.
    expect(await titlesFor()).not.toContain(both);
    expect(await titlesFor(strangerToken)).not.toContain(both);
    expect(await titlesFor(parentToken)).toContain(both);

    const shelf = await call(`/library?level_id=${levelId}&page_size=100`, studentToken);
    const row = (
      shelf.body.data as { id: string; level_id: string; additional_levels: { id: string; name: string }[] }[]
    ).find((item) => item.id === both);
    expect(row?.level_id).toBe(otherLevelId);
    expect(row?.additional_levels.map((level) => level.id)).toEqual([levelId]);

    // The home Level is never ALSO an additional one — the database says so.
    await expect(
      prisma.educationalContentLevel.create({ data: { contentId: both, levelId: otherLevelId } }),
    ).rejects.toThrow();
  });

  it("a parent of that student sees it too, with no child context header", async () => {
    // §4.9 grants the tier to "Parents of such students". The library is one
    // shared reading surface (§5.2) — a parent who had to switch context could
    // not compare two children's materials at all.
    expect(await titlesFor(parentToken)).toContain(ids.privateOwn);
  });

  it("a signed-in stranger enrolled nowhere sees the public tier only", async () => {
    const seen = await titlesFor(strangerToken);
    expect(seen).toContain(ids.publicA);
    expect(seen).not.toContain(ids.privateOwn);
  });

  it("a teacher sees hidden — it is excluded from Student/Parent directories, not from staff", async () => {
    expect(await titlesFor(teacherToken)).toContain(ids.hidden);
  });
});

describe("signing in REORDERS and never unlocks (TD-3.13, §5.2)", () => {
  it("own branch → Global → other branches", async () => {
    const seen = await titlesFor(studentToken);
    const at = (id: string): number => seen.indexOf(id);
    // The student is enrolled at branch A.
    expect(at(ids.publicA)).toBeLessThan(at(ids.global));
    // Global is second, not last: `branch_id IS NULL` is *Global*, not
    // *unknown* (§7), and a platform-wide resource beats another branch's.
    expect(at(ids.global)).toBeLessThan(at(ids.publicB));
  });

  it("a caller with no branch context still gets Global before other branches", async () => {
    const seen = await titlesFor(strangerToken);
    expect(seen.indexOf(ids.global)).toBeLessThan(seen.indexOf(ids.publicB));
  });

  it("the anonymous and signed-in PUBLIC sets are identical — order is the only difference", async () => {
    // The claim TD-3.13 makes, checked as a set comparison rather than a
    // sequence one. `strangerToken` is used because a student legitimately
    // unlocks a private tier, which would confuse "same set".
    const anon = await titlesFor();
    const signedIn = await titlesFor(strangerToken);
    expect(new Set(signedIn)).toEqual(new Set(anon));
  });
});

describe("the filter set is identical for everyone (§5.2)", () => {
  it("filters by level, subject, academic year and category", async () => {
    const byLevel = await call(
      `${MINE}${otherLevelId}&academic_year_id=${academicYearId}`,
    );
    expect(byLevel.status).toBe(200);
    expect(byLevel.body.data!.every((r) => r.level_id === otherLevelId)).toBe(
      true,
    );

    const byCategory = await call(
      `${scoped}${academicYearId}&category_id=${categoryId}&page_size=100`,
    );
    // Category reaches content through the Level it owns — content carries no
    // category of its own.
    expect(byCategory.body.data!.length).toBeGreaterThan(0);

    const bySubject = await call(
      `${scoped}${academicYearId}&subject_id=${subjectId}`,
    );
    expect(bySubject.body.data!.every((r) => r.subject_id === subjectId)).toBe(
      true,
    );
  });

  /**
   * **R75.6's naming rule is the SERVER's now** (R99).
   *
   * It was implemented in the browser, which was correct while a browser was the
   * only thing that could produce a recording. R99 adds the platform's own
   * server-side capture, ingested by a worker with no browser near it, so the
   * rule moved to one place both producers can reach. The library screen has no
   * occurrence — R75.6's *title · description · date* is about a class — so it is
   * named after the Subject in view and the association's own date, numbered by
   * the same shared rule. **R172 §3 — composed exactly as a class recording's
   * name**: «تسجيل صوتي — الـمادة — من سجّلت — التاريخ الوقت», and still a name
   * when no Subject is in view (it used to be `null`, and the Owner's phone
   * then asked her to type one).
   */
  it("suggests a recording name composed like a class recording's — with the Subject in view, and without", async () => {
    const withSubject = await call(
      `${scoped}${academicYearId}&subject_id=${subjectId}`,
      teacherToken,
    );
    const named = String(withSubject.body["suggested_recording_name"]);
    expect(named.startsWith("تسجيل صوتي — ")).toBe(true);
    expect(named).toContain(`${TAG} مادة`);
    // …the person recording, by her display name (§20 rule 12)…
    expect(named).toContain(`${TAG} أستاذة`);
    // …and the association's date and time close it (TD-11), like a class recording.
    expect(named).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const withoutSubject = await call(`${scoped}${academicYearId}`, teacherToken);
    const bare = String(withoutSubject.body["suggested_recording_name"]);
    expect(bare.startsWith("تسجيل صوتي — ")).toBe(true);
    expect(bare).not.toContain(`${TAG} مادة`);

    // Nobody signed in records nothing: no name for nobody.
    const anonymous = await call(`${scoped}${academicYearId}&subject_id=${subjectId}`);
    expect(anonymous.body["suggested_recording_name"]).toBeNull();
  });

  it("a malformed filter is a 400, not an empty list", async () => {
    const res = await call("/library?level_id=not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_FAILED");
  });

  it("paginates per TD-10, and the total agrees with the rows the filter allows", async () => {
    const res = await call(`${scoped}${academicYearId}&page=1&page_size=2`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 2 });
    // One WHERE builds both the page and the count; two copies would show up
    // here as a total that disagrees with what the caller may actually read.
    const all = await titlesFor();
    expect((res.body.meta as { total: number }).total).toBe(all.length);
  });
});
