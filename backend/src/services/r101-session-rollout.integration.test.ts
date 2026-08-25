import { readFile } from 'node:fs/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { issueNewSession } from './refresh-token.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const ROLLBACK = new Error('R101 verification rollback');
const MIGRATION = new URL(
  '../../prisma/migrations/20260821200100_r101_invalidate_legacy_refresh_sessions/migration.sql',
  import.meta.url,
);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('R101 legacy cookie-path rollout', () => {
  it('executes the committed migration atomically and invalidates every pre-cutover live session', async () => {
    const sql = await readFile(MIGRATION, 'utf8');

    try {
      await prisma.$transaction(async (tx) => {
        const first = await tx.user.create({
          data: {
            sex: 'female',
            nameArabic: '[r101-rollout-test] first',
            accountStatus: 'active',
          },
        });
        const second = await tx.user.create({
          data: {
            sex: 'female',
            nameArabic: '[r101-rollout-test] second',
            accountStatus: 'active',
          },
        });
        const firstA = await issueNewSession(tx, first.id);
        const firstB = await issueNewSession(tx, first.id);
        const secondA = await issueNewSession(tx, second.id);

        await tx.$executeRawUnsafe(sql);

        const rows = await tx.refreshToken.findMany({
          where: { userId: { in: [first.id, second.id] } },
        });
        expect(rows).toHaveLength(3);
        expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
        expect(
          rows.every((row) => row.revokedReason === 'cookie_path_migration'),
        ).toBe(true);

        const audits = await tx.auditLog.findMany({
          where: {
            actorUserId: null,
            actionType: 'auth.token_revoked',
            targetId: { in: [first.id, second.id] },
          },
          orderBy: { targetId: 'asc' },
        });
        expect(audits).toHaveLength(2);
        const byUser = new Map(audits.map((row) => [row.targetId, row.detail]));
        expect(byUser.get(first.id)).toMatchObject({
          reason: 'cookie_path_migration',
          session_ids: expect.arrayContaining([firstA.sessionId, firstB.sessionId]),
          tokens_revoked: 2,
        });
        expect(byUser.get(second.id)).toMatchObject({
          reason: 'cookie_path_migration',
          session_ids: [secondA.sessionId],
          tokens_revoked: 1,
        });

        // Prisma owns the durable one-time marker in `_prisma_migrations`, but
        // the SQL itself also converges safely if the deploy command is retried
        // before the new issuer starts: there are no remaining live legacy
        // rows, so no duplicate audit is written.
        await tx.$executeRawUnsafe(sql);
        expect(
          await tx.auditLog.count({
            where: {
              actorUserId: null,
              actionType: 'auth.token_revoked',
              targetId: { in: [first.id, second.id] },
            },
          }),
        ).toBe(2);

        // After migrate deploy commits, Prisma never executes this migration
        // again. A token issued by the new application therefore remains live;
        // deployment ordering is what separates this row from the legacy set.
        const postCutover = await issueNewSession(tx, first.id);
        expect(
          await tx.refreshToken.count({
            where: {
              sessionId: postCutover.sessionId,
              revokedAt: null,
            },
          }),
        ).toBe(1);

        // The test runs the production migration verbatim but leaves the shared
        // integration database exactly as it found it.
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  });
});
