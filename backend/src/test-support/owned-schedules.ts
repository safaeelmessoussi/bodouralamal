import type { Prisma } from '../generated/prisma/client.js';

/**
 * **The classes a fixture OWNS, found by what they are attached to — never by a
 * title** (SRS Revision 166 §3).
 *
 * Fixtures and scenario seeds used to wipe their classes with
 * `where: { title: { startsWith: TAG } }`. A class no longer has a typed title:
 * one created through the real service stores none, so that filter finds
 * nothing, the class stays behind, and it then pins its Level, Subject, branch
 * and academic year behind RESTRICT foreign keys for every suite that runs
 * after it. (The same failure `seed-dev-scenario` had on 2026-09-20, when a
 * split's successor took an untagged title.)
 *
 * Ownership is what it is attached to: a tagged Subject, branch, room, Level,
 * group or circle — directly or through a filter-built class's scope rows — or
 * a tagged `description`. `title` stays in the list for rows a fixture writes
 * straight into the table, which may still carry one.
 */
export function ownedSchedules(tag: string): Prisma.RecurringCourseScheduleWhereInput {
  const named = { name: { startsWith: tag } };
  return {
    OR: [
      { title: { startsWith: tag } },
      { description: { startsWith: tag } },
      { subject: named },
      { branch: named },
      { room: named },
      { level: named },
      { administrativeGroup: named },
      { teachingGroup: named },
      { levelScopes: { some: { level: named } } },
      { administrativeGroupScopes: { some: { administrativeGroup: named } } },
      { teachingGroupScopes: { some: { teachingGroup: named } } },
    ],
  };
}
