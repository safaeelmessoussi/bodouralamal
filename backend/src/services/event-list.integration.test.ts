import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { listEvents } from './event.service.js';

/**
 * `GET /events` — the stored event **definitions** (TD-3.4, R56).
 *
 * The property under test is the one the endpoint exists for: **this returns
 * rules, not their expansion.** A weekly event is one row here and forty
 * occurrences on `GET /calendar`, and the unified Scheduling list manages the
 * former. Everything else below is about the date window and the branch
 * narrowing, both of which have a wrong answer that looks plausible.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[event-list]';

const actorOf = (roles: { role: string; branches: string[] | null }[]): Actor =>
  ({ userId: actorId, roles: roles.map((r) => r.role), roleScopes: roles }) as unknown as Actor;
const superAdmin = (): Actor => actorOf([{ role: 'super_admin', branches: null }]);
const scopedAdmin = (branchId: string): Actor => actorOf([{ role: 'admin', branches: [branchId] }]);

let actorId = '';
let branchA = '';
let branchB = '';

async function clear(): Promise<void> {
  const events = (
    await prisma.event.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  ).map((e) => e.id);
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: events } } });
  await prisma.event.deleteMany({ where: { id: { in: events } } });
  const ids = (
    await prisma.user.findMany({ where: { nameArabic: { startsWith: TAG } }, select: { id: true } })
  ).map((u) => u.id);
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** One definition. `branchIds: []` is the **Global** scope (§4.4). */
async function makeEvent(
  title: string,
  startDate: string,
  opts: { end?: string; recurrence?: string; recurrenceEnd?: string; branchIds?: string[] } = {},
): Promise<string> {
  const event = await prisma.event.create({
    data: {
      title: `${TAG} ${title}`,
      startDate: new Date(startDate),
      ...(opts.end ? { endDate: new Date(opts.end) } : {}),
      visibility: 'public',
      recurrenceType: (opts.recurrence ?? 'none') as never,
      ...(opts.recurrenceEnd ? { recurrenceEndDate: new Date(opts.recurrenceEnd) } : {}),
    },
  });
  for (const branchId of opts.branchIds ?? []) {
    await prisma.eventBranch.create({ data: { eventId: event.id, branchId } });
  }
  return event.id;
}

beforeEach(async () => {
  await clear();
  actorId = (
    await prisma.user.create({ data: { nameArabic: `${TAG} مديرة`, accountStatus: 'active' } })
  ).id;
  branchA = (await prisma.branch.create({ data: { name: `${TAG} فرع أ` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `${TAG} فرع ب` } })).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('it returns definitions, not occurrences', () => {
  it('lists a weekly event ONCE, however many dates it produces', async () => {
    // The whole reason this endpoint exists. On `GET /calendar` this same event
    // is one row per week; here it is the rule the administrator created, which
    // is the thing a management table can edit and delete.
    await makeEvent('أسبوعي', '2026-09-01', {
      recurrence: 'weekly',
      recurrenceEnd: '2026-12-31',
    });

    const result = await listEvents(prisma, superAdmin(), {});
    const mine = result.data.filter((e) => e.title.startsWith(TAG));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.recurrenceType).toBe('weekly');
  });
});

describe('the date window filters by OVERLAP', () => {
  it('includes a long-running event whose START is before the window', async () => {
    // The plausible wrong answer: filtering on `start_date >= from` hides an
    // event running September to June from a January window — exactly the
    // long-running items an administrator is most likely to be looking for.
    await makeEvent('سنة دراسية', '2026-09-01', { end: '2027-06-30' });

    const result = await listEvents(prisma, superAdmin(), {
      from: new Date('2027-01-01'),
      to: new Date('2027-01-31'),
    });
    expect(result.data.some((e) => e.title.includes('سنة دراسية'))).toBe(true);
  });

  it('includes an open-ended recurrence, which is current for any later window', async () => {
    await makeEvent('مفتوح', '2026-09-01', { recurrence: 'weekly' });
    const result = await listEvents(prisma, superAdmin(), {
      from: new Date('2027-03-01'),
      to: new Date('2027-03-31'),
    });
    expect(result.data.some((e) => e.title.includes('مفتوح'))).toBe(true);
  });

  it('excludes a one-off that ended before the window', async () => {
    await makeEvent('منتهٍ', '2026-01-10');
    const result = await listEvents(prisma, superAdmin(), {
      from: new Date('2026-06-01'),
      to: new Date('2026-06-30'),
    });
    expect(result.data.some((e) => e.title.includes('منتهٍ'))).toBe(false);
  });
});

describe('branch narrowing (TD-2)', () => {
  it('shows a scoped Admin their own branch and not another', async () => {
    await makeEvent('في أ', '2026-09-01', { branchIds: [branchA] });
    await makeEvent('في ب', '2026-09-01', { branchIds: [branchB] });

    const result = await listEvents(prisma, scopedAdmin(branchA), {});
    const titles = result.data.map((e) => e.title);
    expect(titles.some((x) => x.includes('في أ'))).toBe(true);
    expect(titles.some((x) => x.includes('في ب'))).toBe(false);
  });

  it('shows a GLOBAL event to a scoped Admin — it belongs to every branch', async () => {
    // §4.4: no branch join means Global, which is *all* branches rather than
    // none. Treating an empty join set as "no access" would hide precisely the
    // platform-wide announcements every branch needs to see.
    await makeEvent('عام', '2026-09-01');
    const result = await listEvents(prisma, scopedAdmin(branchA), {});
    expect(result.data.some((e) => e.title.includes('عام'))).toBe(true);
  });

  it('lets an explicit filter NARROW a scoped Admin, never widen them', async () => {
    await makeEvent('في ب', '2026-09-01', { branchIds: [branchB] });
    const result = await listEvents(prisma, scopedAdmin(branchA), { branchId: branchB });
    expect(result.data.some((e) => e.title.includes('في ب'))).toBe(false);
  });

  it('refuses a caller who is neither admin nor teacher', async () => {
    const parent = actorOf([{ role: 'parent', branches: null }]);
    await expect(listEvents(prisma, parent, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
