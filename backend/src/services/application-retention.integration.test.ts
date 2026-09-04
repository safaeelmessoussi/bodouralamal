import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import {
  APPLICATION_RETENTION_MONTHS,
  elapsedApplications,
  purgeElapsedApplications,
} from './application-retention.service.js';

/**
 * **Twelve months after rejection** (SRS §4.10a, Revision 131) — the
 * association's own maximum, not a legal citation and not indefinite retention.
 *
 * **Two clocks, both settled** (Owner, 2026-09-04): a rejected application from
 * `decided_at`, a never-converted pending one from `created_at`. And the
 * boundary is now ENFORCED, not merely reported — so these tests cover the
 * destructive half, including what must survive it and what must not survive
 * beside it.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[app-retention-test]';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let counter = 0;
let parentId = '';
/**
 * **Every application id this suite minted**, because the purge DELETES the rows
 * and the audit rows it leaves can no longer be found by joining to them. Ids
 * are the only ownership handle that survives the thing under test.
 */
const created: string[] = [];

async function application(
  status: 'pending' | 'rejected' | 'approved',
  decidedAt: Date | null,
  /** Explicit only where the test measures FROM it — the pending clock. */
  createdAt?: Date,
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
      ...(createdAt ? { createdAt } : {}),
    },
  });
  created.push(row.id);
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
  if (created.length > 0) {
    // The purge's own residue. Outside any `if` on the applications still
    // existing, because the successful case is precisely the one where they do
    // not — and P1.2 compares whole-table counts, so a stray audit row fails
    // the sweep for every suite that runs after this one.
    await prisma.auditLog.deleteMany({ where: { targetId: { in: created } } });
    await prisma.trash.deleteMany({
      where: { targetEntity: 'ChildApplication', targetId: { in: created } },
    });
    await prisma.childApplication.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
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
    const report = await elapsedApplications(prisma, day('2911-06-01'));
    const mine = report.find((r) => r.applicationId === id);
    expect(mine).toBeDefined();
    expect(mine!.retainUntil.toISOString()).toBe(day('2911-01-15').toISOString());
  });

  it('EXACTLY twelve months later has not elapsed — the day itself is retained', async () => {
    const id = await application('rejected', day('2910-01-15'));
    const onTheDay = await elapsedApplications(prisma, day('2911-01-15'));
    expect(onTheDay.map((r) => r.applicationId)).not.toContain(id);

    const dayAfter = await elapsedApplications(prisma, day('2911-01-16'));
    expect(dayAfter.map((r) => r.applicationId)).toContain(id);
  });

  it('a recent rejection is not reported', async () => {
    const id = await application('rejected', day('2911-05-01'));
    const report = await elapsedApplications(prisma, day('2911-06-01'));
    expect(report.map((r) => r.applicationId)).not.toContain(id);
  });

  it('an APPROVED application is never reported, however old', async () => {
    /**
     * It converted into a beneficiary, so its evidence belongs to that person's
     * educational record and to the ten-year clock — not to this one. Age is
     * irrelevant, which is why the instant here is twenty years later.
     */
    const approved = await application('approved', day('2900-01-01'));
    const report = await elapsedApplications(prisma, day('2920-01-01'));
    expect(report.map((r) => r.applicationId)).not.toContain(approved);
  });
});

describe('twelve months from CREATION for a never-converted pending application', () => {
  it('measures a pending application from created_at, and says so', async () => {
    /**
     * **Owner decision, 2026-09-04.** §4.10a said only *«from its own reference
     * point»*; `created_at` and `consent_given_at` are both defensible and give
     * different answers. The basis is reported rather than implied so a report
     * can be checked instead of trusted.
     */
    const id = await application('pending', null, day('2910-03-10'));

    const mine = (await elapsedApplications(prisma, day('2911-06-01'))).find(
      (r) => r.applicationId === id,
    );

    expect(mine).toBeDefined();
    expect(mine!.basis).toBe('created_at');
    expect(mine!.measuredFrom.toISOString()).toBe(day('2910-03-10').toISOString());
    expect(mine!.retainUntil.toISOString()).toBe(day('2911-03-10').toISOString());
  });

  it('uses the same strict boundary as the rejection clock', async () => {
    const id = await application('pending', null, day('2910-03-10'));

    // A day either side, so the two clocks cannot drift apart on the edge case
    // that decides whether a record lives one more day than policy allows.
    expect(
      (await elapsedApplications(prisma, day('2911-03-10'))).map((r) => r.applicationId),
    ).not.toContain(id);
    expect(
      (await elapsedApplications(prisma, day('2911-03-11'))).map((r) => r.applicationId),
    ).toContain(id);
  });

  it('a recent pending application is untouched', async () => {
    const id = await application('pending', null, day('2911-05-01'));
    expect(
      (await elapsedApplications(prisma, day('2911-06-01'))).map((r) => r.applicationId),
    ).not.toContain(id);
  });

  it('updating the row does NOT postpone its expiry', async () => {
    /**
     * The reason `created_at` was chosen over anything that moves. An
     * administrator opening a record, or any write that touches `updated_at`,
     * must not restart a retention clock — that is a clock nobody controls.
     */
    const id = await application('pending', null, day('2910-03-10'));
    await prisma.childApplication.update({
      where: { id },
      data: { internalNote: 'touched long after submission' },
    });

    expect(
      (await elapsedApplications(prisma, day('2911-06-01'))).map((r) => r.applicationId),
    ).toContain(id);
  });
});

