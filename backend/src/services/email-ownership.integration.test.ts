import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import * as audit from '../repositories/audit.repository.js';
import * as users from '../repositories/user.repository.js';
import { actorFor } from '../test-support/actor.js';
import {
  captureConsentVersion,
  restoreConsentVersion,
  type SavedConsentVersion,
} from '../test-support/consent-setting.js';
import type { RegistrationInput } from '../validators/registration.validators.js';
import { resolveLogin } from './auth.service.js';
import { CONSENT_TEXT_VERSION_KEY, register } from './registration.service.js';
import { preProvision } from './user.service.js';

/**
 * Cross-channel normalized-email ownership against real PostgreSQL.
 *
 * The property cannot be represented by either existing unique index alone:
 * self-registration writes UserIdentity while staff provisioning writes User.
 * These tests therefore coordinate the production row-lock function rather
 * than mocking persistence or relying on timing sleeps.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[email-owner-test]';
const ADMIN_TAG = '[email-owner-admin]';
const TEXT_VERSION = 'email-owner-test-v1';

let savedConsentVersion: SavedConsentVersion;
let adminId = '';
let branchId = '';
let categoryId = '';
let counter = 0;
const usedEmails = new Set<string>();
const usedJtis = new Set<string>();

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function identity(label: string): { email: string; providerSubjectId: string } {
  counter += 1;
  const email = `email-owner-${label}-${Date.now()}-${counter}@example.com`;
  usedEmails.add(email);
  return { email, providerSubjectId: `email-owner-sub-${label}-${Date.now()}-${counter}` };
}

function onboarding(identityValue: { email: string; providerSubjectId: string }): {
  token: string;
  jti: string;
} {
  const issued = issueOnboardingToken(identityValue, config.ONBOARDING_TOKEN_KEY);
  usedJtis.add(issued.claims.jti);
  return { token: issued.token, jti: issued.claims.jti };
}

function adultInput(): RegistrationInput {
  return {
    kind: 'adult',
    applicant: {
      first_name_arabic: TAG,
      last_name_arabic: 'مستفيدة',
      sex: 'female',
    },
    branch_id: branchId,
    category_id: categoryId,
    consents: { data_processing: true },
  };
}

async function distinctOwners(email: string): Promise<string[]> {
  const preProvisioned = await prisma.user.findMany({
    where: { preProvisionedEmail: email },
    select: { id: true },
  });
  const identities = await prisma.userIdentity.findMany({
    where: { email, isActive: true },
    select: { userId: true },
  });
  return [
    ...new Set([
      ...preProvisioned.map((row) => row.id),
      ...identities.map((row) => row.userId),
    ]),
  ];
}

async function clearOwnedRows(): Promise<void> {
  const owned = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = owned.map((row) => row.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.consumedToken.deleteMany({ where: { jti: { in: [...usedJtis] } } });
  await prisma.normalizedEmailLock.deleteMany({ where: { email: { in: [...usedEmails] } } });
  usedEmails.clear();
  usedJtis.clear();
}

beforeAll(async () => {
  savedConsentVersion = await captureConsentVersion(prisma);
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: TEXT_VERSION },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: TEXT_VERSION },
  });
  // **Super Admin since 2026-08-28**: pre-provisioning is account
  // administration, and this suite uses it only as a fixture step — the
  // properties it asserts are about email ownership, not about who may staff.
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'super_admin' },
  });
  const admin = await prisma.user.create({
    data: { nameArabic: ADMIN_TAG, sex: 'female', accountStatus: 'active' },
  });
  adminId = admin.id;
  await prisma.userBranchRole.create({
    data: { userId: adminId, roleId: adminRole.id, branchId: null },
  });
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  categoryId = (await prisma.category.create({ data: { name: `${TAG} فئة` } })).id;
});

beforeEach(clearOwnedRows);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await clearOwnedRows();
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
  await prisma.userBranchRole.deleteMany({ where: { userId: adminId } });
  await prisma.user.delete({ where: { id: adminId } });
  await prisma.branch.delete({ where: { id: branchId } });
  await prisma.category.delete({ where: { id: categoryId } });
  await restoreConsentVersion(prisma, savedConsentVersion);
  await prisma.$disconnect();
});

describe('normalized-email ownership serialization', () => {
  it('staff winning after onboarding issuance refuses stale registration and binds the intended account', async () => {
    const google = identity('staff-wins');
    expect(await resolveLogin(prisma, google)).toEqual({ kind: 'onboarding' });
    const issued = onboarding(google);
    const staffOwner = await preProvision(prisma, await actorFor(prisma, adminId), {
      nameArabic: `${TAG} حساب الموظفة`,
      sex: 'female',
      email: google.email,
    });

    await expect(
      register(prisma, issued.token, adultInput(), config.ONBOARDING_TOKEN_KEY),
    ).rejects.toMatchObject({
      code: 'DUPLICATE',
      details: { reason: 'EMAIL_ALREADY_CLAIMED' },
    });

    expect(await distinctOwners(google.email)).toEqual([staffOwner.id]);
    expect(await prisma.userIdentity.count({ where: { email: google.email } })).toBe(0);
    expect(await prisma.consumedToken.count({ where: { jti: issued.jti } })).toBe(0);

    const rebound = await resolveLogin(prisma, google);
    expect(rebound.kind).toBe('pending');
    if (rebound.kind !== 'pending') return;
    expect(rebound.account.user.id).toBe(staffOwner.id);
    expect(rebound.boundNow).toBe(true);
    expect(await distinctOwners(google.email)).toEqual([staffOwner.id]);
  });

  it('concurrent absent registration and case-variant provisioning permit exactly one owner', async () => {
    const google = identity('concurrent');
    const issued = onboarding(google);
    const bothAtBoundary = deferred();
    let arrivals = 0;
    const realLock = users.lockNormalizedEmail;
    vi.spyOn(users, 'lockNormalizedEmail').mockImplementation(async (tx, email) => {
      if (email === google.email) {
        arrivals += 1;
        if (arrivals === 2) bothAtBoundary.resolve();
        await bothAtBoundary.promise;
      }
      return realLock(tx, email);
    });

    const outcomes = await Promise.allSettled([
      register(prisma, issued.token, adultInput(), config.ONBOARDING_TOKEN_KEY),
      preProvision(prisma, await actorFor(prisma, adminId), {
        nameArabic: `${TAG} حساب متزامن`,
        sex: 'female',
        email: `  ${google.email.toUpperCase()}  `,
      }),
    ]);

    expect(arrivals).toBe(2);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(loser).toMatchObject({
      status: 'rejected',
      reason: { code: 'DUPLICATE', details: { reason: 'EMAIL_ALREADY_CLAIMED' } },
    });
    expect(await distinctOwners(google.email)).toHaveLength(1);
    expect(await prisma.normalizedEmailLock.count({ where: { email: google.email } })).toBe(1);
    const registrationWon = await prisma.userIdentity.count({ where: { email: google.email } });
    expect(await prisma.consumedToken.count({ where: { jti: issued.jti } })).toBe(
      registrationWon === 1 ? 1 : 0,
    );
  });

  it('registration winning first blocks later staff pre-provisioning', async () => {
    const google = identity('registration-wins');
    const issued = onboarding(google);
    const registered = await register(
      prisma,
      issued.token,
      adultInput(),
      config.ONBOARDING_TOKEN_KEY,
    );

    await expect(
      preProvision(prisma, await actorFor(prisma, adminId), {
        nameArabic: `${TAG} حساب متأخر`,
        sex: 'female',
        email: google.email.toUpperCase(),
      }),
    ).rejects.toMatchObject({
      code: 'DUPLICATE',
      details: { reason: 'EMAIL_ALREADY_CLAIMED' },
    });
    expect(await distinctOwners(google.email)).toEqual([registered.applicantId]);
    expect(await prisma.user.count({ where: { preProvisionedEmail: google.email } })).toBe(0);
  });

  it('failure after acquiring a new ownership row rolls it back and a retry succeeds', async () => {
    const google = identity('rollback');
    const realWrite = audit.write;
    const writeSpy = vi.spyOn(audit, 'write').mockImplementation(async (db, entry) => {
      if (entry.actionType === 'user.create' && entry.actorUserId === adminId) {
        throw new Error('forced ownership transaction failure');
      }
      return realWrite(db, entry);
    });

    await expect(
      preProvision(prisma, await actorFor(prisma, adminId), {
        nameArabic: `${TAG} محاولة فاشلة`,
        sex: 'female',
        email: google.email,
      }),
    ).rejects.toThrow('forced ownership transaction failure');
    expect(await prisma.normalizedEmailLock.count({ where: { email: google.email } })).toBe(0);
    expect(await distinctOwners(google.email)).toEqual([]);

    writeSpy.mockRestore();
    const retry = await preProvision(prisma, await actorFor(prisma, adminId), {
      nameArabic: `${TAG} إعادة ناجحة`,
      sex: 'female',
      email: google.email,
    });
    expect(await distinctOwners(google.email)).toEqual([retry.id]);
  });
});
