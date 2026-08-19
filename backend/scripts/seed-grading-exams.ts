/**
 * Two exams with **different maxima**, for the R81 grading harness (§4.6, R81).
 *
 * Created here rather than driven through the scheduling form: the harness
 * exists to verify GRADING, and re-driving the exam form on every run would make
 * a failure ambiguous between two features. The maxima — 20 and 10 — are the
 * whole point; nothing else about the pair matters.
 *
 * Prints `{"outOf20": id, "outOf10": id}`. `--clean` removes what it made.
 *
 * It builds on **whatever the dev database already holds**, so the harness runs
 * against the real seeded scenario instead of a parallel one beside it.
 */
import { createPrismaClient } from '../src/lib/prisma.js';

const TAG = '[r81-browser]';
/**
 * `DATABASE_URL` directly rather than `loadConfig()`: this script writes two
 * rows and has no business demanding the whole TD-13 environment — MinIO keys
 * and OAuth secrets included — to do it.
 */
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
// The project's factory carries the driver adapter a bare client lacks.
const prisma = createPrismaClient(url);

const existing = await prisma.exam.findMany({
  where: { title: { startsWith: TAG } },
  select: { id: true },
});
const ids = existing.map((e) => e.id);
// R82 — a `grade_published` notice RESTRICTs the exam it is about, so the
// notices go before the exams here. Production soft-deletes and never hits this.
await prisma.notification.deleteMany({ where: { examId: { in: ids } } });
await prisma.grade.deleteMany({ where: { examId: { in: ids } } });
await prisma.examStaff.deleteMany({ where: { examId: { in: ids } } });
await prisma.exam.deleteMany({ where: { id: { in: ids } } });

const mine = await prisma.user.findMany({
  where: { nameArabic: { startsWith: TAG } },
  select: { id: true },
});
const mineIds = mine.map((u) => u.id);
await prisma.notification.deleteMany({ where: { userId: { in: mineIds } } });
await prisma.grade.deleteMany({ where: { studentId: { in: mineIds } } });
await prisma.enrollment.deleteMany({ where: { studentId: { in: mineIds } } });
await prisma.auditLog.deleteMany({ where: { actorUserId: { in: mineIds } } });
await prisma.refreshToken.deleteMany({ where: { userId: { in: mineIds } } });
await prisma.userBranchRole.deleteMany({ where: { userId: { in: mineIds } } });
await prisma.user.deleteMany({ where: { id: { in: mineIds } } });

if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

/**
 * **Derived from a real enrolment, not from the first Level in the table.**
 *
 * The grade sheet lists the exam's AUDIENCE — the students enrolled in its Level
 * at its Branch (BR-7 as restated by R70.2) — so an exam on a Level nobody is
 * enrolled in renders an empty sheet with no input to drive. The first attempt
 * did exactly that, and the harness reported a missing field as though the page
 * were broken.
 */
/**
 * **Her own beneficiary, created here** — not hunted for in the dev database.
 *
 * The first version searched for an existing enrolment, and every run found a
 * different person: one with no `student` role (her grades page refused), one
 * who also teaches (R60 put her in the teaching portal, correctly), one still
 * Pending (TD-1 blocked every authenticated screen). Each looked like a missing
 * feature and none was. A fixture that states what it needs cannot drift.
 */
const level = await prisma.level.findFirstOrThrow({ where: { deletedAt: null } });
// A branch that HAS a room: `exam_physical_place_all_or_none_check` requires
// place and clock together, so a roomless branch cannot host a physical sitting.
const branch = await prisma.branch.findFirstOrThrow({
  where: { deletedAt: null, rooms: { some: { deletedAt: null } } },
});
const studentRole = await prisma.role.findFirstOrThrow({ where: { name: 'student' } });

const beneficiary = await prisma.user.create({
  data: {
    nameArabic: `${TAG} المستفيدة`,
    sex: 'female',
    accountStatus: 'active',
    isBeneficiary: true,
  },
});
await prisma.userBranchRole.create({
  data: { userId: beneficiary.id, roleId: studentRole.id, branchId: null },
});
await prisma.enrollment.create({
  data: { studentId: beneficiary.id, levelId: level.id, branchId: branch.id },
});

const enrolment = {
  levelId: level.id,
  branchId: branch.id,
  studentId: beneficiary.id,
  student: { nameArabic: beneficiary.nameArabic },
};
const room = await prisma.room.findFirst({ where: { branchId: branch.id } });
const levelSubject = await prisma.levelSubject.findFirst({ where: { levelId: level.id } });
const year = await prisma.academicYear.findFirst();

async function make(title: string, maxGrade: number): Promise<string> {
  const row = await prisma.exam.create({
    data: {
      title: `${TAG} ${title}`,
      mode: 'physical',
      maxGrade,
      levelId: level.id,
      subjectId: levelSubject?.subjectId ?? null,
      branchId: branch.id,
      roomId: room?.id ?? null,
      academicYearId: year?.id ?? null,
      date: new Date('2026-08-20T00:00:00Z'),
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T11:00:00Z'),
      questions: [],
    },
    select: { id: true },
  });
  return row.id;
}

const outOf20 = await make('امتحان من 20', 20);
const outOf10 = await make('امتحان من 10', 10);
// The student id travels too, so the harness can mint HER session and read the
// screens she actually sees rather than an administrator's rendering of them.
console.log(
  JSON.stringify({
    outOf20,
    outOf10,
    studentId: enrolment.studentId,
    studentName: enrolment.student.nameArabic,
  }),
);
await prisma.$disconnect();
