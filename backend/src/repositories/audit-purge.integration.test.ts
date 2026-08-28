import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import {
  AUTH_AUDIT_RETENTION_DAYS,
  type Db,
  PURGEABLE_ACTION_TYPES,
  purgeExpiredAuthRows,
} from "./audit.repository.js";

/**
 * `audit.purge` (TD-7, Revision 19) — selection must be an enumerated
 * action-type allowlist AND an age horizon, never age alone and never a prefix
 * match, so indefinitely-retained security events cannot be deleted by
 * accident. These tests assert survival, not just deletion: the interesting
 * failure is a row that vanishes, and that only shows up if you check for it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const RUN_MARKER = `audit-purge-test-${randomUUID()}`;

/** Every action type TD-8 retains INDEFINITELY. None may ever be purged. */
const RETAINED_FOREVER = [
  "consent_gate.override",
  // R81 retired `grade.passfail_override` with the pass/fail concept itself.
  // Rows already written keep their indefinite retention — the purge allowlist
  // is enumerated (R19) and gains nothing, which is what protects them.
  "settings.change",
  "trash.manual_restore",
  "consent.grant",
  "consent.revoke",
  "user.approve",
  "user.suspend",
  "user.delete",
  "familylink.approve",
  "familylink.revoke",
  "grade.publish",
  "quranlog.delete",
  "content.visibility_change",
  "content.global_scope_assigned",
];

/** Plausible FUTURE auth actions that a `auth.*` glob would wrongly sweep in
 *  but the enumerated allowlist must not (post-MVP local auth, §10.1). */
const FUTURE_AUTH_NOT_ON_ALLOWLIST = [
  "auth.password_reset",
  "auth.mfa_enrolled",
];

// A fixed historical clock keeps the selection independent of ambient rows in
// a long-lived development database. The transaction rollback protects state;
// the clock also keeps the returned count attributable to this fixture alone.
const TEST_NOW = new Date("2000-01-01T12:00:00.000Z");
const ANCIENT = new Date(
  TEST_NOW.getTime() -
    (AUTH_AUDIT_RETENTION_DAYS + 30) * 24 * 60 * 60 * 1000,
);
const RECENT = new Date(TEST_NOW.getTime() - 60 * 60 * 1000);

const ROLLBACK = new Error("audit-purge-test rollback");

/**
 * `purgeExpiredAuthRows` intentionally targets qualifying rows platform-wide.
 * Exercising that production query against a shared development database must
 * therefore happen in a transaction that is always rolled back. A tagged
 * teardown cannot restore somebody else's old authentication history after the
 * real delete has already selected it.
 */
async function rolledBack(run: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error === ROLLBACK) return;
    throw error;
  }
}

async function seed(db: Db, actionType: string, createdAt: Date): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: null,
      actionType,
      detail: { marker: RUN_MARKER },
      createdAt,
    },
  });
}

async function countOf(db: Db, actionType: string): Promise<number> {
  return db.auditLog.count({
    where: {
      actionType,
      detail: { path: ["marker"], equals: RUN_MARKER },
    },
  });
}

async function clear(): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { detail: { path: ["marker"], equals: RUN_MARKER } },
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("audit.purge selection criteria (TD-7, Revision 19)", () => {
  it("deletes ONLY allowlisted action types, even when everything is equally ancient", async () => {
    await rolledBack(async (tx) => {
      for (const action of [...PURGEABLE_ACTION_TYPES, ...RETAINED_FOREVER]) {
        await seed(tx, action, ANCIENT);
      }

      const deleted = await purgeExpiredAuthRows(tx, TEST_NOW);
      expect(deleted).toBe(PURGEABLE_ACTION_TYPES.length);

      // The assertion that matters: age alone did NOT decide anything.
      for (const action of RETAINED_FOREVER) {
        expect(
          await countOf(tx, action),
          `${action} must survive audit.purge`,
        ).toBe(1);
      }
      for (const action of PURGEABLE_ACTION_TYPES) {
        expect(
          await countOf(tx, action),
          `${action} should have been purged`,
        ).toBe(0);
      }
    });
  });

  it("is NOT a prefix match — a future auth.* action is not swept in", async () => {
    await rolledBack(async (tx) => {
      for (const action of FUTURE_AUTH_NOT_ON_ALLOWLIST)
        await seed(tx, action, ANCIENT);
      await seed(tx, "auth.login", ANCIENT);

      await purgeExpiredAuthRows(tx, TEST_NOW);

      // These begin with `auth.` but were never declared purgeable, so a glob
      // implementation would have deleted them and this test would fail.
      for (const action of FUTURE_AUTH_NOT_ON_ALLOWLIST) {
        expect(
          await countOf(tx, action),
          `${action} is not on the allowlist`,
        ).toBe(1);
      }
      expect(await countOf(tx, "auth.login")).toBe(0);
    });
  });

  it("respects the age horizon — recent allowlisted rows survive", async () => {
    await rolledBack(async (tx) => {
      for (const action of PURGEABLE_ACTION_TYPES)
        await seed(tx, action, RECENT);

      const deleted = await purgeExpiredAuthRows(tx, TEST_NOW);
      expect(deleted).toBe(0);
      for (const action of PURGEABLE_ACTION_TYPES) {
        expect(await countOf(tx, action)).toBe(1);
      }
    });
  });

  it("needs BOTH conditions — an ancient retained row and a recent auth row both survive", async () => {
    await rolledBack(async (tx) => {
      await seed(tx, "consent_gate.override", ANCIENT); // old, but not allowlisted
      await seed(tx, "auth.refresh", RECENT); // allowlisted, but not old

      expect(await purgeExpiredAuthRows(tx, TEST_NOW)).toBe(0);
      expect(await countOf(tx, "consent_gate.override")).toBe(1);
      expect(await countOf(tx, "auth.refresh")).toBe(1);
    });
  });

  it("the allowlist is exactly the six TD-8 authentication actions", () => {
    expect([...PURGEABLE_ACTION_TYPES].sort()).toEqual(
      [
        "auth.identity_bound",
        "auth.login",
        "auth.login_denied",
        "auth.logout",
        "auth.refresh",
        "auth.token_revoked",
      ].sort(),
    );
    // Guards against a future edit quietly widening the deletable set.
    expect(PURGEABLE_ACTION_TYPES).toHaveLength(6);
  });
});
