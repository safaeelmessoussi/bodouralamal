import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';

/**
 * `GET /calendar/bootstrap` over real HTTP (TD-3.10, Revision 36).
 *
 * What only an HTTP test can show: that the route is reachable **without a
 * token**, that its cache headers actually ship, and — the point of this suite —
 * that **`category_id` narrows the Level list on the server**.
 *
 * §4.4 requires that narrowing to be server-side *"so the client never filters a
 * list it was handed"*. A client-side filter would pass any unit test of the
 * component and violate the clause, so the assertion has to live here, against
 * the real response.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[cal-bootstrap-test]';

interface Body {
  error?: { code?: string };
  data?: {
    hijri: { days: { date: string; hijri_day: number | null }[]; months: unknown[] };
    gregorian_months: { month: number; month_ar: string; year: number }[];
    categories: { id: string; name: string }[];
    levels: { id: string; name: string; category_id: string }[];
    branches: { id: string; name: string }[];
  };
}

const call = (path: string) => httpCall<Body>(BASE, 'GET', path);

let categoryA = '';
let categoryB = '';

async function clear(): Promise<void> {
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
});

beforeEach(async () => {
  await clear();
  // Two categories with two levels each, so "narrowed" is distinguishable from
  // "happened to return fewer rows".
  const a = await prisma.category.create({ data: { name: `${TAG} أ` } });
  const b = await prisma.category.create({ data: { name: `${TAG} ب` } });
  categoryA = a.id;
  categoryB = b.id;
  await prisma.level.createMany({
    data: [
      { name: `${TAG} أ-1`, categoryId: a.id },
      { name: `${TAG} أ-2`, categoryId: a.id },
      { name: `${TAG} ب-1`, categoryId: b.id },
      { name: `${TAG} ب-2`, categoryId: b.id },
    ],
  });
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

const RANGE = 'from=2026-07-01&to=2026-07-31';
const mineLevels = (b: Body) => (b.data?.levels ?? []).filter((l) => l.name.startsWith(TAG));

describe('GET /calendar/bootstrap — public', () => {
  it('is reachable with NO token', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
  });

  it('carries the month metadata the dual title renders', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}`);
    // One Gregorian month for a single-month range, with its Arabic name — so
    // the client renders the title with no month arithmetic of its own.
    expect(res.body.data!.gregorian_months).toEqual([
      { month: 7, month_ar: 'يوليوز', year: 2026 },
    ]);
  });

  it('omits Hijri values for a month the Ministry has not announced (Revision 31)', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}`);
    const days = res.body.data!.hijri.days;
    expect(days).toHaveLength(31);
    // Silence, not a computed guess (§20 rule 14).
    expect(days.every((d) => d.hijri_day === null)).toBe(true);
    expect(res.body.data!.hijri.months).toEqual([]);
  });

  it('ships the caching policy it declares', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('etag')).toBeTruthy();
  });
});

describe('category_id narrows the Level list SERVER-SIDE (§4.4)', () => {
  it('returns every level when no category is given', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}`);
    expect(mineLevels(res.body)).toHaveLength(4);
  });

  it('returns only the selected category’s levels', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}&category_id=${categoryA}`);
    const levels = mineLevels(res.body);
    expect(levels).toHaveLength(2);
    expect(levels.every((l) => l.category_id === categoryA)).toBe(true);
    expect(levels.map((l) => l.name).sort()).toEqual([`${TAG} أ-1`, `${TAG} أ-2`]);
  });

  it('narrows to the OTHER category when asked, so the filter is real', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}&category_id=${categoryB}`);
    expect(mineLevels(res.body).every((l) => l.category_id === categoryB)).toBe(true);
  });

  it('leaves the categories, branches and Hijri days untouched', async () => {
    // Only the Level list is scoped: the rest is the calendar's chrome
    // regardless of which category is selected.
    const all = await call(`/calendar/bootstrap?${RANGE}`);
    const narrowed = await call(`/calendar/bootstrap?${RANGE}&category_id=${categoryA}`);
    expect(narrowed.body.data!.categories.length).toBe(all.body.data!.categories.length);
    expect(narrowed.body.data!.branches.length).toBe(all.body.data!.branches.length);
    expect(narrowed.body.data!.hijri.days.length).toBe(all.body.data!.hijri.days.length);
  });

  it('yields an empty list for an unknown category rather than falling back to all', async () => {
    // A filter that quietly stops filtering is worse than one returning nothing:
    // the screen would show every level while claiming to show one category's.
    const res = await call(
      `/calendar/bootstrap?${RANGE}&category_id=00000000-0000-4000-8000-000000000000`,
    );
    expect(res.status).toBe(200);
    expect(mineLevels(res.body)).toHaveLength(0);
  });

  it('refuses a malformed category id rather than ignoring it', async () => {
    const res = await call(`/calendar/bootstrap?${RANGE}&category_id=not-a-uuid`);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });
});
