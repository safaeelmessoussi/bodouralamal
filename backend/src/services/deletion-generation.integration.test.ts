import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../lib/config.js';
import { emailLockDigest } from '../lib/email-lock.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { isSelfManaged } from '../policies/self-management.js';
import * as users from '../repositories/user.repository.js';
import { actorFor } from '../test-support/actor.js';
import { clearOwnedEmailLocks } from '../test-support/email-locks.js';
import { deleteUserAccount, deIdentifyAccount, deIdentifyAccountSystem, purgeUserAccount } from './account-deletion.service.js';
import { approveSelfManagedClaim, rejectSelfManagedClaim, requestSelfManagedClaim } from './self-managed-claim.service.js';
import { purgeExpiredEntries, restoreEntry } from './trash.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const run = randomUUID();
const ids: string[] = [];
const claimIds: string[] = [];
const jtis: string[] = [];
const emails = new Set<string>();
const DAY = 86_400_000;

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function person(admin = false) {
  const user = await prisma.user.create({ data: {
    nameArabic: `[deletion-generation:${run}]`, sex: 'female', accountStatus: 'active',
    isBeneficiary: !admin, birthDate: new Date('1990-01-01'),
    referenceCode: `BA-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
  } });
  ids.push(user.id);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: admin ? 'super_admin' : 'student' } });
  await prisma.userBranchRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function pending(user: Awaited<ReturnType<typeof person>>) {
  const email = `${randomUUID()}@example.com`;
  emails.add(email);
  const jti = randomUUID(); jtis.push(jti);
  const providerSubjectId = randomUUID();
  const result = await requestSelfManagedClaim(prisma, {
    identity: { email, providerSubjectId }, jti,
    expiresAt: new Date(Date.now() + DAY), referenceCode: user.referenceCode!,
  });
  claimIds.push(result.id);
  return { ...result, email, providerSubjectId };
}

async function tombstone(userId: string) {
  return prisma.trash.findFirstOrThrow({ where: { targetEntity: 'User', targetId: userId } });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.trash.deleteMany({ where: { targetId: { in: [...ids, ...claimIds] } } });
  await prisma.auditLog.deleteMany({ where: { OR: [
    { targetId: { in: [...ids, ...claimIds] } }, { actorUserId: { in: ids } },
  ] } });
  await prisma.selfManagedClaim.deleteMany({ where: { beneficiaryId: { in: ids } } });
  await prisma.familyLink.deleteMany({ where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.consumedToken.deleteMany({ where: { jti: { in: jtis } } });
  await clearOwnedEmailLocks(prisma, emails);
  ids.length = 0; claimIds.length = 0; jtis.length = 0;
});
afterAll(() => prisma.$disconnect());

describe('B2/B3/B7 — one generation-safe account lifecycle', () => {
  it('disables immediately, restores within seven days, and refuses an expired restore without a sweep', async () => {
    const admin = await person(true); const actor = await actorFor(prisma, admin.id);
    const user = await person();
    await expect(assertFreshActive(prisma, user.id, ['student'])).resolves.toMatchObject({ userId: user.id });
    await deleteUserAccount(prisma, actor, user.id);
    const entry = await tombstone(user.id);
    expect(entry.purgeAfter.getTime() - Date.now()).toBeGreaterThan(6.99 * DAY);
    await expect(assertFreshActive(prisma, user.id, ['student'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deIdentifyAccountSystem(prisma, user.id, entry.id)).rejects.toMatchObject({ details: { reason: 'STALE_DELETION' } });
    await restoreEntry(prisma, actor, entry.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).toBeNull();
    await deleteUserAccount(prisma, actor, user.id);
    const current = await tombstone(user.id);
    await prisma.trash.update({ where: { id: current.id }, data: { purgeAfter: new Date(Date.now() - 1) } });
    await expect(restoreEntry(prisma, actor, current.id)).rejects.toMatchObject({ details: { reason: 'RESTORATION_EXPIRED' } });
    expect(await prisma.trash.count({ where: { id: current.id } })).toBe(1);
  });

  it.each([false, true])('stale scan cannot erase a restored/re-deleted account (re-delete=%s)', async (redelete) => {
    const admin = await person(true); const actor = await actorFor(prisma, admin.id);
    const user = await person();
    await deleteUserAccount(prisma, actor, user.id);
    const old = await tombstone(user.id);
    const scanned = barrier(); const resume = barrier();
    const original = prisma.trash.findMany.bind(prisma.trash);
    // An explicit future sweep clock makes the captured entry due without
    // sleeping a week. Restore uses its own real clock; the stale generation
    // must be harmless regardless of the worker's captured deadline/clock.
    const sweepAt = new Date(old.purgeAfter.getTime() + DAY);
    // Only the awaited read is intercepted, never a Prisma batch transaction;
    // expose its Promise result rather than PrismaPromise's lazy-query brand.
    const scan = prisma.trash as unknown as {
      findMany: (args?: Parameters<typeof prisma.trash.findMany>[0]) => Promise<Awaited<ReturnType<typeof prisma.trash.findMany>>>;
    };
    vi.spyOn(scan, 'findMany').mockImplementationOnce(async (args) => {
      const rows = await original(args);
      scanned.resolve(); await resume.promise;
      return rows.filter((row) => row.id === old.id);
    });
    const sweep = purgeExpiredEntries(prisma, sweepAt);
    try {
      await scanned.promise;
      await restoreEntry(prisma, actor, old.id);
      if (redelete) await deleteUserAccount(prisma, actor, user.id);
    } finally { resume.resolve(); }
    expect(await sweep).toMatchObject({ purged: 0, stale: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).nameArabic).toContain(run);
    if (redelete) {
      const current = await tombstone(user.id);
      expect(current.id).not.toBe(old.id);
      expect(current.purgeAfter.getTime() - Date.now()).toBeGreaterThan(6.99 * DAY);
      await deIdentifyAccountSystem(prisma, user.id, current.id, new Date(current.purgeAfter.getTime() + 1));
      await expect(deIdentifyAccountSystem(prisma, user.id, current.id, sweepAt)).rejects.toMatchObject({ details: { reason: 'STALE_DELETION' } });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).nameArabic).toBe('حساب محذوف');
    }
  });

  it.each(['pending', 'rejected', 'approved'] as const)('minimizes %s claims, preserving only approved authority, and retries converge', async (status) => {
    const admin = await person(true); const actor = await actorFor(prisma, admin.id);
    const user = await person(); const parent = await person();
    await prisma.familyLink.create({ data: { parentId: parent.id, studentId: user.id, status: 'approved' } });
    const claim = await pending(user);
    const rejectionReason = `b7-rejection-pii:${claim.id} البريد المؤكد هو ${claim.email}`;
    if (status === 'approved') await approveSelfManagedClaim(prisma, actor, claim.id);
    if (status === 'rejected') {
      await rejectSelfManagedClaim(prisma, actor, claim.id, rejectionReason);
      expect(await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } }))
        .toMatchObject({ decisionReason: rejectionReason, status: 'rejected', deletedAt: expect.any(Date) });
    }
    expect(await isSelfManaged(prisma, user.id)).toBe(status === 'approved');
    await deleteUserAccount(prisma, actor, user.id);
    await expect(assertFreshActive(prisma, user.id, ['student'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const old = await tombstone(user.id);
    await restoreEntry(prisma, actor, old.id);
    await expect(assertFreshActive(prisma, user.id, ['student'])).resolves.toMatchObject({ userId: user.id });
    expect((await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } })).email).toBe(claim.email);
    await deleteUserAccount(prisma, actor, user.id);
    const current = await tombstone(user.id);
    await expect(deIdentifyAccountSystem(prisma, user.id, old.id, new Date(current.purgeAfter.getTime() + 1)))
      .rejects.toMatchObject({ details: { reason: 'STALE_DELETION' } });
    expect((await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } })).email).toBe(claim.email);
    await prisma.trash.create({ data: { targetEntity: 'SelfManagedClaim', targetId: claim.id,
      snapshot: { email: claim.email, provider_subject_id: claim.providerSubjectId,
        decisionReason: status === 'rejected' ? rejectionReason : null }, purgeAfter: current.purgeAfter } });
    await deIdentifyAccountSystem(prisma, user.id, current.id, new Date(current.purgeAfter.getTime() + 1));
    const minimized = await prisma.selfManagedClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(minimized).toMatchObject({ email: null, providerSubjectId: null, decisionReason: null, status });
    if (status === 'pending') expect(minimized.deletedAt).not.toBeNull();
    expect(await isSelfManaged(prisma, user.id)).toBe(status === 'approved');
    expect(await prisma.familyLink.count({ where: { studentId: user.id } })).toBe(0);
    expect(await prisma.userIdentity.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.trash.count({ where: { targetId: { in: [user.id, claim.id] } } })).toBe(0);
    const erasedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(erasedUser).toMatchObject({ nameArabic: 'حساب محذوف', birthDate: null, referenceCode: null, preProvisionedEmail: null });
    const history = await prisma.auditLog.findMany({ where: { targetId: { in: [user.id, claim.id] } } });
    // Search every retained column of the account/claim and their durable audit
    // payloads, not merely the now-null credential columns. Related snapshots
    // and UserIdentity rows are asserted absent above.
    const retained = JSON.stringify({ erasedUser, minimized, history });
    expect(retained).not.toContain(rejectionReason);
    expect(retained).not.toContain(claim.email);
    expect(retained).not.toContain(claim.providerSubjectId);
    if (status === 'rejected') {
      const decisionAudit = history.find((row) => row.actionType === 'selfmanaged.reject');
      expect(decisionAudit).toMatchObject({ actorUserId: admin.id, targetId: claim.id,
        targetEntity: 'SelfManagedClaim', createdAt: expect.any(Date),
        detail: { beneficiary_id: user.id } });
      expect(decisionAudit?.detail).not.toHaveProperty('reason');
    }
    if (status === 'approved') {
      expect(await prisma.normalizedEmailLock.findUnique({ where: { emailDigest: emailLockDigest(claim.email) } })).not.toBeNull();
    }
    const audits = await prisma.auditLog.count({ where: { targetId: user.id, actionType: 'user.deidentify' } });
    await deIdentifyAccount(prisma, actor, user.id);
    expect(await prisma.auditLog.count({ where: { targetId: user.id, actionType: 'user.deidentify' } })).toBe(audits);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: parent.id } })).deletedAt).toBeNull();
  });

  it('a claim request paused before the User lock cannot write copied identity after permanent purge', async () => {
    const admin = await person(true); const actor = await actorFor(prisma, admin.id);
    const user = await person(); const reached = barrier(); const resume = barrier();
    const original = users.lockUser;
    const spy = vi.spyOn(users, 'lockUser').mockImplementationOnce(async (tx, id) => {
      reached.resolve(); await resume.promise; return original(tx, id);
    });
    const request = pending(user).then(() => 'unexpected-success', () => 'refused');
    try { await reached.promise; await purgeUserAccount(prisma, actor, user.id); }
    finally { resume.resolve(); }
    expect(await request).toBe('refused'); spy.mockRestore();
    expect(await prisma.selfManagedClaim.count({ where: { beneficiaryId: user.id } })).toBe(0);
  });

  it('the SQL lock table has no plaintext column and rejects malformed digest coordinates', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'normalized_email_lock' ORDER BY column_name`;
    expect(columns.map((row) => row.column_name)).toEqual(['created_at', 'email_digest']);
    expect(await prisma.normalizedEmailLock.count({ where: { emailDigest: { contains: '@' } } })).toBe(0);
    await expect(prisma.normalizedEmailLock.create({ data: { emailDigest: 'not-a-digest' } })).rejects.toBeDefined();
  });
});
