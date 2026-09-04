import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  ABANDONED_AFTER_MS,
  RUN_UNIQUE_FIXTURE_PREFIXES,
  sweepAbandonedFixtures,
} from './abandoned-fixtures.js';

/**
 * **The guard for a leak that reached a real screen.**
 *
 * On 2026-09-04 the Document Owner opened «اختبار جديد» to create an actual
 * exam and found four `[content-test:…]` Categories and Levels in the Level
 * selector. They came from four runs on 2026-09-02 that died before their
 * `afterAll`; because the owning tag is a per-run UUID, **no later run could
 * ever match them**, so they were permanently unreachable and permanently
 * visible.
 *
 * This asserts the property that was violated: **no run-unique fixture survives
 * long enough to be seen.** It sweeps first and then asserts the sweep worked,
 * so it both prevents and repairs — a guard that only reported would leave the
 * residue on the very screen it is protecting.
 *
 * It is bounded by age, never by name shape alone: `ABANDONED_AFTER_MS` is far
 * longer than any suite here runs, so a concurrent run is never touched. That
 * is the isolation the run-unique tag was bought for, kept.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

afterAll(async () => {
  await prisma.$disconnect();
});

/** Every column a fixture prefix can reach a user-facing selector through. */
async function survivors(prefix: string): Promise<Record<string, number>> {
  const before = new Date(Date.now() - ABANDONED_AFTER_MS);
  const aged = { createdAt: { lt: before } };
  const named = { name: { startsWith: prefix }, ...aged };
  const [levels, categories, subjects, branches, users] = await Promise.all([
    prisma.level.count({ where: named }),
    prisma.category.count({ where: named }),
    prisma.subject.count({ where: named }),
    prisma.branch.count({ where: named }),
    prisma.user.count({ where: { nameArabic: { startsWith: prefix }, ...aged } }),
  ]);
  return { levels, categories, subjects, branches, users };
}

describe('no abandoned fixture reaches a user-facing selector', () => {
  it.each(RUN_UNIQUE_FIXTURE_PREFIXES)('%s leaves nothing behind', async (prefix) => {
    await sweepAbandonedFixtures(prisma, prefix);
    const left = await survivors(prefix);
    // Named individually so a failure says WHICH selector would show it.
    expect(left, `${prefix} still has aged rows`).toEqual({
      levels: 0,
      categories: 0,
      subjects: 0,
      branches: 0,
      users: 0,
    });
  });

  it('the sweep is bounded by age — a fresh row of the same shape is untouched', async () => {
    const prefix = '[content-test:';
    const fresh = await prisma.category.create({
      data: { name: `${prefix}guard-${Date.now()}] فئة` },
    });
    try {
      await sweepAbandonedFixtures(prisma, prefix);
      // **The isolation the run-unique tag was bought for, kept.** A concurrent
      // run's rows are minutes old, and this proves the sweep cannot reach them.
      expect(
        await prisma.category.count({ where: { id: fresh.id } }),
        'a fresh fixture must survive — otherwise this sweep breaks parallel runs',
      ).toBe(1);
    } finally {
      await prisma.category.deleteMany({ where: { id: fresh.id } });
    }
  });
});
