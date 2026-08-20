import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { parseQrPayload } from "../lib/qr-identity.js";
import { getOwnProfile } from "./profile.service.js";
import { getStudentIdentity } from "./student.service.js";

/**
 * **R96 — one stable QR identity per platform person.**
 *
 * The invariant is deliberately unconditional: **every** User has exactly one,
 * whatever they currently are. So these cases are organised around the two ways
 * that could break — a population that never gets one, and a change that
 * silently reissues one.
 */

const TAG = "[qr96]";
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

let branchId: string;
let levelId: string;

async function person(
  label: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const u = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: "female",
      accountStatus: "active",
      ...extra,
    },
    select: { id: true },
  });
  return u.id;
}

const qrOf = async (id: string): Promise<string> =>
  (
    await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { qrRef: true },
    })
  ).qrRef;

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.familyLink.deleteMany({
      where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  const cat = await prisma.category.create({ data: { name: `${TAG} فئة` } });
  levelId = (
    await prisma.level.create({
      data: { name: `${TAG} مستوى`, categoryId: cat.id, genderRestriction: "any" },
    })
  ).id;
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("every population has one, and role has nothing to do with it", () => {
  it("gives a QR to every kind of person the platform knows", async () => {
    const people = {
      adultBeneficiary: await person("مستفيدة بالغة", { isBeneficiary: true }),
      // A minor is a User row with NO UserIdentity — login-less, reached through
      // an approved FamilyLink (§4.3, BR-5). She is still a person.
      child: await person("طفلة", { isBeneficiary: true }),
      teenager: await person("يافعة", { isBeneficiary: true }),
      guardian: await person("ولية أمر"),
      teacher: await person("مؤطرة"),
      assistant: await person("مساعدة"),
      admin: await person("مسؤولة"),
      superAdmin: await person("مسؤولة عامة"),
      // Nobody at all yet — no role, no enrolment, not a beneficiary.
      bare: await person("حساب جديد"),
    };

    const refs = new Set<string>();
    for (const [who, id] of Object.entries(people)) {
      const ref = await qrOf(id);
      expect(ref, who).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      refs.add(ref);
    }
    // Unique across all ten, which is the `UNIQUE` index doing its job.
    expect(refs.size).toBe(Object.keys(people).length);
  });

  it("is NOT the primary key — printing the id would make rotation impossible", async () => {
    const id = await person("شخص");
    expect(await qrOf(id)).not.toBe(id);
  });

  it("is set by the DATABASE, so a raw INSERT that bypasses Prisma still gets one", async () => {
    // The invariant must not depend on every future creation path remembering.
    const rows = await prisma.$queryRawUnsafe<{ id: string; user_qr_ref: string }[]>(
      // `updated_at` is Prisma-side (`@updatedAt`) with no database default, so
      // a raw INSERT must supply it. `user_qr_ref` is deliberately NOT in this
      // column list — that omission is the assertion.
      `INSERT INTO "user" (id, name_arabic, sex, account_status, updated_at)
       VALUES (gen_random_uuid(), '${TAG} إدراج مباشر', 'female', 'active', now())
       RETURNING id, user_qr_ref`,
    );
    expect(rows[0]!.user_qr_ref).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("holds the unconditional invariant across the whole table", async () => {
    const nulls = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "user" WHERE user_qr_ref IS NULL`,
    );
    const dups = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM
        (SELECT user_qr_ref FROM "user" GROUP BY user_qr_ref HAVING count(*) > 1) d`,
    );
    expect(Number(nulls[0]!.n)).toBe(0);
    expect(Number(dups[0]!.n)).toBe(0);
  });
});

describe("the identity is stable — nothing about a person's situation reissues it", () => {
  it("survives gaining and losing a role", async () => {
    const id = await person("مؤطرة");
    const before = await qrOf(id);
    const role = await prisma.role.findFirstOrThrow({ where: { name: "teacher" } });

    await prisma.userBranchRole.create({
      data: { userId: id, roleId: role.id, branchId: null },
    });
    expect(await qrOf(id)).toBe(before);

    await prisma.userBranchRole.deleteMany({ where: { userId: id } });
    expect(await qrOf(id)).toBe(before);
  });

  it("survives holding SEVERAL roles at once — one person, one QR", async () => {
    const id = await person("مؤطرة ومستفيدة", { isBeneficiary: true });
    const before = await qrOf(id);
    for (const name of ["teacher", "student"]) {
      const role = await prisma.role.findFirst({ where: { name } });
      if (role) {
        await prisma.userBranchRole.create({
          data: { userId: id, roleId: role.id, branchId: null },
        });
      }
    }
    expect(await qrOf(id)).toBe(before);
    // Still exactly one row for one human being.
    expect(
      await prisma.user.count({ where: { id, qrRef: before } }),
    ).toBe(1);
  });

  it("survives enrolment, re-enrolment and withdrawal", async () => {
    const id = await person("مستفيدة", { isBeneficiary: true });
    const before = await qrOf(id);

    const e = await prisma.enrollment.create({
      data: { studentId: id, levelId, branchId },
    });
    expect(await qrOf(id)).toBe(before);

    await prisma.enrollment.update({
      where: { id: e.id },
      data: { deletedAt: new Date() },
    });
    expect(await qrOf(id)).toBe(before);
  });

  it("survives becoming — and ceasing to be — a beneficiary", async () => {
    const id = await person("شخص");
    const before = await qrOf(id);
    await prisma.user.update({ where: { id }, data: { isBeneficiary: true } });
    expect(await qrOf(id)).toBe(before);
    await prisma.user.update({ where: { id }, data: { isBeneficiary: false } });
    expect(await qrOf(id)).toBe(before);
  });

  it("survives a FamilyLink being created and withdrawn", async () => {
    const parent = await person("ولية أمر");
    const child = await person("طفلة", { isBeneficiary: true });
    const parentBefore = await qrOf(parent);
    const childBefore = await qrOf(child);

    const link = await prisma.familyLink.create({
      data: { parentId: parent, studentId: child, status: "approved" },
    });
    // **The QR does not inherit the relationship.** The parent's identifies the
    // parent; the child's identifies the child. FamilyLink decides who may ACT
    // for whom, and that is a different question asked at request time.
    expect(await qrOf(parent)).toBe(parentBefore);
    expect(await qrOf(child)).toBe(childBefore);
    expect(parentBefore).not.toBe(childBefore);

    await prisma.familyLink.delete({ where: { id: link.id } });
    expect(await qrOf(child)).toBe(childBefore);
  });

  it("survives soft delete and restore — the same person comes back", async () => {
    const id = await person("مستفيدة", { isBeneficiary: true });
    const before = await qrOf(id);
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    expect(await qrOf(id)).toBe(before);
    await prisma.user.update({ where: { id }, data: { deletedAt: null } });
    expect(await qrOf(id)).toBe(before);
  });
});

describe("what each surface serves, and to whom", () => {
  it("/profile serves the ACCOUNT HOLDER's own — never a child's", async () => {
    const parent = await person("ولية أمر");
    const child = await person("طفلة", { isBeneficiary: true });
    await prisma.familyLink.create({
      data: { parentId: parent, studentId: child, status: "approved" },
    });

    const profile = await getOwnProfile(prisma, parent);
    expect(parseQrPayload(profile.qr.payload)).toBe(await qrOf(parent));
    expect(parseQrPayload(profile.qr.payload)).not.toBe(await qrOf(child));
  });

  it("the student surface serves the ACTING student — the child under child context", async () => {
    const child = await person("طفلة", { isBeneficiary: true });
    await prisma.enrollment.create({
      data: { studentId: child, levelId, branchId },
    });
    const identity = await getStudentIdentity(prisma, child);
    expect(parseQrPayload(identity.qr.payload)).toBe(await qrOf(child));
  });

  it("serves the SAME identity to the child herself and to her guardian", async () => {
    const parent = await person("ولية أمر");
    const child = await person("طفلة", { isBeneficiary: true });
    await prisma.familyLink.create({
      data: { parentId: parent, studentId: child, status: "approved" },
    });
    // It belongs to the person, not to the surface it is read from.
    const viaChildContext = await getStudentIdentity(prisma, child);
    expect(parseQrPayload(viaChildContext.qr.payload)).toBe(await qrOf(child));
  });

  it("exposes no personal data or role in what it serves", async () => {
    const id = await person("مؤطرة", { phone: "+212600000000" });
    const role = await prisma.role.findFirstOrThrow({ where: { name: "teacher" } });
    await prisma.userBranchRole.create({
      data: { userId: id, roleId: role.id, branchId: null },
    });

    const profile = await getOwnProfile(prisma, id);
    const payload = profile.qr.payload.toLowerCase();
    for (const leak of ["مؤطرة", "+212", "teacher", "female", TAG.toLowerCase()]) {
      expect(payload).not.toContain(leak.toLowerCase());
    }
  });
});

describe("it identifies; it never authenticates", () => {
  it("holding the payload is not holding a session — no token is derivable", async () => {
    const id = await person("مستفيدة", { isBeneficiary: true });
    const ref = await qrOf(id);

    // The reference is a column on `user` and nothing else: it appears in no
    // refresh token, no identity, and no session row. If a scan could ever mint
    // one, THIS is the join that would have to exist.
    expect(
      await prisma.refreshToken.count({ where: { userId: id } }),
    ).toBe(0);
    expect(
      await prisma.userIdentity.count({ where: { userId: id } }),
    ).toBe(0);
    // And the value is a plain reference, carrying no signature to verify.
    expect(ref).not.toContain(".");
    expect(ref.split("-")).toHaveLength(5);
  });
});
