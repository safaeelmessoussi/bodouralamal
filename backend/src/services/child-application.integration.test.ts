import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { actorFor } from '../test-support/actor.js';
import { listApprovals } from './approval.service.js';
import {
  decideChildApplication,
  proposeMatches,
  submitChildApplications,
} from './child-application.service.js';

/**
 * Child applications (SRS Revision 62).
 *
 * The properties under test are the ones R62 exists for, and none of them is
 * "a row was written":
 *
 * * **each child is decided alone** — approving one leaves its siblings pending;
 * * **a rejected child leaves nothing behind** — no `User`, no `FamilyLink`, no
 *   consent — which is what makes partial approval safe structurally rather
 *   than by an access check;
 * * **consent is materialised with the SUBMISSION's text version**, not the
 *   approval's, so a parent is never recorded as consenting to text they never
 *   saw;
 * * **the `parent` role appears once**, on the first approval, and never on a
 *   rejection.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[child-app-test]';

let adminId = '';
let parentId = '';

async function makeUser(label: string, role?: string): Promise<string> {
  const u = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  if (role) {
    const r = await prisma.role.findUnique({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: u.id, roleId: r!.id, branchId: null },
    });
  }
  return u.id;
}

async function clear(): Promise<void> {
  // Children created BY an approval carry the tag in their own name, so both
  // sets are swept: the people this suite names, and the people it caused.
  const users = await prisma.user.findMany({
    where: {
      OR: [{ nameArabic: { startsWith: TAG } }, { firstNameArabic: { startsWith: TAG } }],
    },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;

  // `decided_by` is RESTRICT too — an application decided by the admin blocks
  // deleting the admin, which is how this teardown first failed.
  await prisma.childApplication.deleteMany({
    where: {
      OR: [
        { parentId: { in: ids } },
        { childUserId: { in: ids } },
        { decidedById: { in: ids } },
        { matchedExistingUserId: { in: ids } },
      ],
    },
  });
  await prisma.consentRecord.deleteMany({
    where: { OR: [{ studentId: { in: ids } }, { grantedByUserId: { in: ids } }] },
  });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await clear();
  adminId = await makeUser('مسؤولة', 'admin');
  parentId = await makeUser('والدة');
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/** One request naming two children, as a parent submits it. */
async function submitTwo(textVersion = 'v1.0') {
  return prisma.$transaction((tx) =>
    submitChildApplications(tx, parentId, {
      consentDataProcessing: true,
      consentTextVersion: textVersion,
      children: [
        { firstNameArabic: `${TAG} محمد`, lastNameArabic: 'العلوي', sex: 'male', consentMediaRelease: true },
        { firstNameArabic: `${TAG} سارة`, lastNameArabic: 'العلوي', sex: 'female', consentMediaRelease: false },
      ],
    }),
  );
}

