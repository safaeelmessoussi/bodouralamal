import type { PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../policies/actor.js";
import { AppError } from "../lib/errors.js";
import * as scope from "../policies/branch-scope.js";
import { effectiveWithin } from "../policies/effective-staffing.js";
import {
  isWithinAvailability,
  occupiedWeekdays,
  overlaps,
  seriesCanCoincide,
} from "../policies/teaching-profile.js";

/**
 * **Who would SUIT this class, and why she might not** (R88.4, R90).
 *
 * The administration assigns a main مؤطِّرة and any number of assistants. This
 * read appraises every candidate against the class being planned and returns
 * **warnings** — never a verdict, never a filter.
 *
 * ## The one rule this module must never break
 *
 * **A warning is not a refusal, and the absence of one is not a permission.**
 * Nothing here reads or writes authority. `CourseScheduleStaff` remains the only
 * thing that decides who may teach (§4.4c, R88.3), so:
 *
 * * a مؤطِّرة with four warnings may still be assigned, and the moment she is,
 *   she holds **full** authority over that class;
 * * a مؤطِّرة with a flawless profile and no assignment holds **none**.
 *
 * Every candidate the caller may assign is returned. Returning a shortened list
 * would be this module deciding, in the one way that cannot be overridden.
 *
 * ## Why the server answers this and not the client
 *
 * Three of the four questions are answerable from the profile alone, and the
 * fourth is not: a conflict is a fact about **every other schedule she staffs**,
 * which a client could only compute by fetching the staffing graph. A screen
 * that fetched that graph would be a screen that could also mis-scope it.
 */

export type CandidateWarning =
  | "subject_not_declared"
  | "category_not_declared"
  | "availability_not_declared"
  | "unavailable"
  | "availability_mode_not_declared"
  | "conflict"
  | "availability_indeterminate";

export interface CandidateConflict {
  schedule_id: string;
  title: string;
  weekday: string;
  start_time: string;
  end_time: string;
}

export interface Candidate {
  id: string;
  name_arabic: string;
  /** True when she has declared **nothing at all** — so the interface can say
   *  that once, quietly, instead of three separate accusations. */
  no_profile: boolean;
  warnings: CandidateWarning[];
  conflicts: CandidateConflict[];
}

export interface ProposedClass {
  subjectId?: string | undefined;
  levelId?: string | undefined;
  branchId?: string | undefined;
  recurrence: string;
  weekdays: string[];
  startTime: string;
  endTime: string;
  /** Optional for compatibility with older callers. When present, a range
   * must explicitly support this delivery mode; legacy null is reported as
   * unknown rather than silently treated as either mode. */
  deliveryMode?: "in_person" | "online" | undefined;
  /** The schedule being EDITED. Its own staffing must not be reported as a
   *  clash with itself — the commonest false warning there is. */
  excludeScheduleId?: string | undefined;
  /**
   * **R91 — the period the proposed class runs for.**
   *
   * A conflict now needs BOTH halves: the recurrence and time must collide
   * **and** the two assignments' effective periods must intersect. Absent, the
   * proposed class is treated as open-ended, which is what a class with no
   * stated bounds is.
   */
  effectiveFrom?: Date | undefined;
  effectiveUntil?: Date | undefined;
}

const hhmm = (d: Date): string => d.toISOString().slice(11, 16);

/** Appraising candidates is planning work, and planning is the administration's
 *  (R88.2). The same authorization as reading a teaching profile. */
function assertMayAppraise(actor: Actor): void {
  if (
    !scope.isSuperAdmin(actor.roleScopes) &&
    !scope.hasRole(actor.roleScopes, "admin")
  ) {
    throw new AppError(
      "FORBIDDEN",
      "appraising teaching candidates requires an administrator",
    );
  }
}

export async function listTeachingCandidates(
  prisma: PrismaClient,
  actor: Actor,
  proposed: ProposedClass,
): Promise<Candidate[]> {
  assertMayAppraise(actor);

  /**
   * **The candidates are whoever holds the مؤطِّرة role**, exactly as
   * `إدارة المؤطِّرات` lists them (rule AQ) — asked of the database by role, and
   * never narrowed by `is_beneficiary`, because R79 made that fact independent
   * of every role so a مؤطِّرة may also study.
   */
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: "active",
      branchRoles: { some: { deletedAt: null, role: { name: "teacher" } } },
    },
    select: {
      id: true,
      nameArabic: true,
      subjectCapabilities: { select: { subjectId: true } },
      categoryCapabilities: { select: { categoryId: true } },
      availability: {
        select: { weekday: true, startTime: true, endTime: true, mode: true },
      },
    },
    orderBy: { nameArabic: "asc" },
  });
  if (candidates.length === 0) return [];

  /** The Category the class belongs to, resolved from its Level — the form has
   *  a Level, and Category is what the profile declares (§4.4b). */
  const categoryId = proposed.levelId
    ? (
        (await prisma.level.findUnique({
          where: { id: proposed.levelId },
          select: { categoryId: true },
        })) ?? { categoryId: null }
      ).categoryId
    : null;

  const days = occupiedWeekdays(proposed.recurrence, proposed.weekdays);

  /**
   * **Every OTHER schedule these people staff.**
   *
   * One query for all of them rather than one per candidate: a picker opened on
   * a form must not issue a request per name.
   *
   * `effective_until` is R50's series bound and is honoured — a schedule that
   * ended last term is not something anybody is still doing. **`deleted_at` and
   * `effective_until` are the ONLY time bounds available**, and they belong to
   * the *schedule*, not to the staffing: see the limitation recorded below.
   */
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  /**
   * **R91 — the clean-up this appraisal was designed for.**
   *
   * The pre-R91 query took every live staffing row, because a row had no period
   * and *she staffs this schedule* was all it could say. It therefore reported a
   * **historical** assignment — one whose replacement period ended months ago —
   * as a live conflict for a new class, and could not see that a **future**
   * assignment outside the proposed class's own period does not clash either.
   *
   * The bound is now the intersection of two date ranges: the proposed class's
   * period against each assignment's. A class with no stated bounds is
   * open-ended and intersects everything, which is the pre-R91 answer and
   * remains correct for it.
   */
  const proposedFrom = proposed.effectiveFrom ?? today;
  const proposedUntil =
    proposed.effectiveUntil ?? new Date("9999-12-31T00:00:00.000Z");
  const staffing = await prisma.courseScheduleStaff.findMany({
    where: {
      userId: { in: candidates.map((c) => c.id) },
      ...effectiveWithin(proposedFrom, proposedUntil),
      schedule: {
        deletedAt: null,
        ...(proposed.excludeScheduleId
          ? { id: { not: proposed.excludeScheduleId } }
          : {}),
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: today } }],
      },
    },
    select: {
      userId: true,
      schedule: {
        select: {
          id: true,
          title: true,
          recurrence: true,
          weekdays: true,
          anchorDate: true,
          startTime: true,
          endTime: true,
        },
      },
    },
  });

  const byUser = new Map<string, typeof staffing>();
  for (const row of staffing) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  const proposedSeries = {
    recurrence: proposed.recurrence,
    anchorDate: null as Date | null,
  };

  return candidates.map((candidate) => {
    const warnings: CandidateWarning[] = [];
    const declaredSubjects = candidate.subjectCapabilities.map(
      (s) => s.subjectId,
    );
    const declaredCategories = candidate.categoryCapabilities.map(
      (c) => c.categoryId,
    );
    const declared = candidate.availability.map((a) => ({
      weekday: String(a.weekday),
      start: hhmm(a.startTime),
      end: hhmm(a.endTime),
      mode: a.mode,
    }));

    const noProfile =
      declaredSubjects.length === 0 &&
      declaredCategories.length === 0 &&
      declared.length === 0;

    // **A · Subject.** Silence when the class names no Subject — an appraisal
    // cannot fault her for a question that was not asked.
    if (proposed.subjectId && !declaredSubjects.includes(proposed.subjectId)) {
      warnings.push("subject_not_declared");
    }
    // **B · Category**, resolved from the Level rather than asked of the caller.
    if (categoryId && !declaredCategories.includes(categoryId)) {
      warnings.push("category_not_declared");
    }

    // **C · Availability.** Three outcomes, not two, because *not declared* and
    // *declared and does not fit* are different facts about a person and
    // reporting them with one word would put words in her mouth.
    if (days === null) {
      warnings.push("availability_indeterminate");
    } else if (declared.length === 0) {
      warnings.push("availability_not_declared");
    } else {
      // **EVERY occupied weekday must be covered.** A class on Monday and
      // Wednesday needs her free on both; covering one is not covering the
      // class. `isWithinAvailability` carries the Owner's containment rule —
      // ONE range covers it completely, and two adjacent ranges are never
      // merged to manufacture availability.
      const proposedRange = (weekday: string) => ({
        weekday,
        start: proposed.startTime,
        end: proposed.endTime,
      });
      const timeCovered = (weekday: string, ranges = declared) =>
        isWithinAvailability(proposedRange(weekday), ranges);
      const uncovered = days.filter((weekday) => !timeCovered(weekday));
      if (uncovered.length > 0) {
        warnings.push("unavailable");
      } else if (proposed.deliveryMode) {
        const compatible = declared.filter(
          (range) => range.mode === proposed.deliveryMode || range.mode === "both",
        );
        const unknown = declared.filter((range) => range.mode === null);
        const incompatibleDays = days.filter((weekday) => !timeCovered(weekday, compatible));
        if (incompatibleDays.length > 0) {
          const unknownDays = incompatibleDays.filter((weekday) => timeCovered(weekday, unknown));
          if (unknownDays.length > 0) warnings.push("availability_mode_not_declared");
          if (unknownDays.length < incompatibleDays.length) warnings.push("unavailable");
        }
      }
    }

    // **D · Conflict — a TIME overlap, never "she already has work"** (R88.7).
    const conflicts: CandidateConflict[] = [];
    if (days !== null) {
      for (const row of byUser.get(candidate.id) ?? []) {
        const other = row.schedule;
        const otherDays = occupiedWeekdays(
          other.recurrence,
          other.weekdays.map(String),
        );
        if (otherDays === null) continue;
        if (!seriesCanCoincide(proposedSeries, other)) continue;
        for (const weekday of days) {
          if (!otherDays.includes(weekday)) continue;
          const clash = overlaps(
            { weekday, start: proposed.startTime, end: proposed.endTime },
            { weekday, start: hhmm(other.startTime), end: hhmm(other.endTime) },
          );
          if (!clash) continue;
          conflicts.push({
            schedule_id: other.id,
            title: other.title,
            weekday,
            start_time: hhmm(other.startTime),
            end_time: hhmm(other.endTime),
          });
        }
      }
    }
    if (conflicts.length > 0) warnings.push("conflict");

    return {
      id: candidate.id,
      name_arabic: candidate.nameArabic,
      no_profile: noProfile,
      warnings,
      conflicts,
    };
  });
}
