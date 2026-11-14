/**
 * **Merge two classes that say the same thing into one** (the Owner,
 * 2026-11-14: two edits of «حصص الجدول» left two schedules «that have same
 * details» — «i want the two … to be merged»).
 *
 *   docker compose exec -T -e KEEP=<id> -e MERGE=<id> api npm run --silent ops:merge-schedules </dev/null
 *
 * Refused unless every detail of the two classes is the same — subject, type,
 * time, recurrence, place, delivery, visibility, year, filters, Surahs, staff —
 * and no date of MERGE's occurrences is already one of KEEP's. Then MERGE's
 * occurrences move to KEEP (each keeps its own history: attendance, files,
 * exams), KEEP's dates widen to cover both, and MERGE — now empty — goes to the
 * Trash through the platform's own delete. Audited on both.
 *
 * **Lists only, by default.** `APPLY=1` writes.
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import { deleteCourseSchedule } from '../services/course-schedule.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 2);
const apply = process.env['APPLY'] === '1';
const keepId = process.env['KEEP'] ?? '';
const mergeId = process.env['MERGE'] ?? '';
if (!keepId || !mergeId || keepId === mergeId) throw new Error('KEEP and MERGE: two different schedule ids');

const owner = await prisma.platformOwner.findFirst({ select: { ownerUserId: true } });
if (!owner) throw new Error('no platform owner: nobody to act as');
const actor: Actor = {
  userId: owner.ownerUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
};

const read = (id: string) =>
  prisma.recurringCourseSchedule.findFirst({
    where: { id, deletedAt: null },
    include: {
      branchScopes: { select: { branchId: true } },
      categoryScopes: { select: { categoryId: true } },
      levelScopes: { select: { levelId: true } },
      administrativeGroupScopes: { select: { administrativeGroupId: true } },
      teachingGroupScopes: { select: { teachingGroupId: true } },
      surahs: { select: { surahId: true } },
      staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
    },
  });
const keep = await read(keepId);
const merge = await read(mergeId);
if (!keep || !merge) throw new Error('no such live schedule');

/** What makes two classes the same class. */
const identity = (s: NonNullable<typeof keep>) =>
  JSON.stringify({
    title: s.title,
    description: s.description,
    schedulingTypeId: s.schedulingTypeId,
    attendanceMarking: s.attendanceMarking,
    subjectId: s.subjectId,
    teachingMode: s.teachingMode,
    audienceTracks: [...s.audienceTracks].sort(),
    levelId: s.levelId,
    administrativeGroupId: s.administrativeGroupId,
    teachingGroupId: s.teachingGroupId,
    branchId: s.branchId,
    roomId: s.roomId,
    deliveryMode: s.deliveryMode,
    onlineMediaMode: s.onlineMediaMode,
    startTime: s.startTime.toISOString(),
    endTime: s.endTime.toISOString(),
    visibility: s.visibility,
    recurrence: s.recurrence,
    weekdays: [...s.weekdays].sort(),
    dayOfMonth: s.dayOfMonth,
    monthOfYear: s.monthOfYear,
    academicYearId: s.academicYearId,
    branches: s.branchScopes.map((r) => r.branchId).sort(),
    categories: s.categoryScopes.map((r) => r.categoryId).sort(),
    levels: s.levelScopes.map((r) => r.levelId).sort(),
    groups: s.administrativeGroupScopes.map((r) => r.administrativeGroupId).sort(),
    circles: s.teachingGroupScopes.map((r) => r.teachingGroupId).sort(),
    surahs: s.surahs.map((r) => r.surahId).sort((a, b) => a - b),
    staff: s.staff.map((r) => `${r.userId}:${r.position}`).sort(),
  });
const a = JSON.parse(identity(keep)) as Record<string, unknown>;
const b = JSON.parse(identity(merge)) as Record<string, unknown>;
const differs = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
if (differs.length > 0) {
  console.log(`refused: the two classes differ in ${differs.join(', ')}`);
  await prisma.$disconnect();
  process.exit(1);
}

const sessionsOf = (scheduleId: string) =>
  prisma.session.findMany({ where: { scheduleId, deletedAt: null }, select: { id: true, date: true } });
const keepDates = new Set((await sessionsOf(keepId)).map((s) => s.date.toISOString().slice(0, 10)));
const moving = await sessionsOf(mergeId);
const collide = moving.filter((s) => keepDates.has(s.date.toISOString().slice(0, 10)));
if (collide.length > 0) {
  console.log(`refused: both classes hold ${collide.map((s) => s.date.toISOString().slice(0, 10)).join(', ')}`);
  await prisma.$disconnect();
  process.exit(1);
}

const day = (d: Date | null) => (d === null ? null : d.getTime());
const anchors = [keep.anchorDate, merge.anchorDate].filter((d): d is Date => d !== null);
const anchorDate = anchors.length > 0 ? new Date(Math.min(...anchors.map((d) => d.getTime()))) : null;
const effectiveUntil =
  keep.effectiveUntil === null || merge.effectiveUntil === null
    ? null
    : new Date(Math.max(day(keep.effectiveUntil)!, day(merge.effectiveUntil)!));
const iso = (d: Date | null) => (d === null ? '—' : d.toISOString().slice(0, 10));

console.log(`same details: yes`);
console.log(`move ${moving.length} occurrence(s) ${moving.map((s) => iso(s.date)).join(', ')} into ${keepId}`);
console.log(`dates of ${keepId}: ${iso(keep.anchorDate)} → ${iso(keep.effectiveUntil)}  becomes  ${iso(anchorDate)} → ${iso(effectiveUntil)}`);
console.log(`then ${mergeId} (empty) to the Trash`);
if (!apply) {
  console.log('nothing written (APPLY=1 writes)');
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(async (tx) => {
  for (const s of moving) {
    await tx.session.update({ where: { id: s.id }, data: { scheduleId: keepId, version: { increment: 1 } } });
  }
  await tx.recurringCourseSchedule.update({
    where: { id: keepId },
    data: { anchorDate, effectiveUntil, version: { increment: 1 } },
  });
  for (const [target, role] of [
    [keepId, 'kept'],
    [mergeId, 'merged'],
  ] as const) {
    await audit.write(tx, {
      actorUserId: owner.ownerUserId,
      activeRole: 'super_admin',
      actionType: 'courseschedule.update',
      targetEntity: 'RecurringCourseSchedule',
      targetId: target,
      detail: {
        source: 'ops:merge-schedules',
        role,
        kept_id: keepId,
        merged_id: mergeId,
        sessions_moved: moving.map((s) => s.id),
      },
    });
  }
});
const removed = await deleteCourseSchedule(prisma, actor, mergeId);
console.log(`merged: ${moving.length} occurrence(s) moved; ${mergeId} to the Trash (${JSON.stringify(removed)})`);
await prisma.$disconnect();
