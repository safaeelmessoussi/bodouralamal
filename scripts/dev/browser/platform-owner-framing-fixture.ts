/**
 * Synthetic identities for the disposable R115 browser acceptance.
 *
 * The browser must prove ownership transfer without ever transferring the real
 * bootstrap identity. This fixture therefore runs only against a loopback test
 * database, creates two tagged Global Super Admins, and moves the disposable
 * singleton to the first one before Chrome starts. The enclosing shell harness
 * destroys the entire project and its volumes afterwards.
 */
import { loadConfig } from '../../../backend/src/lib/config.js';
import { createPrismaClient } from '../../../backend/src/lib/prisma.js';

const config = loadConfig();
if (process.env['NODE_ENV'] === 'production') {
  throw new Error('refusing to prepare an R115 browser fixture in production');
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(config.DATABASE_URL)) {
  throw new Error('refusing to prepare an R115 browser fixture against a non-loopback database');
}

const prisma = createPrismaClient(config.DATABASE_URL, 2);
const TAG = '[r115-browser]';
const applicantEmail = 'r115-browser-applicant@example.com';

async function setup(): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  const branches = await prisma.branch.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    take: 2,
    select: { id: true, name: true },
  });
  if (branches.length < 2) throw new Error('R115 browser acceptance needs two live branches');

  const [owner, target] = await prisma.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        firstNameArabic: TAG,
        lastNameArabic: 'المالكة المؤقتة',
        nameArabic: `${TAG} المالكة المؤقتة`,
        sex: 'female',
        accountStatus: 'active',
      },
    });
    const target = await tx.user.create({
      data: {
        firstNameArabic: TAG,
        lastNameArabic: 'المالكة التالية',
        nameArabic: `${TAG} المالكة التالية`,
        sex: 'female',
        accountStatus: 'active',
      },
    });
    await tx.userBranchRole.createMany({
      data: [
        { userId: owner.id, roleId: role.id, branchId: null },
        { userId: target.id, roleId: role.id, branchId: null },
      ],
    });
    await tx.platformOwner.update({
      where: { singletonKey: 'platform' },
      data: { ownerUserId: owner.id, version: { increment: 1 } },
    });
    return [owner, target] as const;
  });

  process.stdout.write(
    `${JSON.stringify({
      ownerId: owner.id,
      ownerName: owner.nameArabic,
      targetId: target.id,
      targetName: target.nameArabic,
      branchIds: branches.map((branch) => branch.id),
      branchNames: branches.map((branch) => branch.name),
      applicantEmail,
      applicantName: `${TAG} طالبة التأطير`,
    })}\n`,
  );
}

async function verify(): Promise<void> {
  const firstBranch = await prisma.branch.findFirstOrThrow({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const identity = await prisma.userIdentity.findFirstOrThrow({ where: { email: applicantEmail } });
  const applicant = await prisma.user.findUniqueOrThrow({
    where: { id: identity.userId },
    include: {
      framingPreference: { include: { branches: true } },
      availability: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
      branchRoles: { where: { deletedAt: null }, include: { role: true } },
    },
  });
  const owner = await prisma.platformOwner.findUniqueOrThrow({ where: { singletonKey: 'platform' } });
  const target = await prisma.user.findFirstOrThrow({
    where: { nameArabic: `${TAG} المالكة التالية` },
    select: { id: true },
  });
  const formerOwner = await prisma.user.findFirstOrThrow({
    where: { nameArabic: `${TAG} المالكة المؤقتة` },
    include: {
      branchRoles: { where: { deletedAt: null }, include: { role: true } },
    },
  });

  const checks: Record<string, boolean> = {
    singleton: (await prisma.platformOwner.count()) === 1,
    transferred: owner.ownerUserId === target.id,
    applicant_active: applicant.accountStatus === 'active',
    teacher_role: applicant.branchRoles.some(
      (assignment) => assignment.role.name === 'teacher' && assignment.branchId !== null,
    ),
    framing_both: applicant.framingPreference?.mode === 'both',
    framing_all_branches:
      applicant.framingPreference?.allBranches === true &&
      applicant.framingPreference.branches.length === 0,
    availability_exact:
      applicant.availability.length === 2 &&
      applicant.availability[0]?.mode === 'online' &&
      applicant.availability[1]?.mode === null,
    owner_additional_role:
      formerOwner.branchRoles.some(
        (assignment) => assignment.role.name === 'super_admin' && assignment.branchId === null,
      ) &&
      formerOwner.branchRoles.some(
        (assignment) =>
          assignment.role.name === 'teacher' && assignment.branchId === firstBranch.id,
      ),
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) throw new Error(`R115 browser database assertions failed: ${failed.join(', ')}`);
  process.stdout.write(`${JSON.stringify(checks)}\n`);
}

async function main(): Promise<void> {
  const action = process.argv[2] ?? 'setup';
  if (action === '--verify') await verify();
  else if (action === 'setup') await setup();
  else throw new Error(`unknown action: ${action}`);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
