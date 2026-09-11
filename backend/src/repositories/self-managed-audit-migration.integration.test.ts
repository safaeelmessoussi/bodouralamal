import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';

const prisma = createPrismaClient(loadConfig().DATABASE_URL, TEST_CONNECTION_LIMIT);
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260911110000_selfmanaged_rejection_audit_minimization/migration.sql',
  import.meta.url,
), 'utf8');
const ROLLBACK = new Error('R141 migration fixture rollback');
afterAll(() => prisma.$disconnect());

it('R141 removes only historical rejection reasons, preserves evidence and claim rationale, and is idempotent', async () => {
  // The real migration is platform-wide. ALWAYS roll back this test transaction,
  // including any ambient rows it could match; tagged teardown is insufficient.
  await expect(prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
    const actor = await tx.user.create({ data: { nameArabic: '[R141 fixture]', sex: 'female' } });
    const beneficiary = await tx.user.create({ data: { nameArabic: '[R141 fixture]', sex: 'female' } });
    const marker = `b7-rejection-pii:${randomUUID()}@example.test`;
    const claim = await tx.selfManagedClaim.create({ data: {
      beneficiaryId: beneficiary.id, provider: 'google', providerSubjectId: randomUUID(),
      email: 'claim-migration@example.test', status: 'rejected', decisionReason: marker,
      decidedAt: new Date(), decidedById: actor.id, deletedAt: new Date(),
    } });
    const reasonKeys = ['reason', 'decisionReason', 'decision_reason', 'rejectionReason', 'rejection_reason'];
    const expected = [];
    for (const key of reasonKeys) {
      // Non-identifying reasons are removed too: no value-based classification.
      for (const reason of [marker, 'fixture refusal']) {
        const structural = { beneficiary_id: beneficiary.id, result: 'rejected',
          active_role: 'super_admin', evidence_id: randomUUID() };
        const row = await tx.auditLog.create({ data: {
          actorUserId: actor.id, actionType: 'selfmanaged.reject',
          targetEntity: 'SelfManagedClaim', targetId: claim.id,
          createdAt: new Date('2020-01-01T00:00:00Z'), detail: { ...structural, [key]: reason },
        } });
        expected.push({ ...row, detail: structural });
      }
    }
    // A legacy audit event need not have a surviving target row or human actor.
    const orphan = await tx.auditLog.create({ data: {
      actorUserId: null, actionType: 'selfmanaged.reject', targetEntity: 'SelfManagedClaim',
      targetId: randomUUID(), detail: { reason: marker, decision_reason: marker, result: 'rejected' },
    } });
    expected.push({ ...orphan, detail: { result: 'rejected' } });
    // Identical detail on OTHER events must remain byte-equivalent. No row is deleted.
    for (const actionType of ['selfmanaged.request', 'selfmanaged.approve', 'familylink.reject', 'consent_gate.override']) {
      expected.push(await tx.auditLog.create({ data: {
        actorUserId: actor.id, actionType, targetEntity: 'SelfManagedClaim', targetId: claim.id,
        detail: { reason: marker, beneficiary_id: beneficiary.id },
      } }));
    }
    expected.push(await tx.auditLog.create({ data: {
      actorUserId: actor.id, actionType: 'selfmanaged.reject', targetId: claim.id,
      detail: { beneficiary_id: beneficiary.id, result: 'rejected' },
    } }));

    const ids = expected.map((row) => row.id);
    const readRows = () => tx.auditLog.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    // Execute the exact migration file, not a test reimplementation of its predicate.
    await tx.$executeRawUnsafe(migration);
    expect(await readRows()).toEqual(expected.sort((a, b) => a.id.localeCompare(b.id)));
    expect(await tx.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } })).toEqual(claim);
    expect(await tx.$executeRawUnsafe(migration)).toBe(0);
    expect(await readRows()).toEqual(expected);
    throw ROLLBACK;
  }, { timeout: 20_000 })).rejects.toBe(ROLLBACK);
});
