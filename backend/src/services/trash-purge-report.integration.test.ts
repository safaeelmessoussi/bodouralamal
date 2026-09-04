import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  STORAGE_BACKED_ENTITIES,
  elapsedTrashWindows,
} from './trash-purge-report.service.js';
import * as module from './trash-purge-report.service.js';

/**
 * **BR-15's ninety days, measured but not executed** (SRS §4.10, Revision 59.4).
 *
 * R59.4 was an open Owner question and is now answered (2026-09-04):
 * enforcement lives in `trash.service.ts`. The property under test is therefore
 * twofold — that the measurement is correct, and that THIS module remains
 * incapable of acting on it, so there is exactly one destructive path.
 *
 * **Every assertion is scoped to rows this suite created.** The report is
 * global by nature, so asserting on totals would make the test depend on what
 * else is in the database — the exact failure mode that made a sibling suite
 * pass alone and fail under load.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

/** A per-run entity name, so grouping is scoped to this suite's rows. */
const PROBE = `R594Probe-${randomUUID().slice(0, 8)}`;
const STORAGE_PROBE = 'EducationalContent';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const ids: string[] = [];

async function tomb(entity: string, purgeAfter: Date): Promise<string> {
  const row = await prisma.trash.create({
    data: {
      targetEntity: entity,
      targetId: randomUUID(),
      snapshot: { probe: PROBE },
      // No `deletedBy`: the column is nullable and a real user would only add
      // an FK this suite would then have to unpick.
      purgeAfter,
    },
  });
  ids.push(row.id);
  return row.id;
}

beforeEach(async () => {
  if (ids.length > 0) await prisma.trash.deleteMany({ where: { id: { in: ids } } });
  ids.length = 0;
});

afterAll(async () => {
  // Outside any guard, so an interrupted earlier run is cleaned up too.
  await prisma.trash.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const groupFor = (report: { groups: { targetEntity: string }[] }, entity: string) =>
  report.groups.find((g) => g.targetEntity === entity);

describe('the ninety-day window is measured, per entity', () => {
  it('counts only rows whose window has ELAPSED', async () => {
    await tomb(PROBE, new Date('2026-08-01T00:00:00.000Z')); // past
    await tomb(PROBE, new Date('2026-08-20T00:00:00.000Z')); // past
    await tomb(PROBE, new Date('2026-12-01T00:00:00.000Z')); // future

    const group = groupFor(await elapsedTrashWindows(prisma, NOW), PROBE);

    expect(group?.elapsed).toBe(2);
  });

  it('reports the OLDEST window end, which is how long this has been sitting', async () => {
    await tomb(PROBE, new Date('2026-08-20T00:00:00.000Z'));
    await tomb(PROBE, new Date('2026-05-11T00:00:00.000Z'));

    const group = groupFor(await elapsedTrashWindows(prisma, NOW), PROBE);

    expect(group?.oldestPurgeAfter.toISOString()).toBe('2026-05-11T00:00:00.000Z');
  });

  it('a row exactly ON the boundary has NOT elapsed', async () => {
    await tomb(PROBE, NOW);

    // Strictly before, matching the ten-year and twelve-month clocks. A window
    // that expires the instant it is reached would differ from its siblings by
    // a day, which is the kind of inconsistency that surfaces as a bug report.
    expect(groupFor(await elapsedTrashWindows(prisma, NOW), PROBE)).toBeUndefined();
  });

  it('an entity with nothing elapsed is ABSENT, not a zero row', async () => {
    await tomb(PROBE, new Date('2026-12-01T00:00:00.000Z'));

    expect(groupFor(await elapsedTrashWindows(prisma, NOW), PROBE)).toBeUndefined();
  });
});

describe('storage-backed entities are separated, because they are a different authorisation', () => {
  it('an ordinary entity does not reach storage', async () => {
    await tomb(PROBE, new Date('2026-08-01T00:00:00.000Z'));

    expect(groupFor(await elapsedTrashWindows(prisma, NOW), PROBE)?.reachesStorage).toBe(false);
  });

  it('a content tombstone DOES, and the list says so explicitly', async () => {
    await tomb(STORAGE_PROBE, new Date('2026-08-01T00:00:00.000Z'));

    const group = groupFor(await elapsedTrashWindows(prisma, NOW), STORAGE_PROBE);

    // The row is this suite's; the count is not asserted because other suites
    // may legitimately have content tombstones of their own.
    expect(group?.reachesStorage).toBe(true);
    expect(STORAGE_BACKED_ENTITIES.has(STORAGE_PROBE)).toBe(true);
  });

  it('the totals agree with the groups they summarise', async () => {
    await tomb(PROBE, new Date('2026-08-01T00:00:00.000Z'));
    await tomb(STORAGE_PROBE, new Date('2026-08-01T00:00:00.000Z'));

    const report = await elapsedTrashWindows(prisma, NOW);

    // Self-consistency rather than absolute numbers: load-independent, and it
    // is the property a reader of the report actually relies on.
    expect(report.totalElapsed).toBe(
      report.groups.reduce((sum, g) => sum + g.elapsed, 0),
    );
    expect(report.totalElapsedReachingStorage).toBe(
      report.groups.filter((g) => g.reachesStorage).reduce((sum, g) => sum + g.elapsed, 0),
    );
    expect(report.totalElapsedReachingStorage).toBeLessThanOrEqual(report.totalElapsed);
  });

  it('echoes the instant it measured against', async () => {
    expect((await elapsedTrashWindows(prisma, NOW)).asOf).toEqual(NOW);
  });
});

describe('R59.4 is answered, and this module is still the reporter', () => {
  it('exports no destructive verb at all', () => {
    /**
     * **Still meaningful after the Owner authorised enforcement** (2026-09-04),
     * and arguably more so. Destruction lives in `trash.service.ts`, where it
     * reuses the manual purge's audited body; a reporter that grew its own
     * destructive verb would offer a second, unaudited way to do the same thing
     * and somebody would eventually call it.
     */
    const destructive = Object.keys(module).filter((name) =>
      /purge|delete|destroy|remove|execute/i.test(name),
    );


    expect(destructive).toEqual([]);
  });

  it('leaves every row it measured in place', async () => {
    const id = await tomb(PROBE, new Date('2026-08-01T00:00:00.000Z'));

    await elapsedTrashWindows(prisma, NOW);

    expect(await prisma.trash.findUnique({ where: { id } })).not.toBeNull();
  });
});
