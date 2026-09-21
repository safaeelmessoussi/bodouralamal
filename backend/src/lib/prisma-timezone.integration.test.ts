import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from './prisma.js';

/**
 * **An instant means the same thing on both sides of the connection.**
 *
 * `@prisma/adapter-pg` assumes a UTC session. The database's own default is the
 * association's zone, so until 2026-09-21 every instant was written an hour
 * early and read an hour late — self-cancelling on a round trip, and therefore
 * invisible to every test that wrote a value and read it back. These two ask
 * the questions a round trip cannot: what did POSTGRES understand, and what
 * does the app make of a value POSTGRES generated.
 *
 * They bite only because the disposable stack's database is NOT UTC, exactly
 * like every real tier (`TZ` on the `db` service); the first assertion holds
 * that precondition so this file cannot go quietly vacuous.
 */
const prisma = createPrismaClient(loadConfig().DATABASE_URL, TEST_CONNECTION_LIMIT);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('the application’s database sessions are UTC', () => {
  it('whatever the database’s own default zone is — and here it is NOT UTC, as on every real tier', async () => {
    const [row] = await prisma.$queryRaw<{ session: string; database_default: string }[]>`
      select current_setting('TimeZone') as session,
             (select setting from pg_file_settings
               where name = 'TimeZone' and applied order by seqno desc limit 1) as database_default`;
    expect(row?.session).toBe('UTC');
    expect(row?.database_default).toBeDefined();
    expect(row?.database_default).not.toBe('UTC');
  });

  it('an instant the app WRITES is the instant Postgres understands', async () => {
    const sent = new Date('2026-01-15T12:00:00.000Z');
    const [row] = await prisma.$queryRaw<{ understood_utc: string }[]>`
      select to_char((${sent}::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as understood_utc`;
    expect(row?.understood_utc).toBe('2026-01-15T12:00:00');
  });

  it('an instant POSTGRES generates is the instant the app reads', async () => {
    const before = Date.now();
    const [row] = await prisma.$queryRaw<{ db_now: Date }[]>`select now() as db_now`;
    const after = Date.now();
    // An hour's error is 3,600,000 ms; the tolerance is for clock skew between
    // the test process and the database container, not for a zone.
    expect(row!.db_now.getTime()).toBeGreaterThan(before - 60_000);
    expect(row!.db_now.getTime()).toBeLessThan(after + 60_000);
  });
});
