/**
 * `npm run ops:remove-fixtures` — **removes the development fixtures** (SRS
 * §15.2's `[تجريبي]` rows) from a non-Production database, at the Owner's word
 * (2026-09-23: «after finishing the tests, delete all [تجريبي] data»).
 *
 * ## Through the platform's own doors, never around them
 *
 * Every fixture record is deleted the way a Super Admin deletes it on the
 * screen — `deleteContent`, `deleteExam` (its evidence acknowledged),
 * `deleteEvent`, `deleteCourseSchedule` (its occurrences with it, R170 §8),
 * `deleteAdministrativeGroup`, `deleteRoom`, `deleteBranch` — and then purged
 * from the Trash at once (`purgeEntry`), so every cascade this platform knows
 * (attendance and recordings with a class, papers and marks with an exam, the
 * storage object with a content row) runs exactly as it would on the screen,
 * audited as the Owner's act. Fixture PEOPLE go through the account purge
 * (`purgeUserAccount`, R111's de-identification now): the row stays as the
 * platform keeps every deleted account, with no name and no identity.
 *
 * ## What is renamed, not deleted
 *
 * On Staging the Owner's own records use the fixture branches and rooms («مقر
 * تاركة», «قاعة 1») as real places. A fixture row that something of hers still
 * references is REFUSED by its own door (`409` naming the dependents) — and is
 * then renamed instead, the «[تجريبي] » tag stripped, so nothing she built is
 * lost and nothing on her screens says «تجريبي». Each rename is reported and
 * audited (`ops.fixture_untagged`).
 *
 * ## Never Production
 *
 * `seed:fixtures` refuses `NODE_ENV=production` (the Law 09-08 firewall); its
 * undoing refuses it for the same reason — there is nothing to undo there.
 */
import { loadConfig } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { createPrismaClient } from '../lib/prisma.js';
import { createStorageClients } from '../lib/storage.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import { purgeUserAccount } from '../services/account-deletion.service.js';
import { deleteAdministrativeGroup } from '../services/administrative-group.service.js';
import { deleteBranch, deleteRoom } from '../services/branch.service.js';
import { deleteContent } from '../services/content.service.js';
import { deleteCourseSchedule } from '../services/course-schedule.service.js';
import { deleteEvent } from '../services/event.service.js';
import { deleteExam } from '../services/exam.service.js';
import { purgeEntry } from '../services/trash.service.js';

const FIXTURE_TAG = '[تجريبي]';
const TAG_PREFIX = `${FIXTURE_TAG} `;

const config = loadConfig();
if (process.env['NODE_ENV'] === 'production') {
  throw new Error('ops:remove-fixtures refuses to run under NODE_ENV=production: there are no fixtures there');
}
const prisma = createPrismaClient(config.DATABASE_URL, 2);
const clients = createStorageClients(config);

const owner = await prisma.platformOwner.findFirst({ select: { ownerUserId: true } });
if (!owner) throw new Error('no platform owner: nobody to act as');
const actor: Actor = {
  userId: owner.ownerUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
  accountStatus: 'active',
};

type Outcome = { entity: string; id: string; name: string; result: 'purged' | 'renamed' | 'left'; reason?: string };
const outcomes: Outcome[] = [];
const isRefusal = (error: unknown): error is AppError =>
  error instanceof AppError && (error.code === 'STATE_CONFLICT' || error.code === 'DUPLICATE');

async function purgeTombstone(entity: string, id: string): Promise<void> {
  const entry = await prisma.trash.findFirst({ where: { targetEntity: entity, targetId: id }, select: { id: true } });
  if (entry) await purgeEntry(prisma, actor, entry.id);
}

