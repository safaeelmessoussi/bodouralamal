import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { createPrismaClient, TEST_CONNECTION_LIMIT } from "../lib/prisma.js";
import type { Actor } from "../policies/actor.js";
import { deleteEvent } from "./event.service.js";
import { deleteCourseSchedule } from "./course-schedule.service.js";
import { createTeachingContext } from "../test-support/educational-fixture.js";

/**
 * **Every soft delete reaches the Trash** (TD-5, BR-15, §4.10, R52).
 *
 * ## The defect this file exists for
 *
 * Deleting an Event or a Course Schedule set `deleted_at` and wrote an audit row
 * — and wrote **no `Trash` snapshot**. The record vanished from every screen and
 * appeared on the one screen built to report deletions as *nothing at all*. It
 * was not recoverable either: §4.10's restore runbook reads the snapshot, and
 * there was none.
 *
 * The reason it went unnoticed is worth stating, because it generalises: every
 * one of those services had a passing test for *"the row is soft-deleted"*, and
 * that assertion is true of a half-implemented delete. **Soft deletion is two
 * obligations — hide the row, and record what was hidden — and a test for the
 * first cannot see the absence of the second.**
 *
 * ## Why the guard below is structural rather than a list of cases
 *
 * A per-entity test would have to be remembered for every entity added later,
 * which is exactly the discipline that failed here. So the last test reads the
 * service sources and requires that **each exported deletion operation writing
 * a `deletedAt` tombstone also calls `trash.snapshot` in that operation**. The
 * older file-wide check was insufficient: one compliant function could hide a
 * second omission in the same module, exactly what happened to LevelSurah.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = "[trash-coverage]";

const actor = (): Actor =>
  ({
    userId: actorId,
    roles: ["super_admin"],
    roleScopes: [{ role: "super_admin", branches: null }],
  }) as unknown as Actor;

let actorId = "";
let branchId = "";

async function clear(): Promise<void> {
  const ids = (
    await prisma.user.findMany({
      where: { nameArabic: { startsWith: TAG } },
      select: { id: true },
    })
  ).map((u) => u.id);
  const levels = (
    await prisma.level.findMany({
      where: { name: { startsWith: TAG } },
      select: { id: true },
    })
  ).map((l) => l.id);
  const groups = (
    await prisma.administrativeGroup.findMany({
      where: { levelId: { in: levels } },
      select: { id: true },
    })
  ).map((g) => g.id);
  const schedules = (
    await prisma.recurringCourseSchedule.findMany({
      where: { administrativeGroupId: { in: groups } },
      select: { id: true },
    })
  ).map((s) => s.id);
  const events = (
    await prisma.event.findMany({
      where: { title: { startsWith: TAG } },
      select: { id: true },
    })
  ).map((e) => e.id);

  await prisma.trash.deleteMany({
    where: { targetId: { in: [...schedules, ...events] } },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: events } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: events } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: events } } });
  await prisma.eventAdministrativeGroup.deleteMany({
    where: { eventId: { in: events } },
  });
  // R71 — `event_staff` is RESTRICT like the other event children, so it
  // goes before the event it points at.
  await prisma.eventStaff.deleteMany({ where: { eventId: { in: events } } });
  // R82 — notices RESTRICT the event they are about; teardown clears them first.
  await prisma.notification.deleteMany({ where: { event: { id: { in: events } } } });
  await prisma.event.deleteMany({ where: { id: { in: events } } });
  await prisma.sessionStaff.deleteMany({
    where: { session: { scheduleId: { in: schedules } } },
  });
  // R77 — `notification.session_id` is RESTRICT, like every other reference
  // to a Session: a cancellation notice whose session vanished is unreadable.
  // Fixtures therefore unwind notices before the occurrences they name.
  await prisma.notification.deleteMany({
    where: { session: { scheduleId: { in: schedules } } },
  });
  await prisma.session.deleteMany({ where: { scheduleId: { in: schedules } } });
  await prisma.courseScheduleStaff.deleteMany({
    where: { scheduleId: { in: schedules } },
  });
  await prisma.recurringCourseSchedule.deleteMany({
    where: { id: { in: schedules } },
  });
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.administrativeGroup.deleteMany({
    where: { id: { in: groups } },
  });
  await prisma.levelSubject.deleteMany({ where: { levelId: { in: levels } } });
  await prisma.level.deleteMany({ where: { id: { in: levels } } });
  await prisma.subject.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeEach(async () => {
  await clear();
  actorId = (
    await prisma.user.create({
      data: { sex: 'female', nameArabic: `${TAG} مديرة`, accountStatus: "active" },
    })
  ).id;
  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe("deleting an Event (الأنشطة)", () => {
  it("leaves a Trash entry, not just a tombstone", async () => {
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط`,
        startDate: new Date("2026-10-01"),
        visibility: "public",
        recurrenceType: "none",
      },
    });
    await prisma.eventBranch.create({ data: { eventId: event.id, branchId } });

    await deleteEvent(prisma, actor(), event.id);

    const entry = await prisma.trash.findFirst({
      where: { targetEntity: "Event", targetId: event.id },
    });
    expect(entry).not.toBeNull();
    expect(entry!.deletedById).toBe(actorId);
    // BR-15's window is the deadline for acting, so it has to be on the row.
    expect(entry!.purgeAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("captures the scope joins, which the delete HARD removes", async () => {
    // Without this the snapshot describes an event that reaches nobody: the
    // joins are gone from the database, so the snapshot is the only record that
    // this event was ever scoped to that branch.
    const event = await prisma.event.create({
      data: {
        title: `${TAG} نشاط بنطاق`,
        startDate: new Date("2026-10-02"),
        visibility: "public",
        recurrenceType: "none",
      },
    });
    await prisma.eventBranch.create({ data: { eventId: event.id, branchId } });

    await deleteEvent(prisma, actor(), event.id);

    const entry = await prisma.trash.findFirstOrThrow({
      where: { targetEntity: "Event", targetId: event.id },
    });
    const snapshot = entry.snapshot as { scope?: { branch_ids?: string[] } };
    expect(snapshot.scope?.branch_ids).toEqual([branchId]);
    expect(
      await prisma.eventBranch.count({ where: { eventId: event.id } }),
    ).toBe(0);
  });
});

describe("deleting a Course Schedule (الحصص)", () => {
  it("leaves a Trash entry carrying its staff and the occurrences it removed", async () => {
    const fixture = await createTeachingContext(prisma, TAG, branchId);
    await prisma.courseScheduleStaff.create({
      data: {
        scheduleId: fixture.scheduleId,
        userId: actorId,
        position: "teacher",
      },
    });

    await deleteCourseSchedule(prisma, actor(), fixture.scheduleId);

    const entry = await prisma.trash.findFirst({
      where: {
        targetEntity: "RecurringCourseSchedule",
        targetId: fixture.scheduleId,
      },
    });
    expect(entry).not.toBeNull();
    const snapshot = entry!.snapshot as {
      staff?: { userId: string }[];
      removed_session_ids?: string[];
    };
    // `CourseScheduleStaff` is what makes a teacher's reach expressible (§4.4c),
    // so a schedule restored without it is a class nobody teaches.
    expect(snapshot.staff?.map((s) => s.userId)).toContain(actorId);
    expect(Array.isArray(snapshot.removed_session_ids)).toBe(true);
  });
});

describe("the structural guard", () => {
  it("names any exported deletion operation that writes a tombstone without a Trash snapshot", () => {
    // The discipline that failed here was "remember to snapshot", so this does
    // not enumerate entities — it reads the sources. A new service that
    // soft-deletes and forgets is named by this test on the day it is written,
    // rather than on the day somebody looks in the Trash for a record that
    // never arrived.
    const dir = new URL(".", import.meta.url).pathname;
    const offenders: string[] = [];

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".service.ts")) continue;
      const source = readFileSync(join(dir, file), "utf8");
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node): void => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          node.body &&
          node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
          /^(delete|remove|unassign|revoke|withdraw)/.test(node.name.text)
        ) {
          let tombstones = false;
          let snapshots = false;
          const inspectOperation = (operation: ts.Node): void => {
            if (ts.isCallExpression(operation)) {
              const callee = operation.expression;
              if (
                ts.isPropertyAccessExpression(callee) &&
                (callee.name.text === 'update' || callee.name.text === 'updateMany')
              ) {
                const options = operation.arguments[0];
                if (options && ts.isObjectLiteralExpression(options)) {
                  const data = options.properties.find(
                    (property): property is ts.PropertyAssignment =>
                      ts.isPropertyAssignment(property) && property.name.getText(parsed) === 'data',
                  );
                  if (data && ts.isObjectLiteralExpression(data.initializer)) {
                    tombstones ||= data.initializer.properties.some(
                      (property) =>
                        ts.isPropertyAssignment(property) &&
                        property.name.getText(parsed) === 'deletedAt' &&
                        property.initializer.kind !== ts.SyntaxKind.NullKeyword,
                    );
                  }
                }
              }
              if (
                (ts.isPropertyAccessExpression(callee) && callee.name.text === 'snapshot') ||
                (ts.isIdentifier(callee) && callee.text === 'snapshot')
              ) {
                snapshots = true;
              }
            }
            ts.forEachChild(operation, inspectOperation);
          };
          inspectOperation(node.body);
          if (tombstones && !snapshots) offenders.push(`${file}:${node.name.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }

    // **The `enrollment.service.ts` exemption was removed by R59.2**, and the
    // reasoning it carried is kept here rather than deleted. It read:
    // *un-enrolment is a membership ending, not a record being deleted; there is
    // nothing to restore that re-enrolling does not do properly.* That was a
    // defensible reading of TD-5, which soft-deletes the enrolment row and
    // leaves every academic record intact.
    //
    // The Document Owner has since ruled that **anything soft-deleted by any
    // role appears in the Trash** — and §7's restore runbook already named
    // `Enrollment` among the rows a restoration must reinstate, rows it could
    // not have found. The list is empty now, which is the only state that needs
    // no defending.
    expect(
      offenders,
      `soft-delete without a Trash snapshot: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

/**
 * **A deleted row never appears in an ordinary read.**
 *
 * The Trash is not a frontend filter: a soft-deleted record has to be absent
 * from lists, selectors, the calendar, the library and every scope query, and
 * absent *at the database boundary* rather than dropped on the way out. This
 * scans every read of a soft-deletable model and requires a `deletedAt`
 * constraint on it — either inline or in the `where` object built above it.
 *
 * Two reads are exempt and each says why. An exemption is a statement about the
 * code, not a way to quiet the check.
 */
