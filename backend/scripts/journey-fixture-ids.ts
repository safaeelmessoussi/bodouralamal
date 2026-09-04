/**
 * **Read-only.** Resolves the ids of the `[journey]` fixture that
 * `journey.integration.test.ts` leaves standing under `JOURNEY_KEEP=1`, so the
 * browser phase can sign in as the people it created.
 *
 * It creates nothing and changes nothing: the fixture is built by the journey
 * itself, through the real routes, because a second builder would drift from
 * the one under test.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';

const TAG = '[journey]';
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 3);

const exam = await prisma.exam.findFirstOrThrow({
  where: { title: { startsWith: TAG }, mode: 'online', deletedAt: null },
  select: { id: true, levelId: true },
});

const teacher = await prisma.user.findFirstOrThrow({
  where: {
    deletedAt: null,
    AND: [{ nameArabic: { startsWith: TAG } }, { nameArabic: { contains: 'المدرسة' } }],
  },
  select: { id: true },
});

/** The one enrolled in the assessment's Level — LEVEL A. */
const student = await prisma.user.findFirstOrThrow({
  where: {
    deletedAt: null,
    nameArabic: { startsWith: TAG },
    isBeneficiary: true,
    levelEnrollments: { some: { levelId: exam.levelId, deletedAt: null } },
  },
  select: { id: true },
});

/** The LEVEL-B-only control. */
const other = await prisma.user.findFirstOrThrow({
  where: {
    deletedAt: null,
    nameArabic: { startsWith: TAG },
    id: { not: student.id },
    levelEnrollments: { some: { deletedAt: null } },
  },
  select: { id: true },
});

console.log(
  JSON.stringify({ examId: exam.id, teacher: teacher.id, student: student.id, other: other.id }),
);
await prisma.$disconnect();