/** Delete through the door; on a refusal naming dependents, strip the tag instead. */
async function remove(
  entity: string,
  row: { id: string; name: string },
  door: () => Promise<unknown>,
  rename: (name: string) => Promise<unknown>,
): Promise<void> {
  try {
    await door();
    await purgeTombstone(entity, row.id);
    outcomes.push({ entity, id: row.id, name: row.name, result: 'purged' });
  } catch (error) {
    if (!isRefusal(error)) throw error;
    const untagged = row.name.startsWith(TAG_PREFIX) ? row.name.slice(TAG_PREFIX.length) : row.name.replace(FIXTURE_TAG, '').trim();
    await rename(untagged);
    await audit.write(prisma, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'ops.fixture_untagged',
      targetEntity: entity,
      targetId: row.id,
      detail: { reason: (error.details?.['reason'] as string | undefined) ?? error.code },
    });
    outcomes.push({ entity, id: row.id, name: untagged, result: 'renamed', reason: (error.details?.['reason'] as string | undefined) ?? error.code });
  }
}

const tagged = { name: { startsWith: FIXTURE_TAG } } as const;
const taggedTitle = { title: { startsWith: FIXTURE_TAG } } as const;

// 1 · Library items (their objects follow through the storage-retirement job).
for (const row of await prisma.educationalContent.findMany({ where: { ...taggedTitle, deletedAt: null }, select: { id: true, title: true } })) {
  await remove('EducationalContent', { id: row.id, name: row.title }, () => deleteContent(prisma, clients, actor, row.id), (title) =>
    prisma.educationalContent.update({ where: { id: row.id }, data: { title } }),
  );
}
/**
 * …and whatever is already in the Trash: on Staging the fixtures were seeded on
 * every upgrade and deleted by the Owner in between, so tombstones outnumber
 * live rows. A purge refused by name (an exam sat in a class's occurrence,
 * `SESSIONS_HAVE_EXAMS`) is reported and left for the ordering below to clear.
 */
async function purgeTagged(
  entity: string,
  titleOf: (id: string) => Promise<string | null>,
): Promise<void> {
  for (const entry of await prisma.trash.findMany({ where: { targetEntity: entity }, select: { id: true, targetId: true } })) {
    const title = await titleOf(entry.targetId);
    if (title === null || !title.startsWith(FIXTURE_TAG)) continue;
    try {
      await purgeEntry(prisma, actor, entry.id);
      outcomes.push({ entity, id: entry.targetId, name: title, result: 'purged' });
    } catch (error) {
      if (!isRefusal(error)) throw error;
      outcomes.push({ entity, id: entry.targetId, name: title, result: 'left', reason: (error.details?.['reason'] as string | undefined) ?? error.code });
    }
  }
}
await purgeTagged('EducationalContent', async (id) => (await prisma.educationalContent.findUnique({ where: { id }, select: { title: true } }))?.title ?? null);

// 2 · Exams (evidence acknowledged — it is synthetic).
for (const row of await prisma.exam.findMany({ where: { ...taggedTitle, deletedAt: null }, select: { id: true, title: true } })) {
  await remove('Exam', { id: row.id, name: row.title }, () => deleteExam(prisma, actor, row.id, { acknowledgeEvidence: true }), (title) =>
    prisma.exam.update({ where: { id: row.id }, data: { title } }),
  );
}

await purgeTagged('Exam', async (id) => (await prisma.exam.findUnique({ where: { id }, select: { title: true } }))?.title ?? null);

// 3 · Events.
for (const row of await prisma.event.findMany({ where: { ...taggedTitle, deletedAt: null }, select: { id: true, title: true } })) {
  await remove('Event', { id: row.id, name: row.title }, () => deleteEvent(prisma, actor, row.id), (title) =>
    prisma.event.update({ where: { id: row.id }, data: { title } }),
  );
}

await purgeTagged('Event', async (id) => (await prisma.event.findUnique({ where: { id }, select: { title: true } }))?.title ?? null);

// 4 · Class schedules, with their occurrences (R170 §8).
for (const row of await prisma.recurringCourseSchedule.findMany({ where: { ...taggedTitle, deletedAt: null }, select: { id: true, title: true } })) {
  await remove('RecurringCourseSchedule', { id: row.id, name: row.title ?? FIXTURE_TAG }, () => deleteCourseSchedule(prisma, actor, row.id), (title) =>
    prisma.recurringCourseSchedule.update({ where: { id: row.id }, data: { title } }),
  );
}