describe('one request, many children', () => {
  it('groups siblings under one request id, each pending on its own', async () => {
    const { requestId, applicationIds } = await submitTwo();

    expect(applicationIds).toHaveLength(2);
    const rows = await prisma.childApplication.findMany({ where: { requestId } });
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    // No child exists yet. That is the whole design: nothing to orphan.
    expect(rows.every((r) => r.childUserId === null)).toBe(true);
  });

  it('refuses a request with no data-processing consent (§4.1a)', async () => {
    await expect(
      prisma.$transaction((tx) =>
        submitChildApplications(tx, parentId, {
          consentDataProcessing: false,
          consentTextVersion: 'v1.0',
          children: [{ firstNameArabic: 'م', lastNameArabic: 'ع', consentMediaRelease: false }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('captures media-release PER CHILD', async () => {
    const { requestId } = await submitTwo();
    const rows = await prisma.childApplication.findMany({
      where: { requestId },
      orderBy: { firstNameArabic: 'asc' },
    });
    // A parent may permit photographs of one child and refuse for another.
    expect(new Set(rows.map((r) => r.consentMediaRelease))).toEqual(new Set([true, false]));
  });
});

describe('each child is decided alone (R62.2)', () => {
  it('approving one leaves its sibling untouched', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    const result = await decideChildApplication(prisma, admin, applicationIds[0]!, {
      approve: true,
    });

    expect(result.childUserId).not.toBeNull();
    const sibling = await prisma.childApplication.findUnique({
      where: { id: applicationIds[1]! },
    });
    expect(sibling?.status).toBe('pending');
    expect(sibling?.childUserId).toBeNull();
  });

  it('a REJECTED child leaves no user, no link and no consent', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    await decideChildApplication(prisma, admin, applicationIds[0]!, {
      approve: false,
      rejectionReason: 'insufficient_information',
      internalNote: 'could not verify the relationship',
    });

    const row = await prisma.childApplication.findUnique({ where: { id: applicationIds[0]! } });
    expect(row?.status).toBe('rejected');
    expect(row?.childUserId).toBeNull();
    // The structural safety property: there is nothing to leak through.
    expect(await prisma.familyLink.count({ where: { parentId } })).toBe(0);
    expect(await prisma.user.count({ where: { firstNameArabic: `${TAG} محمد` } })).toBe(0);
  });

  it('refuses a rejection with no bounded reason (R62.8)', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    await expect(
      decideChildApplication(prisma, admin, applicationIds[0]!, { approve: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a second decision on the same application (TD-15.3)', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);
    await decideChildApplication(prisma, admin, applicationIds[0]!, { approve: true });

    await expect(
      decideChildApplication(prisma, admin, applicationIds[0]!, { approve: true }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});

describe('consent is materialised with the SUBMISSION values (R62.3b)', () => {
  it('records the text version the parent actually saw, not the current one', async () => {
    const { applicationIds } = await submitTwo('v1.0-what-the-parent-saw');
    const admin = await actorFor(prisma, adminId);

    // The association republishes its consent text between submission and
    // approval — which is exactly the case that would otherwise record a
    // consent to text that never existed for this parent.
    const { childUserId } = await decideChildApplication(prisma, admin, applicationIds[0]!, {
      approve: true,
    });

    const consents = await prisma.consentRecord.findMany({ where: { studentId: childUserId! } });
    expect(consents).toHaveLength(2);
    for (const c of consents) {
      expect(c.consentTextVersion).toBe('v1.0-what-the-parent-saw');
      // Granted when the parent agreed, not when staff decided.
      expect(c.grantedByUserId).toBe(parentId);
    }
    // And the per-child media decision survives the round trip.
    const media = consents.find((c) => c.consentType === 'media_release');
    expect(media?.granted).toBe(true);
  });
});

describe('the parent role appears once, on the first approval (R62.9)', () => {
  it('grants it on the first child and not again on the second', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    const first = await decideChildApplication(prisma, admin, applicationIds[0]!, {
      approve: true,
    });
    expect(first.parentRoleGranted).toBe(true);

    const second = await decideChildApplication(prisma, admin, applicationIds[1]!, {
      approve: true,
    });
    expect(second.parentRoleGranted).toBe(false);

    // Exactly one assignment, not two.
    expect(
      await prisma.userBranchRole.count({
        where: { userId: parentId, deletedAt: null, role: { name: 'parent' } },
      }),
    ).toBe(1);
  });

  it('grants NOTHING on a rejection', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    await decideChildApplication(prisma, admin, applicationIds[0]!, {
      approve: false,
      rejectionReason: 'not_eligible',
    });

    expect(
      await prisma.userBranchRole.count({
        where: { userId: parentId, deletedAt: null, role: { name: 'parent' } },
      }),
    ).toBe(0);
  });
});

describe('the approved child (R62.5)', () => {
  it('receives a reference code, and it is unique', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    const a = await decideChildApplication(prisma, admin, applicationIds[0]!, { approve: true });
    const b = await decideChildApplication(prisma, admin, applicationIds[1]!, { approve: true });

    const [ca, cb] = await Promise.all([
      prisma.user.findUnique({ where: { id: a.childUserId! }, select: { referenceCode: true } }),
      prisma.user.findUnique({ where: { id: b.childUserId! }, select: { referenceCode: true } }),
    ]);
    expect(ca?.referenceCode).toMatch(/^BA-[2-9A-Z]{5}$/);
    expect(ca?.referenceCode).not.toBe(cb?.referenceCode);
  });

  it('is created with no login of its own (§4.3)', async () => {
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);
    const { childUserId } = await decideChildApplication(prisma, admin, applicationIds[0]!, {
      approve: true,
    });

    expect(await prisma.userIdentity.count({ where: { userId: childUserId! } })).toBe(0);
  });
});

describe('duplicate matching is proposed, never automatic (R62.3)', () => {
  it('offers a same-named minor with the parent that identifies them', async () => {
    // An existing child of another family, same name.
    const otherParent = await makeUser('أم أخرى');
    const existing = await prisma.user.create({
      data: {
        nameArabic: `${TAG} محمد العلوي`,
        firstNameArabic: `${TAG} محمد`,
        lastNameArabic: 'العلوي',
        accountStatus: 'active',
        referenceCode: 'BA-TEST1',
      },
    });
    await prisma.familyLink.create({
      data: { parentId: otherParent, studentId: existing.id, status: 'approved' },
    });

    const { applicationIds } = await submitTwo();
    const matches = await proposeMatches(prisma, await actorFor(prisma, adminId), applicationIds[0]!);

    const found = matches.find((m) => m.id === existing.id);
    expect(found, 'the same-named child should be proposed').toBeDefined();
    // The two facts that let an administrator tell children apart without the
    // platform holding a birth date for either.
    expect(found!.referenceCode).toBe('BA-TEST1');
    expect(found!.parents.join()).toContain('أم أخرى');
  });

  it('links the chosen account instead of creating a duplicate', async () => {
    const existing = await prisma.user.create({
      data: {
        nameArabic: `${TAG} محمد العلوي`,
        firstNameArabic: `${TAG} محمد`,
        lastNameArabic: 'العلوي',
        accountStatus: 'active',
      },
    });
    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    const result = await decideChildApplication(prisma, admin, applicationIds[0]!, {
      approve: true,
      matchExistingUserId: existing.id,
    });

    expect(result.childUserId).toBe(existing.id);
    // One child, two parents — permitted by R62.4 and by the pair uniqueness.
    expect(await prisma.familyLink.count({ where: { studentId: existing.id } })).toBe(1);
    // No duplicate was created.
    expect(await prisma.user.count({ where: { firstNameArabic: `${TAG} محمد` } })).toBe(1);
  });

  it('REFUSES to link an account that has its own login (R62.9)', async () => {
    const adult = await prisma.user.create({
      data: {
        nameArabic: `${TAG} راشدة`,
        firstNameArabic: `${TAG} محمد`,
        lastNameArabic: 'العلوي',
        accountStatus: 'active',
      },
    });
    await prisma.userIdentity.create({
      data: {
        userId: adult.id,
        provider: 'google',
        providerSubjectId: `sub-${adult.id}`,
        email: `${adult.id}@example.com`,
      },
    });

    const { applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    // An adult consents for themselves; linking a parent would hand a third
    // party their record on an administrator's decision.
    await expect(
      decideChildApplication(prisma, admin, applicationIds[0]!, {
        approve: true,
        matchExistingUserId: adult.id,
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});

describe('who may decide', () => {
  it('refuses a caller with no approver role', async () => {
    const { applicationIds } = await submitTwo();
    const outsider = await makeUser('مؤطرة', 'teacher');

    await expect(
      decideChildApplication(prisma, await actorFor(prisma, outsider), applicationIds[0]!, {
        approve: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

/**
 * **The loop, closed** (R62.6).
 *
 * The submit endpoint shipped before the queue could read what it wrote, which
 * meant a parent could submit and no administrator could ever find it — the
 * request existed and nothing happened. These assert the path a family actually
 * travels: submit → an administrator sees it → one child is decided → the queue
 * reflects exactly that.
 */
describe('a submitted request reaches the approval queue', () => {
  it('appears as ONE item per request, with a block per child', async () => {
    const { requestId } = await submitTwo();
    const page = await listApprovals(prisma, await actorFor(prisma, adminId), {
      type: 'child-application',
    });

    const item = page.data.find((i) => i.id === requestId);
    expect(item, 'the request is invisible to the queue').toBeDefined();
    // One item, so an administrator sees a FAMILY rather than unrelated children.
    expect(item!.children).toHaveLength(2);
    expect(item!.bundle.childCount).toBe(2);
    // The parent is named; no child `User` exists yet to name (R62.1).
    expect(item!.applicants.map((a) => a.role)).toEqual(['parent']);
  });

  it('carries each child\'s OWN application id, which is what decide acts on', async () => {
    const { requestId, applicationIds } = await submitTwo();
    const page = await listApprovals(prisma, await actorFor(prisma, adminId), {
      type: 'child-application',
    });

    const item = page.data.find((i) => i.id === requestId)!;
    // R62.2 decides a child alone, so the ids must be per child rather than per
    // request — without them an approver could only take the family wholesale.
    expect(item.children.map((c) => c.applicationId).sort()).toEqual([...applicationIds].sort());
  });

  it('drops a decided child and keeps its pending sibling', async () => {
    const { requestId, applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    await decideChildApplication(prisma, admin, applicationIds[0]!, { approve: true });

    const page = await listApprovals(prisma, admin, { type: 'child-application' });
    const item = page.data.find((i) => i.id === requestId);
    // The request is still there — one sibling is still waiting.
    expect(item, 'the remaining sibling vanished from the queue').toBeDefined();
    expect(item!.children).toHaveLength(1);
    expect(item!.children[0]!.applicationId).toBe(applicationIds[1]!);
  });

  it('leaves the queue entirely once every child is decided', async () => {
    const { requestId, applicationIds } = await submitTwo();
    const admin = await actorFor(prisma, adminId);

    await decideChildApplication(prisma, admin, applicationIds[0]!, { approve: true });
    await decideChildApplication(prisma, admin, applicationIds[1]!, {
      approve: false,
      rejectionReason: 'not_eligible',
    });

    const page = await listApprovals(prisma, admin, { type: 'child-application' });
    expect(page.data.find((i) => i.id === requestId)).toBeUndefined();
  });

  it('does not disturb the other queue types', async () => {
    await submitTwo();
    const admin = await actorFor(prisma, adminId);

    // A registration item carries no children blocks — the legacy shape bundles
    // them as pending LINKS, and conflating the two would misreport both.
    const registrations = await listApprovals(prisma, admin, { type: 'registration' });
    expect(registrations.data.every((i) => i.children.length === 0)).toBe(true);
  });

  it('is refused to a caller with no approver role', async () => {
    await submitTwo();
    const teacher = await makeUser('مؤطرة أخرى', 'teacher');

    await expect(
      listApprovals(prisma, await actorFor(prisma, teacher), { type: 'child-application' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
