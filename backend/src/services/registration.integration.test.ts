import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { CONSENT_TEXT_VERSION_KEY, register } from './registration.service.js';
import type { RegistrationInput } from '../validators/registration.validators.js';

/**
 * Unified registration (SRS §4.1, §4.1b step 5, TD-4.1) against the real
 * database — atomicity and the replay guard are enforced by transactions and a
 * unique constraint, so a mocked client would prove nothing.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const KEY = config.ONBOARDING_TOKEN_KEY;
const TAG = '[reg-test]';
const TEXT_VERSION = 'reg-test-v1';

let counter = 0;
function identity() {
  counter += 1;
  return { email: `reg-${Date.now()}-${counter}@example.com`, providerSubjectId: `sub-${Date.now()}-${counter}` };
}

const parentChild = (): RegistrationInput => ({
  kind: 'parent_child',
  parent: { name_arabic: `${TAG} والدة`, phone: '+212 600 000 001' },
  child: { name_arabic: `${TAG} طفلة` },
  consents: { data_processing: true, media_release: true },
});

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({ where: { parentId: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.consumedToken.deleteMany({ where: { purpose: 'onboarding' } });
}

beforeEach(async () => {
  await clear();
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: TEXT_VERSION },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: TEXT_VERSION },
  });
});

afterAll(async () => {
  await clear();
  await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });
  await prisma.$disconnect();
});

describe('§4.1b step 5 / TD-4.1 unified registration', () => {
  it('creates parent + child + link + consents + identity + consumed token atomically', async () => {
    const id = identity();
    const { token, claims } = issueOnboardingToken(id, KEY);
    const result = await register(prisma, token, parentChild(), KEY);

    expect(result.accountStatus).toBe('pending');
    expect(result.childId).not.toBeNull();

    // All six TD-4.1 writes present.
    const parent = await prisma.user.findUnique({ where: { id: result.applicantId } });
    const child = await prisma.user.findUnique({ where: { id: result.childId! } });
    expect(parent?.accountStatus).toBe('pending');
    expect(child?.accountStatus).toBe('pending');

    const link = await prisma.familyLink.findFirst({
      where: { parentId: result.applicantId, studentId: result.childId! },
    });
    expect(link?.status).toBe('pending'); // BR-4: zero visibility until approved.

    const identityRow = await prisma.userIdentity.findFirst({ where: { userId: result.applicantId } });
    expect(identityRow?.email).toBe(id.email);
    expect(identityRow?.providerSubjectId).toBe(id.providerSubjectId);

    const consents = await prisma.consentRecord.findMany({
      where: { studentId: { in: [result.applicantId, result.childId!] } },
    });
    // Parent data_processing + child data_processing + child media_release.
    expect(consents).toHaveLength(3);
    expect(consents.every((c) => c.consentTextVersion === TEXT_VERSION)).toBe(true);

    expect(await prisma.consumedToken.count({ where: { jti: claims.jti } })).toBe(1);
  });

  it('a minor is login-less: no identity and no pre_provisioned_email (BR-5)', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(prisma, token, parentChild(), KEY);

    const child = await prisma.user.findUnique({ where: { id: result.childId! } });
    expect(child?.preProvisionedEmail).toBeNull();
    expect(await prisma.userIdentity.count({ where: { userId: result.childId! } })).toBe(0);
  });

  it('a declined media release is RECORDED, not omitted (BR-1, §4.1a)', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const input = parentChild();
    input.consents.media_release = false;
    const result = await register(prisma, token, input, KEY);

    const media = await prisma.consentRecord.findFirst({
      where: { studentId: result.childId!, consentType: 'media_release' },
    });
    // Absence would ALSO mean "no consent" (BR-1), but a decision must leave a
    // record with an actor and timestamp so the history is auditable.
    expect(media).not.toBeNull();
    expect(media?.granted).toBe(false);
    expect(media?.revokedAt).not.toBeNull();
    expect(media?.revokedByUserId).toBe(result.applicantId);
  });

  it('REPLAY: the same token twice → 409 STATE_CONFLICT and nothing partial persists', async () => {
    const id = identity();
    const { token } = issueOnboardingToken(id, KEY);
    await register(prisma, token, parentChild(), KEY);

    const usersBefore = await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } });
    await expect(register(prisma, token, parentChild(), KEY)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    // §4.1b step 6: a failed submission persists nothing — the aborted attempt
    // must not have left a second parent behind.
    expect(await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } })).toBe(usersBefore);
  });

  it('ATOMICITY: a failure at the LAST write rolls back everything, including the jti', async () => {
    // The §18 "kill it mid-transaction — nothing partial persists" check, done
    // deterministically. The failure is forced at the FINAL write by
    // pre-registering the same Google subject, so the transaction has already
    // consumed the jti and created the parent, child, link and consents before
    // the identity insert collides.
    const id = identity();
    const squatter = await prisma.user.create({
      data: { nameArabic: `${TAG} سابق`, accountStatus: 'active' },
    });
    await prisma.userIdentity.create({
      data: {
        userId: squatter.id,
        provider: 'google',
        providerSubjectId: id.providerSubjectId,
        email: id.email,
      },
    });

    const { token, claims } = issueOnboardingToken(id, KEY);
    await expect(register(prisma, token, parentChild(), KEY)).rejects.toMatchObject({
      code: 'DUPLICATE',
    });

    // Only the pre-existing squatter remains: no parent, no child.
    expect(await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } })).toBe(1);
    // Scoped to THIS test's users: the §15.2 dev fixtures also hold family links,
    // so a global count would measure them instead of the rollback.
    expect(
      await prisma.familyLink.count({ where: { parent: { nameArabic: { startsWith: TAG } } } }),
    ).toBe(0);
    expect(await prisma.consentRecord.count({ where: { consentTextVersion: TEXT_VERSION } })).toBe(0);
    // The decisive assertion: the rollback undid the replay guard too. A jti left
    // behind by a failed attempt would burn the user's one-and-only token and
    // strand them with no way to register.
    expect(await prisma.consumedToken.count({ where: { jti: claims.jti } })).toBe(0);
  });

  it('RETRY: after a rolled-back attempt the SAME token still works', async () => {
    // The token-consumption invariant, proven from the applicant's side rather
    // than by inspecting a row: a failed attempt must not burn their one
    // single-use credential (§4.1b issues exactly one token per callback).
    const id = identity();
    const blocker = await prisma.user.create({
      data: { nameArabic: `${TAG} حاجز`, accountStatus: 'active' },
    });
    const blockingIdentity = await prisma.userIdentity.create({
      data: {
        userId: blocker.id,
        provider: 'google',
        providerSubjectId: id.providerSubjectId,
        email: id.email,
      },
    });

    const { token, claims } = issueOnboardingToken(id, KEY);

    // Attempt 1 fails at the final write and rolls back.
    await expect(register(prisma, token, parentChild(), KEY)).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
    expect(await prisma.consumedToken.count({ where: { jti: claims.jti } })).toBe(0);

    // The transient cause is removed — as an admin merging a duplicate would do.
    await prisma.userIdentity.delete({ where: { id: blockingIdentity.id } });

    // Attempt 2 with the SAME token must now succeed.
    const result = await register(prisma, token, parentChild(), KEY);
    expect(result.accountStatus).toBe('pending');
    expect(result.childId).not.toBeNull();
    // And only now is the token spent.
    expect(await prisma.consumedToken.count({ where: { jti: claims.jti } })).toBe(1);

    // A third attempt is a genuine replay.
    await expect(register(prisma, token, parentChild(), KEY)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('refuses a missing data_processing consent with CONSENT_REQUIRED', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const input = parentChild();
    input.consents.data_processing = false;
    await expect(register(prisma, token, input, KEY)).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
    expect(await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } })).toBe(0);
  });

  it('refuses a minor registration with no media-release DECISION at all', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const input = parentChild();
    delete (input.consents as { media_release?: boolean }).media_release;
    await expect(register(prisma, token, input, KEY)).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
  });

  it('adult self-registration creates one user, one consent, no link', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: 'adult',
        applicant: { name_arabic: `${TAG} خديجة` },
        consents: { data_processing: true },
      },
      KEY,
    );

    expect(result.childId).toBeNull();
    expect(await prisma.familyLink.count({ where: { parentId: result.applicantId } })).toBe(0);
    const consents = await prisma.consentRecord.findMany({ where: { studentId: result.applicantId } });
    expect(consents).toHaveLength(1);
    expect(consents[0]!.consentType).toBe('data_processing');
  });

  it('rejects an expired or forged token before touching the database', async () => {
    const stale = issueOnboardingToken(identity(), KEY, new Date(Date.now() - 20 * 60 * 1000));
    await expect(register(prisma, stale.token, parentChild(), KEY)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const forged = issueOnboardingToken(identity(), 'a-different-key');
    await expect(register(prisma, forged.token, parentChild(), KEY)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } })).toBe(0);
  });

  it('fails closed when the consent text version is unset (§2.3 owner task)', async () => {
    await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });
    const { token } = issueOnboardingToken(identity(), KEY);
    // §4.1a requires the exact text version on every record; without it we
    // cannot say what was agreed to, so we refuse rather than fabricate one.
    await expect(register(prisma, token, parentChild(), KEY)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } })).toBe(0);
  });

  it('concurrent submissions of ONE token admit exactly one registration', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const results = await Promise.allSettled([
      register(prisma, token, parentChild(), KEY),
      register(prisma, token, parentChild(), KEY),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    // Exactly one parent + one child, never two of either.
    expect(await prisma.user.count({ where: { nameArabic: { startsWith: TAG } } })).toBe(2);
  });
});
