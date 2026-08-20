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
/** A SECOND linked child, so switching context can be proved to switch person. */
const child2 = await person('سارة الطفلة الثانية', studentRole.id, true);
/**
 * **An unrelated child**, linked to nobody in this fixture. She exists so the
 * forgery case has a REAL id to forge — refusing a random UUID would only prove
 * the row does not exist, not that the link is what is checked.
 */
const outsider = await person('هند طفلة غير مرتبطة', studentRole.id, true);
/**
 * A link that was approved and then **revoked**. Revocation is a **soft
 * delete**, not a status: §7 records that `status` is a *decided* value (TD-1)
 * and that overloading it would make *is this link live* unanswerable. So the
 * fixture revokes the way the platform does.
 */
const revokedChild = await person('نور طفلة برابط ملغى', studentRole.id, true);

await prisma.enrollment.create({
  data: { studentId: adult, levelId: level.id, branchId: branch.id },
});
for (const s of [child, child2, outsider, revokedChild]) {
  await prisma.enrollment.create({
    data: { studentId: s, levelId: level.id, branchId: branch.id },
  });
}
for (const s of [child, child2]) {
  await prisma.familyLink.create({
    data: { parentId: guardian, studentId: s, status: 'approved' },
  });
}
// Revoked, not absent: `/me` must stop listing her and the server must refuse
// the header — the existing FamilyLink rules, unchanged by R96.
await prisma.familyLink.create({
  data: {
    parentId: guardian,
    studentId: revokedChild,
    status: 'approved',
    deletedAt: new Date(),
  },
});

/**
 * The children's own `user_qr_ref` values, so the harness can assert that what
 * is on screen encodes **that child's** identity rather than merely differing
 * from the parent's. Read back rather than generated here: the column is
 * database-defaulted (R96.6), so this is the only place the value exists.
 */
const qrOf = async (id: string): Promise<string> =>
  (await prisma.user.findUniqueOrThrow({ where: { id }, select: { qrRef: true } })).qrRef;

console.log(
  JSON.stringify({
    teacher, adult, guardian, child, child2, outsider, revokedChild,
    childQr: await qrOf(child),
    child2Qr: await qrOf(child2),
    guardianQr: await qrOf(guardian),
    level: level.id, branch: branch.id,
  }),
);
await prisma.$disconnect();
