/**
 * **Fill the room of occurrences that name none** (the Owner, 2026-10-28 —
 * R255: «Fill blanks only», and the existing ones filled once).
 *
 * For every live in-person class with a room, its past and cancelled
 * occurrences whose `room_id` is NULL get the class's room — the rule a class
 * edit now applies itself (`fillBlankSessionRooms`). An occurrence that names a
 * room is never changed. One audit row per class changed.
 *
 *   docker compose exec -T api npm run --silent ops:fill-session-rooms </dev/null
 *
 * **Lists only, by default.** `APPLY=1` writes. (A dry run that needs a flag
 * is the one that gets forgotten — `ops:empty-trash`, 2026-10.)
 */
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import * as audit from '../repositories/audit.repository.js';
import { fillBlankSessionRooms } from '../services/course-schedule.service.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, 2);
const apply = process.env['APPLY'] === '1';

const owner = await prisma.platformOwner.findFirst({ select: { ownerUserId: true } });
if (!owner) throw new Error('no platform owner: nobody to act as');

const now = new Date();
const schedules = await prisma.recurringCourseSchedule.findMany({
  where: { deletedAt: null, deliveryMode: 'in_person', roomId: { not: null } },
  select: { id: true, roomId: true },
});

let total = 0;
for (const schedule of schedules) {
  const blank = await prisma.session.count({
    where: {
      scheduleId: schedule.id,
      deletedAt: null,
      roomId: null,
      deliveryMode: 'in_person',
      OR: [{ date: { lt: now } }, { status: 'cancelled' }],
    },
  });
  if (blank === 0) continue;
  total += blank;
  if (!apply) {
    console.log(`would fill  ${blank} occurrence(s) of class ${schedule.id}`);
    continue;
  }
  const filled = await prisma.$transaction(async (tx) => {
    const count = await fillBlankSessionRooms(tx, schedule.id, schedule.roomId!, now);
    await audit.write(tx, {
      actorUserId: owner.ownerUserId,
      activeRole: 'super_admin',
      actionType: 'courseschedule.update',
      targetEntity: 'RecurringCourseSchedule',
      targetId: schedule.id,
      detail: { past_rooms_filled: count, room_id: schedule.roomId, source: 'ops:fill-session-rooms' },
    });
    return count;
  });
  console.log(`filled  ${filled} occurrence(s) of class ${schedule.id}`);
}

console.log(`${apply ? 'filled' : 'would fill'}: ${total} occurrence(s) in ${schedules.length} class(es) checked`);
await prisma.$disconnect();
