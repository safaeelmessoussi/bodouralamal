/**
 * **R96 — one person of each kind, so the harness can prove "every person"**.
 *
 * A مؤطِّرة, an adult beneficiary, a guardian and that guardian's child. The
 * Super Admin is the dev bootstrap account and needs no fixture — which is
 * itself part of the claim: an account created long before this revision has a
 * QR because the migration backfilled it.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[qr96]';

async function wipe(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.familyLink.deleteMany({
      where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    // RESTRICT on `user` — a dev session issues audit rows, so these must go
    // before the person does. Every other scenario seed does the same.
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

await wipe();
if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

const cat = await prisma.category.create({ data: { name: `${TAG} فئة`, displayOrder: 96 } });
const level = await prisma.level.create({
  data: { name: `${TAG} مستوى`, categoryId: cat.id, genderRestriction: 'any' },
});
const branch = await prisma.branch.create({ data: { name: `${TAG} فرع` } });

const teacherRole = await prisma.role.findFirstOrThrow({ where: { name: 'teacher' } });
const studentRole = await prisma.role.findFirstOrThrow({ where: { name: 'student' } });
const parentRole = await prisma.role.findFirst({ where: { name: 'parent' } });

async function person(
  label: string,
  roleId: string | null,
  beneficiary = false,
): Promise<string> {
  const u = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: 'female',
      accountStatus: 'active',
      isBeneficiary: beneficiary,
    },
  });
  if (roleId) {
    await prisma.userBranchRole.create({ data: { userId: u.id, roleId, branchId: null } });
  }
  return u.id;
}

const teacher = await person('نادية المؤطرة', teacherRole.id);
const adult = await person('سعاد المستفيدة', studentRole.id, true);
const guardian = await person('أمينة ولية الأمر', parentRole?.id ?? null);
const child = await person('لينا الطفلة', studentRole.id, true);

await prisma.enrollment.create({
  data: { studentId: adult, levelId: level.id, branchId: branch.id },
});
await prisma.enrollment.create({
  data: { studentId: child, levelId: level.id, branchId: branch.id },
});
await prisma.familyLink.create({
  data: { parentId: guardian, studentId: child, status: 'approved' },
});

console.log(JSON.stringify({ teacher, adult, guardian, child, level: level.id, branch: branch.id }));
await prisma.$disconnect();
