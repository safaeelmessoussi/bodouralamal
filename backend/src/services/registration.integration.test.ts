import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { registrationSchema } from '../validators/registration.validators.js';
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

/** The branch this suite's applicants choose (§4.1, Revision 39). */
let branchId = '';

const parentChild = (): RegistrationInput => ({
  kind: 'parent_child',
  parent: { name_arabic: `${TAG} والدة`, phone: '+212 600 000 001', sex: 'female' as const },
  child: { name_arabic: `${TAG} طفلة`, sex: 'female' as const },
  branch_id: branchId,
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
  // After the users, never before: `intended_branch_id` is ON DELETE RESTRICT,
  // so a branch still referenced by a registration refuses to go — which is the
  // guarantee, working.
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: TEXT_VERSION },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: TEXT_VERSION },
  });
  branchId = (await prisma.branch.create({ data: { name: `${TAG} مقر` } })).id;
});

const countTagged = () => prisma.user.count({ where: { nameArabic: { startsWith: TAG } } });

/** Polls rather than sleeping a fixed time: the rollback is asynchronous. */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

afterAll(async () => {
  await clear();
  await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });
  await prisma.$disconnect();
});


describe('§4.1 Revision 39 — the applicant chooses a Branch, and only a Branch', () => {
  it('still REJECTS every other placement field outright', () => {
    // R39 narrowed R29's prohibition by exactly one field. Level, Room and Group
    // remain administrative decisions after approval, and `.strict()` refuses
    // them rather than ignoring them — a silently dropped `level_id` would let a
    // client believe a placement was recorded.
    for (const field of ['room_id', 'level_id', 'group_id', 'category_id']) {
      const parsed = registrationSchema.safeParse({
        kind: 'adult',
        applicant: { name_arabic: 'خديجة', sex: 'female', [field]: 'anything' },
        branch_id: '00000000-0000-4000-8000-000000000000',
        consents: { data_processing: true },
      });
      expect(parsed.success, `${field} must be rejected`).toBe(false);
    }
  });

  it('REQUIRES branch_id on the public self-service path', () => {
    // The applicant is present to choose, so a submission without a choice is
    // refused rather than defaulted. A default would silently put someone at a
    // branch nobody picked.
    const parsed = registrationSchema.safeParse({
      kind: 'adult',
      applicant: { name_arabic: 'خديجة', sex: 'female' },
      consents: { data_processing: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('persists the chosen branch as a REQUEST, granting no placement', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: 'adult',
        applicant: { name_arabic: `${TAG} مختارة`, sex: 'female' },
        branch_id: branchId,
        consents: { data_processing: true },
      },
      KEY,
    );

    const applicant = await prisma.user.findUnique({ where: { id: result.applicantId } });
    expect(applicant?.intendedBranchId).toBe(branchId);

    // The distinction R39 turns on: what was ASKED FOR is recorded; where the
    // person ENDS UP is still nothing, because placement follows approval. A
    // role assignment and an enrolment are both absent.
    expect(await prisma.userBranchRole.count({ where: { userId: result.applicantId } })).toBe(0);
    expect(await prisma.studentGroup.count({ where: { studentId: result.applicantId } })).toBe(0);
  });

  it('records the branch on the APPLICANT only, never copied onto the child', async () => {
    // One decision, one row. Copying it onto the child would be a second value
    // to keep in step, and the child's branch — once they have one — is their
    // Group's.
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(prisma, token, parentChild(), KEY);

    const parent = await prisma.user.findUnique({ where: { id: result.applicantId } });
    const child = await prisma.user.findUnique({ where: { id: result.childId! } });
    expect(parent?.intendedBranchId).toBe(branchId);
    expect(child?.intendedBranchId).toBeNull();
  });

  it('REFUSES a branch that does not exist', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    await expect(
      register(
        prisma,
        token,
        {
          kind: 'adult',
          applicant: { name_arabic: `${TAG} وهمية`, sex: 'female' },
          branch_id: '00000000-0000-4000-8000-000000000000',
          consents: { data_processing: true },
        },
        KEY,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('REFUSES a soft-deleted branch — a closed premises takes no registrations', async () => {
    // The foreign key alone would NOT catch this: a soft delete leaves the row
    // in place, so liveness has to be checked explicitly (R35 refuses to
    // advertise a closed branch for the same reason).
    const closed = await prisma.branch.create({
      data: { name: `${TAG} مغلق`, deletedAt: new Date() },
    });
    const { token } = issueOnboardingToken(identity(), KEY);
    await expect(
      register(
        prisma,
        token,
        {
          kind: 'adult',
          applicant: { name_arabic: `${TAG} مرفوضة`, sex: 'female' },
          branch_id: closed.id,
          consents: { data_processing: true },
        },
        KEY,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('ACCEPTS a branch that has not opened yet', async () => {
    // §4.4 keeps such a branch out of the CALENDAR; it must not keep it out of
    // registration, or an association could never enrol anyone for a premises
    // before opening day.
    const future = await prisma.branch.create({
      data: {
        name: `${TAG} قادم`,
        operationalStartDate: new Date(Date.UTC(2099, 0, 1)),
      },
    });
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: 'adult',
        applicant: { name_arabic: `${TAG} مبكرة`, sex: 'female' },
        branch_id: future.id,
        consents: { data_processing: true },
      },
      KEY,
    );
    const applicant = await prisma.user.findUnique({ where: { id: result.applicantId } });
    expect(applicant?.intendedBranchId).toBe(future.id);
  });
});

describe('§4.1b step 5 Revision 27 — registration captures sex before the User exists', () => {
  it('persists sex for BOTH people created by a parent+child registration', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: 'parent_child',
        parent: { name_arabic: `${TAG} والدة`, sex: 'female' },
        child: { name_arabic: `${TAG} ابن`, sex: 'male' },
        branch_id: branchId,
        consents: { data_processing: true, media_release: true },
      },
      KEY,
    );

    const parent = await prisma.user.findUnique({ where: { id: result.applicantId } });
    const child = await prisma.user.findUnique({ where: { id: result.childId! } });
    // Written in the same transaction that created them — never patched on.
    expect(parent?.sex).toBe('female');
    expect(child?.sex).toBe('male');
  });

  it('persists sex on the adult self-registration path', async () => {
    const { token } = issueOnboardingToken(identity(), KEY);
    const result = await register(
      prisma,
      token,
      {
        kind: 'adult',
        applicant: { name_arabic: `${TAG} راشدة`, sex: 'female' },
        branch_id: branchId,
        consents: { data_processing: true },
      },
      KEY,
    );
    expect((await prisma.user.findUnique({ where: { id: result.applicantId } }))?.sex).toBe('female');
  });

  it('the API boundary refuses a registration with no sex (§16.2: Zod validates there)', () => {
    // `register()` deliberately trusts its input — §16.2 applies Zod schemas at
    // the API boundary, so that is where this rule lives and is asserted.
    const parsed = registrationSchema.safeParse({
      kind: 'adult',
      applicant: { name_arabic: 'خديجة' },
      consents: { data_processing: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('the API boundary refuses an invalid sex value', () => {
    const parsed = registrationSchema.safeParse({
      kind: 'adult',
      applicant: { name_arabic: 'خديجة', sex: 'other' },
      consents: { data_processing: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('the boundary accepts either permitted value', () => {
    for (const sex of ['female', 'male']) {
      const parsed = registrationSchema.safeParse({
        kind: 'adult',
        applicant: { name_arabic: 'خديجة', sex },
        branch_id: '00000000-0000-4000-8000-000000000000',
        consents: { data_processing: true },
      });
      expect(parsed.success).toBe(true);
    }
  });
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
    expect(media?.revokedAt).toBeInstanceOf(Date);
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

  it('§18 KILL: SIGKILL mid-transaction persists nothing — not even the jti', async () => {
    // The §18 check taken literally: kill the PROCESS, not the transaction.
    //
    // This is a different failure from the one above. There, an error is raised
    // and Prisma rolls back — application code participates. Here nothing is
    // raised, no `finally` runs, and no teardown happens: SIGKILL cannot be
    // intercepted. What has to protect the database is PostgreSQL discarding an
    // uncommitted transaction when the client connection dies. If registration
    // were ever split across two transactions, or if any write escaped the
    // transaction, this is the test that would catch it.
    const id = identity();
    const victim = fileURLToPath(new URL('../test-support/registration-victim.ts', import.meta.url));

    const child = spawn('npx', ['tsx', victim, TAG, id.email, id.providerSubjectId, branchId], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait until it is genuinely parked INSIDE the transaction, past every write
    // but before the commit — a timer would be a guess, and a guess that fired
    // early would make this test prove nothing.
    const parked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 60_000);
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('READY')) {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    expect(parked).toBe(true);

    // Prove the test is not vacuous BEFORE killing anything. If Prisma buffered
    // the writes until commit, nothing would ever have reached the database and
    // the rollback below would be proving nothing at all. PostgreSQL assigns a
    // transaction id only to a transaction that has actually written, so a
    // parked backend carrying an xid is direct evidence that the rows exist and
    // are uncommitted.
    const writing = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM pg_stat_activity
      WHERE state = 'idle in transaction' AND backend_xid IS NOT NULL
        AND datname = current_database()
    `;
    expect(Number(writing[0]!.count)).toBeGreaterThan(0);

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;

    // Give PostgreSQL a moment to notice the dead connection and roll back.
    await waitFor(async () => (await countTagged()) === 0);

    expect(await countTagged()).toBe(0);
    expect(
      await prisma.familyLink.count({ where: { parent: { nameArabic: { startsWith: TAG } } } }),
    ).toBe(0);
    expect(await prisma.consentRecord.count({ where: { consentTextVersion: TEXT_VERSION } })).toBe(0);
    expect(
      await prisma.userIdentity.count({ where: { providerSubjectId: id.providerSubjectId } }),
    ).toBe(0);
    // And the applicant is not stranded: their single-use token survives the
    // crash unconsumed, so they can simply try again.
    expect(await prisma.consumedToken.count({ where: { purpose: 'onboarding' } })).toBe(0);
  }, 90_000);

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
        applicant: { name_arabic: `${TAG} خديجة`, sex: 'female' as const },
        branch_id: branchId,
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
