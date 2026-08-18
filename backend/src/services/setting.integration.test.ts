import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { actorFor } from "../test-support/actor.js";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  captureConsentVersion,
  restoreConsentVersion,
  type SavedConsentVersion,
} from "../test-support/consent-setting.js";
import { CONSENT_TEXT_VERSION_KEY } from "./registration.service.js";
import { listSettings, updateSetting } from "./setting.service.js";

/**
 * Platform settings (§5.6, TD-3.11, Revision 42).
 *
 * The setting these tests cover is the one that decides whether the platform
 * can accept a registration at all, so its permission boundary, its validation
 * and its audit trail are all asserted rather than assumed.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[setting-test]";

let savedConsentVersion: SavedConsentVersion | null = null;

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

beforeEach(async () => {
  savedConsentVersion ??= await captureConsentVersion(prisma);
  await clear();
  await prisma.systemSetting.deleteMany({
    where: { key: CONSENT_TEXT_VERSION_KEY },
  });
});

afterAll(async () => {
  await clear();
  if (savedConsentVersion)
    await restoreConsentVersion(prisma, savedConsentVersion);
  await prisma.$disconnect();
});

describe("TD-2 / §5.6 — Super Admin only", () => {
  it("lets a Super Admin read and write", async () => {
    const su = await makeUser("super_admin");
    /**
     * **The allow-list grew from one to three** (2026-08-17): the grading scale
     * and the passing grade joined `legal.consent_text_version`.
     *
     * §7 describes `SystemSetting` as *"runtime-editable"* and names the grading
     * scale among its contents; R14 puts both values in it and nowhere else. The
     * rows were seeded by §15.1 and reachable by **nothing in the product** — the
     * same gap that made this list exist for the consent version.
     *
     * Asserted as the exact key SET rather than a length, because what matters is
     * *which* settings are reachable: a length still passes when one is swapped
     * for another, and this list is an authorization surface.
     */
    const listed = await listSettings(prisma, await actorFor(prisma, su));
    // R81 — **the two grading rows are gone**, from the registry and from the
    // database. An exact key set is what makes that assertable: a length check
    // would still pass if one reappeared while another was dropped.
    expect(listed.map((row) => row.key).sort()).toEqual([
      "legal.consent_text_version",
    ]);
    const saved = await updateSetting(
      prisma,
      await actorFor(prisma, su),
      CONSENT_TEXT_VERSION_KEY,
      "2026-08-v1",
      0,
    );
    expect(saved.value).toBe("2026-08-v1");
  });

  it("refuses a plain Admin — this is not a staff setting", async () => {
    // A consent text version decides what every future applicant is recorded
    // as having agreed to. §5.6 puts System Settings under Super Admin alone.
    const admin = await makeUser("admin");
    await expect(
      listSettings(prisma, await actorFor(prisma, admin)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateSetting(
        prisma,
        await actorFor(prisma, admin),
        CONSENT_TEXT_VERSION_KEY,
        "x",
        0,
      ),
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
  it("lists an unconfigured setting rather than hiding it", async () => {
    // Omitting it would hide exactly the row an operator is looking for — the
    // one whose absence stops registration.
    const su = await makeUser("super_admin");
    const rows = await listSettings(prisma, await actorFor(prisma, su));
    expect(rows[0]!.key).toBe(CONSENT_TEXT_VERSION_KEY);
    expect(rows[0]!.value).toBeNull();
    expect(rows[0]!.version).toBe(0);
  });

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
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("validation — a value may never be empty", () => {
  it("refuses blank and whitespace-only", async () => {
    // A blank version would LOOK configured while reproducing the exact failure
    // the setting prevents — harder to diagnose than an absent row, not easier.
    const su = await makeUser("super_admin");
    for (const bad of ["", "   ", "\t\n"]) {
      await expect(
        updateSetting(
          prisma,
          await actorFor(prisma, su),
          CONSENT_TEXT_VERSION_KEY,
          bad,
          0,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(
      await prisma.systemSetting.count({
        where: { key: CONSENT_TEXT_VERSION_KEY },
      }),
    ).toBe(0);
  });

  it("refuses a non-string and an over-long value", async () => {
    const su = await makeUser("super_admin");
    await expect(
      updateSetting(
        prisma,
        await actorFor(prisma, su),
        CONSENT_TEXT_VERSION_KEY,
        42,
        0,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      updateSetting(
        prisma,
        await actorFor(prisma, su),
        CONSENT_TEXT_VERSION_KEY,
        "v".repeat(101),
        0,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("trims before storing, so a padded value is not a different version", async () => {
    const su = await makeUser("super_admin");
    const saved = await updateSetting(
      prisma,
      await actorFor(prisma, su),
      CONSENT_TEXT_VERSION_KEY,
      "  v1  ",
      0,
    );
    expect(saved.value).toBe("v1");
  });
});

describe("TD-8 audit — the previous value is part of the record", () => {
  it("writes setting.update carrying OLD and NEW", async () => {
    const su = await makeUser("super_admin");
    await updateSetting(
      prisma,
      await actorFor(prisma, su),
      CONSENT_TEXT_VERSION_KEY,
      "v1",
      0,
    );
    await updateSetting(
      prisma,
      await actorFor(prisma, su),
      CONSENT_TEXT_VERSION_KEY,
      "v2",
      1,
    );

    const rows = await prisma.auditLog.findMany({
      where: { actorUserId: su, actionType: "setting.update" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    // The first write had no predecessor — null, not an empty string, so
    // "never set" stays distinguishable from "set to nothing".
    expect(rows[0]!.detail).toMatchObject({
      key: CONSENT_TEXT_VERSION_KEY,
      previous_value: null,
      new_value: "v1",
    });
    // Without the OLD value, an auditor cannot answer "what text was in force
    // when this person consented", which is the question they actually ask.
    expect(rows[1]!.detail).toMatchObject({
      previous_value: "v1",
      new_value: "v2",
    });
  });
});

describe("TD-15 — a stale write is refused, never silently applied", () => {
  it("answers VERSION_CONFLICT and leaves the value untouched", async () => {
    const su = await makeUser("super_admin");
    await updateSetting(
      prisma,
      await actorFor(prisma, su),
      CONSENT_TEXT_VERSION_KEY,
      "v1",
      0,
    );

    // Two Super Admins with the form open; the second read version 0.
    await expect(
      updateSetting(
        prisma,
        await actorFor(prisma, su),
        CONSENT_TEXT_VERSION_KEY,
        "v-stale",
        0,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const rows = await listSettings(prisma, await actorFor(prisma, su));
    expect(rows[0]!.value).toBe("v1");
  });
});

describe("§4.1a — changing the setting never rewrites a stored consent", () => {
  it("leaves existing ConsentRecords on the version they were given under", async () => {
    // The normative half of Revision 42. Restamping would assert that people
    // agreed to text they never saw.
    const su = await makeUser("super_admin");
    await updateSetting(
      prisma,
      await actorFor(prisma, su),
      CONSENT_TEXT_VERSION_KEY,
      "v1",
      0,
    );

    const student = await prisma.user.create({
      data: {
        // R80 — every person carries a recorded sex; the column is NOT NULL.
        sex: "female",
        nameArabic: `${TAG} موافِقة`,
        accountStatus: "active",
      },
    });
    await prisma.consentRecord.create({
      data: {
        studentId: student.id,
        consentType: "data_processing",
        granted: true,
        method: "online_form",
        consentTextVersion: "v1",
        grantedByUserId: student.id,
      },
    });

    await updateSetting(
      prisma,
      await actorFor(prisma, su),
      CONSENT_TEXT_VERSION_KEY,
      "v2",
      1,
    );

    const record = await prisma.consentRecord.findFirst({
      where: { studentId: student.id },
    });
    expect(record?.consentTextVersion).toBe("v1");
  });
});

/**
 * **The grading scale was here, and R81 retired it** (2026-08-19).
 *
 * The block that stood here configured `grading.display_scale` and
 * `grading.passing_grade_bp` and asserted them integer-only. The Owner's
 * decision moved the maximum onto the `Exam` and removed the passing threshold
 * outright, so there is nothing left to configure — and the guard that matters
 * now is the one above: **the settings registry lists neither key**, asserted as
 * an exact set so a reappearance fails rather than passing quietly.
 *
 * The per-exam maximum has its own coverage in `exam-max-grade.http.integration.test.ts`;
 * a settings test would be the wrong place for it, because it is not a setting.
 */
