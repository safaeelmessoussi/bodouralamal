import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { actorFor } from "../test-support/actor.js";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import { listSettings, updateSetting } from "./setting.service.js";

/**
 * Platform settings (§5.6, TD-3.11, Revision 42; **R119**).
 *
 * ## What this suite is, after R119
 *
 * It used to cover `legal.consent_text_version` — validation, audit, TD-15
 * locking, and the normative *«a change never rewrites a stored consent»*. The
 * Owner replaced that setting with `LegalConsentText`, where the version and
 * its exact wording are one immutable record, so **the allow-list is now
 * empty** and those properties belong to
 * `legal-consent-text.integration.test.ts`, which asserts every one of them
 * against the mechanism that actually holds them.
 *
 * What remains here is the part that is about the ALLOW-LIST ITSELF, and it is
 * worth keeping precisely because there is nothing on it: the generic machinery
 * is §5.6's contract and will carry settings again, and an authorization
 * boundary that is only exercised while something happens to be behind it is an
 * authorization boundary nobody is testing.
 *
 * The exact-key-set assertion is the guard that matters: it fails if a key
 * reappears, which is how *«two independently editable answers to which wording
 * is in force»* would come back.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[setting-test]";

async function makeUser(role: string | null): Promise<string> {
  const user = await prisma.user.create({
    data: {
      // R80 — every person carries a recorded sex; the column is NOT NULL.
      sex: "female",
      nameArabic: `${TAG} ${role ?? "no-role"}`,
      accountStatus: "active",
    },
  });
  if (role) {
    const roleRow = await prisma.role.findUnique({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: roleRow!.id, branchId: null },
    });
  }
  return user.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  // `ConsentRecord.student` and `SystemSetting.updatedBy` are both RESTRICT, so
  // a failed assertion mid-test used to leave rows that made `clear()` itself
  // fail — every later test in the file then failed for a reason unrelated to
  // what it was testing. Teardown must not depend on the test body finishing.
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.systemSetting.updateMany({
    where: { updatedById: { in: ids } },
    data: { updatedById: null },
  });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(clear);

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("TD-2 / §5.6 — Super Admin only", () => {
  it("lets a Super Admin read, and lists exactly the allow-list", async () => {
    /**
     * **The allow-list is EMPTY, and that is the assertion.**
     *
     * It held `legal.consent_text_version` until R119 replaced it with
     * `LegalConsentText`. Asserted as an exact key SET rather than a count,
     * because what matters is *which* settings are reachable: a count still
     * passes when one key is swapped for another, and this list is an
     * authorization surface. If the consent key ever reappears here, this fails
     * — which is the point, since two editable answers to *which wording is in
     * force* is precisely what R119 removed.
     */
    const su = await makeUser("super_admin");
    const listed = await listSettings(prisma, await actorFor(prisma, su));
    expect(listed.map((row) => row.key)).toEqual([]);
  });

  it("refuses a plain Admin — this is not a staff setting", async () => {
    // §5.6 puts System Settings under Super Admin alone, and the refusal is
    // asserted on BOTH verbs: a read-only leak is still a leak.
    const admin = await makeUser("admin");
    await expect(
      listSettings(prisma, await actorFor(prisma, admin)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateSetting(prisma, await actorFor(prisma, admin), "any.key", "x", 0),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an account with no role at all", async () => {
    const nobody = await makeUser(null);
    await expect(
      listSettings(prisma, await actorFor(prisma, nobody)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the writable surface is an allow-list", () => {
  it("refuses a key that is not writable through this API", async () => {
    // NOT_FOUND rather than FORBIDDEN (§20 rule 17): a 403 would confirm the
    // key exists somewhere, and a typo must create nothing.
    const su = await makeUser("super_admin");
    await expect(
      // `content.quarantine_purge_days` is a real `SystemSetting` concern that
      // this API deliberately does not expose — a retention window is an
      // operational decision, not a screen control.
      updateSetting(
        prisma,
        await actorFor(prisma, su),
        "content.quarantine_purge_days",
        "90",
        0,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateSetting(prisma, await actorFor(prisma, su), "made.up.key", "x", 0),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /**
   * **The retired key is refused like any other unlisted key** (R119).
   *
   * The transition's whole point: `legal.consent_text_version` is not merely
   * *not offered* — it is **unreachable**, so a client that still knows the key
   * cannot write it and there is no second answer to *which wording is in
   * force*. The stored row, if the installation has one, is left alone; nothing
   * reads or writes it.
   */
  it("refuses the RETIRED consent key, so there is one authority", async () => {
    const su = await makeUser("super_admin");
    const before = await prisma.systemSetting.findUnique({
      where: { key: "legal.consent_text_version" },
      select: { value: true, version: true },
    });
    await expect(
      updateSetting(
        prisma,
        await actorFor(prisma, su),
        "legal.consent_text_version",
        "forged-v9",
        0,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const after = await prisma.systemSetting.findUnique({
      where: { key: "legal.consent_text_version" },
      select: { value: true, version: true },
    });
    // Unchanged, whether or not the row exists here: the refusal writes
    // nothing, and the record of what was last in force is not destroyed.
    expect(after).toEqual(before);
  });
});

/**
 * **The grading scale was here, and R81 retired it** (2026-08-19); the consent
 * text version was here, and R119 replaced it.
 *
 * What stood in this space configured `grading.display_scale`,
 * `grading.passing_grade_bp` and `legal.consent_text_version`, and asserted
 * validation, TD-8 audit, TD-15 locking and §4.1a's *«a change never rewrites a
 * stored consent»* against them. Every one of those properties still holds and
 * is asserted — against `LegalConsentText`, in
 * `legal-consent-text.integration.test.ts`, which is where the mechanism now
 * lives. The per-exam maximum has its own coverage in
 * `exam-max-grade.http.integration.test.ts`.
 *
 * **The guard that survives here is the exact key set above**, because it is
 * the one that fails if any of them comes back.
 */
