import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  APPLICATION_RETENTION_MONTHS,
  elapsedRejectedApplications,
} from './application-retention.service.js';

/**
 * **Twelve months after rejection** (SRS §4.10a, Revision 131) — the
 * association's own maximum, not a legal citation and not indefinite retention.
 *
 * **Nothing here deletes.** The rows this reports still carry the child's copied
 * identity fields, which is precisely one of the classifications §4.10a leaves
 * open — so eligibility is computed and execution waits.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[app-retention-test]';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let counter = 0;
let parentId = '';

async function application(
  status: 'pending' | 'rejected' | 'approved',
  decidedAt: Date | null,
): Promise<string> {
  counter += 1;
  const consentText = await prisma.legalConsentText.findFirst({
    select: { id: true, versionLabel: true },
  });
  const row = await prisma.childApplication.create({
    data: {
      requestId: randomUUID(),
      parentId,
      firstNameArabic: `${TAG}`,
      lastNameArabic: `طفلة${counter}`,
      sex: 'female',
      consentDataProcessing: true,
      consentMediaRelease: true,
      consentTextVersion: consentText?.versionLabel ?? 'test',
      ...(consentText ? { consentTextId: consentText.id } : {}),
      consentGivenAt: new Date(),
      status,
      // Two CHECK constraints govern a decided row: it names its decider, and
      // an APPROVED one names the child it created. The fixture satisfies both
      // rather than working around them — they are the domain's own rules.
      ...(decidedAt ? { decidedAt, decidedById: parentId } : {}),
      ...(status === 'rejected' ? { rejectionReason: 'duplicate_application' as never } : {}),
      ...(status === 'approved' ? { childUserId: await makeChild() } : {}),
    },
  });
  return row.id;
}

async function makeChild(): Promise<string> {
  counter += 1;
  const child = await prisma.user.create({
    data: {
      sex: 'female',
      nameArabic: `${TAG} طفلة معتمدة ${counter}`,
      accountStatus: 'active',
      isBeneficiary: true,
    },
  });
  return child.id;
}

async function clear(): Promise<void> {
  await prisma.childApplication.deleteMany({
    where: { firstNameArabic: { startsWith: TAG } },
  });
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.childApplication.deleteMany({
      where: {
        OR: [
          { parentId: { in: ids } },
          { childUserId: { in: ids } },
          { decidedById: { in: ids } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeEach(async () => {
  await clear();
  const parent = await prisma.user.create({
    data: { sex: 'female', nameArabic: `${TAG} ولية أمر`, accountStatus: 'active' },
  });
  parentId = parent.id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('twelve months after rejection', () => {
  it('reports a rejection older than twelve months', async () => {
    const id = await application('rejected', day('2910-01-15'));
    const report = await elapsedRejectedApplications(prisma, day('2911-06-01'));
    const mine = report.find((r) => r.applicationId === id);
    expect(mine).toBeDefined();
    expect(mine!.retainUntil.toISOString()).toBe(day('2911-01-15').toISOString());
  });

  it('EXACTLY twelve months later has not elapsed — the day itself is retained', async () => {
    const id = await application('rejected', day('2910-01-15'));
    const onTheDay = await elapsedRejectedApplications(prisma, day('2911-01-15'));
    expect(onTheDay.map((r) => r.applicationId)).not.toContain(id);

    const dayAfter = await elapsedRejectedApplications(prisma, day('2911-01-16'));
    expect(dayAfter.map((r) => r.applicationId)).toContain(id);
  });

  it('a recent rejection is not reported', async () => {
    const id = await application('rejected', day('2911-05-01'));
    const report = await elapsedRejectedApplications(prisma, day('2911-06-01'));
    expect(report.map((r) => r.applicationId)).not.toContain(id);
  });

  it('APPROVED and PENDING applications are never reported', async () => {
    /**
     * An approved application converted into a beneficiary, and its evidence
     * belongs to that person's record rather than to this clock. A pending one
     * has no settled reference point in §4.10a, so this module deliberately does
     * not judge it — reporting it would be inventing the point.
     */
    const approved = await application('approved', day('2900-01-01'));
    const pending = await application('pending', null);
    const report = await elapsedRejectedApplications(prisma, day('2920-01-01'));
    const ids = report.map((r) => r.applicationId);
    expect(ids).not.toContain(approved);
    expect(ids).not.toContain(pending);
  });

  it('is a DRY RUN — it deletes nothing', async () => {
    const id = await application('rejected', day('2900-01-01'));
    const before = await prisma.childApplication.count();
    await elapsedRejectedApplications(prisma, day('2920-01-01'));
    expect(await prisma.childApplication.count()).toBe(before);
    // And the row it named is still there, copied identity fields and all —
    // which is exactly why execution waits on §4.10a's open classifications.
    const row = await prisma.childApplication.findUniqueOrThrow({ where: { id } });
    expect(row.firstNameArabic).toContain(TAG);
  });

  it('the policy constant is twelve months', () => {
    expect(APPLICATION_RETENTION_MONTHS).toBe(12);
  });
});
