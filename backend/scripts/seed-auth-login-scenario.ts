/**
 * Mints three real sessions for `verify-authenticated-login.sh` — a student,
 * a مؤطِّرة (twice over, since the browser harness needs one cookie per
 * page-phase; the refresh cookie rotates on use), and a Pending applicant.
 *
 * Sessions are issued through the real service (`issueNewSession`), never a
 * raw insert: what is under test is what `/auth/google` does with an already-
 * live session, and a fixture that bypassed the write path would not be one.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { issueNewSession } from '../src/services/refresh-token.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 3);
const TAG = '[auth-login-verify]';

async function person(label: string, status: 'active' | 'pending' = 'active'): Promise<string> {
  return (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} ${label}`, accountStatus: status },
    })
  ).id;
}

async function grant(userId: string, role: string): Promise<void> {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userBranchRole.create({ data: { userId, roleId: roleRow.id, branchId: null } });
}

async function cookie(userId: string): Promise<string> {
  return (await issueNewSession(prisma, userId)).rawToken;
}

const studentId = await person('طالبة');
await grant(studentId, 'student');
const teacherId = await person('مؤطِّرة');
await grant(teacherId, 'teacher');
const pendingId = await person('قيد المراجعة', 'pending');

console.log(
  JSON.stringify({
    studentCookie: await cookie(studentId),
    teacherCookie: await cookie(teacherId),
    teacherCookie2: await cookie(teacherId),
    pendingCookie: await cookie(pendingId),
  }),
);
await prisma.$disconnect();