await purgeTagged('RecurringCourseSchedule', async (id) => (await prisma.recurringCourseSchedule.findUnique({ where: { id }, select: { title: true } }))?.title ?? null);

// 5 · Fixture PEOPLE first among the reference rows: their enrolments, family
// links and consents are synthetic and would otherwise keep a group.
const people = await prisma.user.findMany({
  where: {
    deletedAt: null,
    OR: [{ nameArabic: { startsWith: FIXTURE_TAG } }, { identities: { some: { email: { endsWith: '@example.com' } } } }],
    NOT: { id: actor.userId },
  },
  select: { id: true, nameArabic: true },
});
for (const person of people) {
  try {
    await prisma.$transaction([
      prisma.enrollment.deleteMany({ where: { studentId: person.id } }),
      prisma.familyLink.deleteMany({ where: { OR: [{ parentId: person.id }, { studentId: person.id }] } }),
      prisma.consentRecord.deleteMany({ where: { OR: [{ studentId: person.id }, { grantedByUserId: person.id }, { revokedByUserId: person.id }] } }),
      prisma.courseScheduleStaff.deleteMany({ where: { userId: person.id, schedule: { title: { startsWith: FIXTURE_TAG } } } }),
    ]);
    await purgeUserAccount(prisma, actor, person.id);
    outcomes.push({ entity: 'User', id: person.id, name: person.nameArabic, result: 'purged' });
  } catch (error) {
    if (!isRefusal(error)) throw error;
    outcomes.push({ entity: 'User', id: person.id, name: person.nameArabic, result: 'left', reason: (error.details?.['reason'] as string | undefined) ?? error.code });
  }
}

// 6 · Administrative groups, rooms, branches — deleted where nothing of hers
// remains, renamed where something does.
for (const row of await prisma.administrativeGroup.findMany({ where: { ...tagged, deletedAt: null }, select: { id: true, name: true } })) {
  await remove('AdministrativeGroup', row, () => deleteAdministrativeGroup(prisma, actor, row.id), (name) =>
    prisma.administrativeGroup.update({ where: { id: row.id }, data: { name } }),
  );
}
for (const row of await prisma.room.findMany({ where: { ...tagged, deletedAt: null }, select: { id: true, name: true } })) {
  await remove('Room', row, () => deleteRoom(prisma, actor, row.id), (name) =>
    prisma.room.update({ where: { id: row.id }, data: { name } }),
  );
}
for (const row of await prisma.branch.findMany({ where: { ...tagged, deletedAt: null }, select: { id: true, name: true } })) {
  await remove('Branch', row, () => deleteBranch(prisma, actor, row.id), (name) =>
    prisma.branch.update({ where: { id: row.id }, data: { name } }),
  );
}

for (const [entity, titleOf] of [
  ['AdministrativeGroup', async (id: string) => (await prisma.administrativeGroup.findUnique({ where: { id }, select: { name: true } }))?.name ?? null],
  ['Room', async (id: string) => (await prisma.room.findUnique({ where: { id }, select: { name: true } }))?.name ?? null],
  ['Branch', async (id: string) => (await prisma.branch.findUnique({ where: { id }, select: { name: true } }))?.name ?? null],
] as const) {
  await purgeTagged(entity, titleOf);
}

const summary = outcomes.reduce<Record<string, number>>((acc, o) => {
  acc[`${o.entity}:${o.result}`] = (acc[`${o.entity}:${o.result}`] ?? 0) + 1;
  return acc;
}, {});
process.stdout.write(`${JSON.stringify({ summary, renamed: outcomes.filter((o) => o.result === 'renamed'), left: outcomes.filter((o) => o.result === 'left') }, null, 2)}\n`);
await prisma.$disconnect();