const READS_TOMBSTONES_DELIBERATELY: Record<string, string> = {
  // R59 — reconciling exam staff must SEE tombstoned rows: the unique pair is
  // not filtered on `deleted_at`, so a returning supervisor is revived rather
  // than inserted, and an insert would be refused.
  "exam.service.ts": "revives tombstoned ExamStaff rows",
};

describe("a soft-deleted row is excluded at the database boundary", () => {
  it("constrains deletedAt on every read of a soft-deletable model", () => {
    const schema = readFileSync(
      new URL("../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const softDeletable = new Set(
      [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
        .filter(([, , body]) => body!.includes("deletedAt"))
        .map(([, name]) => name![0]!.toLowerCase() + name!.slice(1)),
    );

    const unfiltered: string[] = [];
    const dir = new URL(".", import.meta.url).pathname;

    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.includes(".test."),
    )) {
      if (READS_TOMBSTONES_DELIBERATELY[file]) continue;
      const source = readFileSync(`${dir}${file}`, "utf8");
      const lines = source.split("\n");

      for (const match of source.matchAll(
        /\b(?:tx|prisma)\.(\w+)\.(findMany|findFirst|count)\(/g,
      )) {
        if (!softDeletable.has(match[1]!)) continue;

        // The call's own argument block, then the forty lines above it — the
        // `where` is often a named object, which is idiomatic here and not a gap.
        const start = match.index! + match[0]!.length - 1;
        let depth = 0;
        let end = start;
        while (end < source.length) {
          if ("({[".includes(source[end]!)) depth += 1;
          else if (")}]".includes(source[end]!)) {
            depth -= 1;
            if (depth === 0) break;
          }
          end += 1;
        }
        if (source.slice(start, end).includes("deletedAt")) continue;

        const lineNo = source.slice(0, match.index).split("\n").length;
        if (
          lines
            .slice(Math.max(0, lineNo - 40), lineNo)
            .join("\n")
            .includes("deletedAt")
        )
          continue;

        unfiltered.push(`${file}:${lineNo} ${match[1]}.${match[2]}`);
      }
    }

    expect(unfiltered).toEqual([]);
  });
});
