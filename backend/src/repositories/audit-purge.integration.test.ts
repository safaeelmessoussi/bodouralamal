import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import {
  AUTH_AUDIT_RETENTION_DAYS,
  PURGEABLE_ACTION_TYPES,
  purgeExpiredAuthRows,
} from './audit.repository.js';

/**
 * `audit.purge` (TD-7, Revision 19) — selection must be an enumerated
 * action-type allowlist AND an age horizon, never age alone and never a prefix
 * match, so indefinitely-retained security events cannot be deleted by
 * accident. These tests assert survival, not just deletion: the interesting
 * failure is a row that vanishes, and that only shows up if you check for it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);

/** Every action type TD-8 retains INDEFINITELY. None may ever be purged. */
const RETAINED_FOREVER = [
  'consent_gate.override',
  'grade.passfail_override',
  'settings.change',
  'trash.manual_restore',
  'consent.grant',
  'consent.revoke',
  'user.approve',
  'user.suspend',
  'user.delete',
  'familylink.approve',
  'familylink.revoke',
  'grade.publish',
  'quranlog.delete',
  'content.visibility_change',
  'content.global_scope_assigned',
];

/** Plausible FUTURE auth actions that a `auth.*` glob would wrongly sweep in
 *  but the enumerated allowlist must not (post-MVP local auth, §10.1). */
const FUTURE_AUTH_NOT_ON_ALLOWLIST = ['auth.password_reset', 'auth.mfa_enrolled'];

const ANCIENT = new Date(Date.now() - (AUTH_AUDIT_RETENTION_DAYS + 30) * 24 * 60 * 60 * 1000);
const RECENT = new Date(Date.now() - 60 * 60 * 1000);

async function seed(actionType: string, createdAt: Date): Promise<void> {
  await prisma.auditLog.create({
    data: { actorUserId: null, actionType, detail: { marker: 'audit-purge-test' }, createdAt },
  });
}

async function countOf(actionType: string): Promise<number> {
  return prisma.auditLog.count({
    where: { actionType, detail: { path: ['marker'], equals: 'audit-purge-test' } },
  });
}

async function clear(): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { detail: { path: ['marker'], equals: 'audit-purge-test' } },
  });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('audit.purge selection criteria (TD-7, Revision 19)', () => {
  it('deletes ONLY allowlisted action types, even when everything is equally ancient', async () => {
    for (const action of [...PURGEABLE_ACTION_TYPES, ...RETAINED_FOREVER]) {
      await seed(action, ANCIENT);
    }

    const deleted = await purgeExpiredAuthRows(prisma);
    expect(deleted).toBe(PURGEABLE_ACTION_TYPES.length);

    // The assertion that matters: age alone did NOT decide anything.
    for (const action of RETAINED_FOREVER) {
      expect(await countOf(action), `${action} must survive audit.purge`).toBe(1);
    }
    for (const action of PURGEABLE_ACTION_TYPES) {
      expect(await countOf(action), `${action} should have been purged`).toBe(0);
    }
  });

  it('is NOT a prefix match — a future auth.* action is not swept in', async () => {
    for (const action of FUTURE_AUTH_NOT_ON_ALLOWLIST) await seed(action, ANCIENT);
    await seed('auth.login', ANCIENT);

    await purgeExpiredAuthRows(prisma);

    // These begin with `auth.` but were never declared purgeable, so a glob
    // implementation would have deleted them and this test would fail.
    for (const action of FUTURE_AUTH_NOT_ON_ALLOWLIST) {
      expect(await countOf(action), `${action} is not on the allowlist`).toBe(1);
    }
    expect(await countOf('auth.login')).toBe(0);
  });

  it('respects the age horizon — recent allowlisted rows survive', async () => {
    for (const action of PURGEABLE_ACTION_TYPES) await seed(action, RECENT);

    const deleted = await purgeExpiredAuthRows(prisma);
    expect(deleted).toBe(0);
    for (const action of PURGEABLE_ACTION_TYPES) {
      expect(await countOf(action)).toBe(1);
    }
  });

  it('needs BOTH conditions — an ancient retained row and a recent auth row both survive', async () => {
    await seed('consent_gate.override', ANCIENT); // old, but not allowlisted
    await seed('auth.refresh', RECENT); // allowlisted, but not old

    expect(await purgeExpiredAuthRows(prisma)).toBe(0);
    expect(await countOf('consent_gate.override')).toBe(1);
    expect(await countOf('auth.refresh')).toBe(1);
  });

  it('the allowlist is exactly the six TD-8 authentication actions', () => {
    expect([...PURGEABLE_ACTION_TYPES].sort()).toEqual(
      [
        'auth.identity_bound',
        'auth.login',
        'auth.login_denied',
        'auth.logout',
        'auth.refresh',
        'auth.token_revoked',
      ].sort(),
    );
    // Guards against a future edit quietly widening the deletable set.
    expect(PURGEABLE_ACTION_TYPES).toHaveLength(6);
  });
});
