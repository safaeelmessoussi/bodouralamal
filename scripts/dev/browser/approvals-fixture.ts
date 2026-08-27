/**
 * Scenario-owned pending applicants for the طلبات الانضمام sorting proof.
 *
 * **Why rows have to be created at all.** The queue is *pending registrations*,
 * and a healthy development database has none — which is exactly why NEW C's
 * sorting verification stayed owed. Ambient rows would also not settle the
 * question: proving a sort needs at least three rows whose alphabetical order
 * and whose submission order are **different lists**, so that ordering by one
 * cannot accidentally satisfy the other.
 *
 * Every row is tagged, and `--clean` removes exactly the tagged rows. Nothing
 * pre-existing is read, written or deleted (P1.2).
 */
import { loadConfig } from '../../../backend/src/lib/config.js';
import { createPrismaClient } from '../../../backend/src/lib/prisma.js';

const TAG = '[cnew-approvals]';
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);

/**
 * Names and submission times deliberately DISAGREE: by name the order is
 * أ → ب → ج, oldest-submitted-first it is ج → أ → ب — neither that list nor its
 * reverse. A screen that ignored the sort parameter and returned its default
 * could not satisfy both.
 */
const APPLICANTS = [
  { name: `${TAG} ج المتقدمة`, daysAgo: 3 },
  { name: `${TAG} أ المتقدمة`, daysAgo: 2 },
  { name: `${TAG} ب المتقدمة`, daysAgo: 1 },
];

async function clean(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.trash.deleteMany({ where: { deletedById: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  if (process.argv.includes('--clean')) {
    await clean();
    return;
  }
  // Idempotent: a previous interrupted run leaves nothing to collide with.
  await clean();
  for (const applicant of APPLICANTS) {
    const createdAt = new Date(Date.now() - applicant.daysAgo * 86_400_000);
    await prisma.user.create({
      data: {
        nameArabic: applicant.name,
        sex: 'female',
        accountStatus: 'pending',
        createdAt,
      },
    });
  }
  console.log(TAG);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
