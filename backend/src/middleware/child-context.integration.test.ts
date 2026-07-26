import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { resolveActingStudent } from './child-context.js';

/**
 * §4.3 child-context verification against the real database.
 *
 * §19.2 names this a mandatory regression test: "`X-Active-Child-ID`
 * verification on every student-context endpoint incl. the Student-role bypass
 * and the foreign-parent 404". The resolution is what those endpoints will
 * mount, so it is pinned here at the resolver, where the FamilyLink query that
 * enforces it actually lives.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[child-ctx-test]';

async function makeUser(label: string, status = 'active'): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: status as never },
  });
  return user.id;
}

async function link(
  parentId: string,
  studentId: string,
  status: 'pending' | 'approved' | 'rejected',
  deleted = false,
): Promise<string> {
  const row = await prisma.familyLink.create({
    data: {
      parentId,
      studentId,
      status,
      ...(deleted ? { deletedAt: new Date() } : {}),
    },
  });
  return row.id;
}

const parent = (id: string) => ({ userId: id, roles: ['parent'] });
const student = (id: string) => ({ userId: id, roles: ['student'] });

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('§4.3 case 1 — header present, acting as a Parent', () => {
  it('resolves the child when an approved link matches BOTH parties', async () => {
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    await link(p, c, 'approved');

    await expect(resolveActingStudent(prisma, parent(p), c)).resolves.toEqual({
      studentId: c,
      via: 'family_link',
    });
  });

  it('§19.2: another parent\'s child is 404, never distinguishable from nonexistent', async () => {
    const mine = await makeUser('والدة أ');
    const stranger = await makeUser('والدة ب');
    const theirChild = await makeUser('طفل ب');
    await link(stranger, theirChild, 'approved');

    // The link EXISTS and is approved — just not for this parent. Matching the
    // child alone would pass here; that is the §20 rule 6 vulnerability.
    const foreign = resolveActingStudent(prisma, parent(mine), theirChild);
    await expect(foreign).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Byte-identical treatment for a child that does not exist at all, so the
    // response cannot be used to probe which children are real.
    const nonexistent = resolveActingStudent(
      prisma,
      parent(mine),
      '11111111-2222-4333-8444-555555555555',
    );
    await expect(nonexistent).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a PENDING link grants nothing (BR-4: zero visibility before approval)', async () => {
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    await link(p, c, 'pending');

    await expect(resolveActingStudent(prisma, parent(p), c)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a REJECTED link grants nothing', async () => {
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    await link(p, c, 'rejected');

    await expect(resolveActingStudent(prisma, parent(p), c)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('§4.3 R16: soft-deleting the link revokes access on the very NEXT request', async () => {
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const id = await link(p, c, 'approved');

    // Access works...
    await expect(resolveActingStudent(prisma, parent(p), c)).resolves.toMatchObject({
      studentId: c,
    });

    // ...then the link is revoked, which IS a soft-delete (no Approved → Revoked
    // transition exists in TD-1). Nothing else changes: same token, same roles.
    await prisma.familyLink.update({ where: { id }, data: { deletedAt: new Date() } });

    await expect(resolveActingStudent(prisma, parent(p), c)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a soft-deleted child is not reachable through a live link', async () => {
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    await link(p, c, 'approved');
    await prisma.user.update({ where: { id: c }, data: { deletedAt: new Date() } });

    await expect(resolveActingStudent(prisma, parent(p), c)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a malformed header value is 404, not a detailed validation complaint', async () => {
    const p = await makeUser('والدة');
    await expect(resolveActingStudent(prisma, parent(p), 'not-a-uuid')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('the header cannot be used to act as a parent for oneself', async () => {
    // A caller passing their own id has no link to themselves, so this is 404 —
    // the header is never a self-service route into case 2's bypass.
    const p = await makeUser('والدة');
    await expect(resolveActingStudent(prisma, parent(p), p)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('§4.3 case 2 — no header, Student role bypasses entirely', () => {
  it('§19.2: an adult student resolves to their own JWT sub, with no link needed', async () => {
    const s = await makeUser('طالبة راشدة');

    await expect(resolveActingStudent(prisma, student(s), undefined)).resolves.toEqual({
      studentId: s,
      via: 'self',
    });
    // Proven to need no FamilyLink at all.
    expect(await prisma.familyLink.count({ where: { studentId: s } })).toBe(0);
  });

  it('an empty or whitespace-only header is treated as absent', async () => {
    const s = await makeUser('طالبة راشدة');
    await expect(resolveActingStudent(prisma, student(s), '   ')).resolves.toMatchObject({
      via: 'self',
    });
  });

  it('ordering is normative: a dual-role caller WITH a header acts as a parent', async () => {
    const both = await makeUser('والدة وطالبة');
    const c = await makeUser('طفلة');
    await link(both, c, 'approved');

    // Case 1 governs, so the resolved student is the child — not the caller.
    await expect(
      resolveActingStudent(prisma, { userId: both, roles: ['parent', 'student'] }, c),
    ).resolves.toEqual({ studentId: c, via: 'family_link' });

    // And a dual-role caller sending a header they have no link for gets 404
    // rather than silently falling back to the self bypass — otherwise a parent
    // could probe other families and be quietly handed their own data instead.
    const stranger = await makeUser('طفل غريب');
    await expect(
      resolveActingStudent(prisma, { userId: both, roles: ['parent', 'student'] }, stranger),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a dual-role caller WITHOUT a header falls to the self bypass', async () => {
    const both = await makeUser('والدة وطالبة');
    await expect(
      resolveActingStudent(prisma, { userId: both, roles: ['parent', 'student'] }, undefined),
    ).resolves.toEqual({ studentId: both, via: 'self' });
  });
});

describe('§4.3 case 3 — no header, Parent-only', () => {
  it('is 400 VALIDATION_FAILED, because the request is ambiguous', async () => {
    const p = await makeUser('والدة');
    await expect(resolveActingStudent(prisma, parent(p), undefined)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('the bypass is unreachable for a Parent-only caller even with an approved link', async () => {
    // §20 rule 6: "never let the bypass apply to a Parent-only caller". Having a
    // child must not let a parent omit the header and be treated as a student.
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    await link(p, c, 'approved');

    await expect(resolveActingStudent(prisma, parent(p), undefined)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('a caller with no roles at all is refused, never defaulted to self', async () => {
    const nobody = await makeUser('بلا دور');
    await expect(
      resolveActingStudent(prisma, { userId: nobody, roles: [] }, undefined),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