describe('the boundary is ENFORCED, and enforcement is truthful', () => {
  it('deletes the row entirely — no stripped husk is left behind', async () => {
    const id = await application('rejected', day('2900-01-01'));

    const { deleted } = await purgeElapsedApplications(prisma, day('2920-01-01'));

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.childApplication.findUnique({ where: { id } })).toBeNull();
  });

  it('takes the TRASH SNAPSHOT with it, or the erasure is cosmetic', async () => {
    /**
     * A snapshot is a JSON copy written so the row can come back. Deleting the
     * application and keeping its snapshot would leave the child's name and
     * birth date in JSONB and offer a restoration of data whose retention had
     * just expired — the identical trap `deIdentifyAccount` documents for `User`.
     */
    const id = await application('rejected', day('2900-01-01'));
    await prisma.trash.create({
      data: {
        targetEntity: 'ChildApplication',
        targetId: id,
        snapshot: { firstNameArabic: 'اسم في اللقطة' },
        purgeAfter: day('2999-01-01'),
      },
    });

    await purgeElapsedApplications(prisma, day('2920-01-01'));

    expect(
      await prisma.trash.count({ where: { targetEntity: 'ChildApplication', targetId: id } }),
    ).toBe(0);
  });

  it('purges a SOFT-DELETED application too — the Trash is not a longer life', async () => {
    const id = await application('rejected', day('2900-01-01'));
    await prisma.childApplication.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await purgeElapsedApplications(prisma, day('2920-01-01'));

    expect(await prisma.childApplication.findUnique({ where: { id } })).toBeNull();
  });

  it('leaves everything NOT due exactly where it was', async () => {
    const recent = await application('rejected', day('2911-05-01'));
    const approved = await application('approved', day('2900-01-01'));
    const youngPending = await application('pending', null, day('2911-05-01'));

    await purgeElapsedApplications(prisma, day('2911-06-01'));

    for (const id of [recent, approved, youngPending]) {
      expect(await prisma.childApplication.findUnique({ where: { id } })).not.toBeNull();
    }
  });

  it('records the decision in audit — the FIELD names, never the child', async () => {
    const id = await application('rejected', day('2900-01-01'));

    await purgeElapsedApplications(prisma, day('2920-01-01'));

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'childapplication.retention_purge', targetId: id },
    });
    const detail = JSON.stringify(row.detail);
    expect(detail).toContain('rejected_at');
    // TD-8/TD-14: the row recording an erasure must not become the last copy of
    // what was erased. The fixture's own name is the thing to look for.
    expect(detail).not.toContain(TAG);
    expect(detail).not.toContain('طفلة');
    // System-initiated: the calendar decided this, not a person (R60.8).
    expect(row.actorUserId).toBeNull();
  });

  it('is idempotent — a second run finds nothing and writes nothing', async () => {
    await application('rejected', day('2900-01-01'));
    const first = await purgeElapsedApplications(prisma, day('2920-01-01'));
    const auditsAfterFirst = await prisma.auditLog.count({
      where: { actionType: 'childapplication.retention_purge' },
    });

    const second = await purgeElapsedApplications(prisma, day('2920-01-01'));

    expect(first.deleted).toBeGreaterThanOrEqual(1);
    expect(second.deleted).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { actionType: 'childapplication.retention_purge' } }),
    ).toBe(auditsAfterFirst);
  });

  it('the policy constant is twelve months', () => {
    expect(APPLICATION_RETENTION_MONTHS).toBe(12);
  });
});
