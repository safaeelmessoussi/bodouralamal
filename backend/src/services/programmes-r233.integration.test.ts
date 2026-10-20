import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { applyProgrammesR233, BOYS, BOYS_LEVELS, GIRLS, GIRLS_LEVELS } from './programmes-r233.service.js';

/**
 * **SRS Revision 233 — `ops:apply-programmes`** against the seeded
 * Categories, inside a transaction that is always rolled back: the shared
 * database is left exactly as it was.
 */
const prisma = createPrismaClient(loadConfig().DATABASE_URL, TEST_CONNECTION_LIMIT);
class Rollback extends Error {}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('R233 — the programmes pass', () => {
  it('renames «اليافعات» to «كبار», adds «صغار» and «اليافعين», marks the entry Levels — and a second run changes nothing', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const girls = await tx.category.findFirstOrThrow({ where: { name: GIRLS, deletedAt: null } });
        // The seeded catalogue: make the six names the Owner's, as on Production.
        const seeded = await tx.level.findMany({
          where: { categoryId: girls.id, deletedAt: null },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        });
        // …but one, as on Localhost: «المستوى 5» joins «كبار» under its own name.
        for (const [i, level] of seeded.entries()) {
          if (GIRLS_LEVELS[i] && i !== 4) await tx.level.update({ where: { id: level.id }, data: { name: GIRLS_LEVELS[i] } });
        }
        const odd = seeded[4]!;
        const before = await tx.enrollment.count({ where: { levelId: { in: seeded.map((l) => l.id) } } });

        const first = await applyProgrammesR233(tx);
        expect(first.changes).toBeGreaterThan(0);

        const girlsLevels = await tx.level.findMany({ where: { categoryId: girls.id, deletedAt: null } });
        expect(girlsLevels.find((l) => l.id === odd.id)).toMatchObject({ name: odd.name, track: 'older' });
        expect(girlsLevels.filter((l) => l.track === null)).toEqual([]);
        for (const base of GIRLS_LEVELS) {
          if (base !== GIRLS_LEVELS[4]) expect(girlsLevels.find((l) => l.name === `${base} كبار`)?.track).toBe('older');
          expect(girlsLevels.find((l) => l.name === `${base} صغار`)).toMatchObject({ track: 'younger', genderRestriction: 'girls_only' });
          expect(girlsLevels.some((l) => l.name === base)).toBe(false);
        }
        // A rename only: the same rows, so every enrolment stays where it was.
        expect(await tx.enrollment.count({ where: { levelId: { in: seeded.map((l) => l.id) } } })).toBe(before);

        const boys = await tx.category.findFirstOrThrow({ where: { name: BOYS, deletedAt: null } });
        const boysLevels = await tx.level.findMany({ where: { categoryId: boys.id, deletedAt: null } });
        expect(boysLevels).toHaveLength(12);
        expect(boysLevels.every((l) => l.genderRestriction === 'boys_only')).toBe(true);
        for (const base of BOYS_LEVELS) {
          expect(boysLevels.find((l) => l.name === `${base} صغار`)?.track).toBe('younger');
          expect(boysLevels.find((l) => l.name === `${base} كبار`)?.track).toBe('older');
        }

        const entries = [...girlsLevels, ...boysLevels].filter((l) => l.acceptsNewcomers).map((l) => l.name).sort();
        expect(entries).toEqual(['براعم الأمل صغار', 'براعم الأمل كبار', 'نسيم الأمل صغار', 'نسيم الأمل كبار'].sort());
        expect(boysLevels.find((l) => l.name === 'براعم الأمل كبار')).toMatchObject({ minAge: 10, maxAge: 11 });

        const children = await tx.level.findMany({ where: { name: { in: ['كتاكيت الأمل', 'براعم الأمل'] }, deletedAt: null } });
        expect(children.every((l) => l.acceptsNewcomers)).toBe(true);

        const second = await applyProgrammesR233(tx);
        expect(second.changes).toBe(0);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
