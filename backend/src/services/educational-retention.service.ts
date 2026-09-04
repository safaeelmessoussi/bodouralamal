import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as audit from '../repositories/audit.repository.js';
import { destroyEducationalRecord } from './erasure.js';

/**
 * **When does a beneficiary's educational history stop being retained?**
 * (SRS §4.10a, Revision 131.)
 *
 * ## The policy, and what this module is
 *
 * Identifiable educational history is retained for **ten years after the
 * beneficiary's last educational activity**. That is **the association's own
 * purpose-based policy** — for educational continuity, former-beneficiary
 * requests and attestations — and **not** a duration prescribed, reviewed or
 * approved by the CNDP, nor a universal requirement of Moroccan law. Nothing
 * here may be described as either.
 *
 * **This module computes and explains. It deletes nothing and schedules
 * nothing.** §4.10a forbids destructive automation until the cross-domain
 * classifications it leaves open are settled, and several are not. What exists
 * is the deterministic half: given a beneficiary, *when does her retention
 * period end, and which fact decided it* — so the policy can be inspected long
 * before anything acts on it.
 *
 * ## "Last educational activity" is DERIVED, never a maintained column
 *
 * §4.10a is explicit: a dedicated `last_activity_at` would be a fact nobody
 * updates consistently, and **a retention clock driven by a stale column deletes
 * the wrong records**. The boundary is the latest of the canonical durable facts
 * the platform already records, and only those five:
 *
 * | fact | coordinate |
 * |---|---|
 * | enrolment | its `AcademicPeriod`'s `end_date`, falling back to `enrolled_at` where a legacy row has no period |
 * | attendance | `occurrence_date` |
 * | grade | the `date` of the exam it is against |
 * | assessment submission | `submitted_at`, else `started_at` |
 * | Quran progression | `logged_at` |
 *
 * **`updated_at` appears nowhere**, deliberately: it moves when somebody fixes a
 * typo, which is not educational activity.
 *
 * ## Soft-deleted rows still count
 *
 * A withdrawn enrolment or a removed attendance mark **still records that she
 * was there**, and §4.10a retains the history rather than the live roster. Using
 * only live rows would shorten the period on the strength of an administrative
 * correction — exactly the accident this derivation exists to avoid.
 */

/** Ten years, the association's own policy (§4.10a). Not a legal citation. */
export const EDUCATIONAL_RETENTION_YEARS = 10;

/** Which canonical fact decided the boundary — the answer's explanation. */
export type ActivityKind =
  | 'enrolment_period_end'
  | 'enrolment_instant'
  | 'attendance'
  | 'grade_exam_date'
  | 'assessment_submission'
  | 'quran_progress';

export interface RetentionReport {
  studentId: string;
  /** The latest canonical educational fact, or `null` when there is none. */
  lastActivityAt: Date | null;
  /** Which fact it was — so the answer can be checked rather than trusted. */
  lastActivityKind: ActivityKind | null;
  /** `lastActivityAt` + ten years, or `null` when there is no history at all. */
  retainUntil: Date | null;
  /** Whether the period has elapsed as at the reference date. */
  elapsed: boolean;
}

/** Adds whole years without drifting on a leap day. */
function addYears(from: Date, years: number): Date {
  const d = new Date(from.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * Computes the retention boundary for one beneficiary, with the reason.
 *
 * `now` is a parameter because a report run for a past date must answer as of
 * that date — and because a test that cannot control the clock is a test that
 * either sleeps or skips the boundary, and both are worse.
 */
export async function retentionFor(
  prisma: PrismaClient,
  studentId: string,
  now: Date = new Date(),
): Promise<RetentionReport> {
  const candidates: { at: Date; kind: ActivityKind }[] = [];

  // ── Enrolment: the period's end, or the enrolment instant for a legacy row.
  const enrolments = await prisma.enrollment.findMany({
    where: { studentId },
    select: { enrolledAt: true, academicPeriod: { select: { endDate: true } } },
  });
  for (const row of enrolments) {
    if (row.academicPeriod) {
      candidates.push({ at: row.academicPeriod.endDate, kind: 'enrolment_period_end' });
    } else {
      // R122 left historical rows without a period deliberately — guessing a
      // semester the association never recorded would be indistinguishable from
      // a real one. The enrolment instant is the honest fallback §4.10a names.
      candidates.push({ at: row.enrolledAt, kind: 'enrolment_instant' });
    }
  }

  const attendance = await prisma.attendance.findFirst({
    where: { studentId },
    orderBy: { occurrenceDate: 'desc' },
    select: { occurrenceDate: true },
  });
  if (attendance) candidates.push({ at: attendance.occurrenceDate, kind: 'attendance' });

  // A grade's date is the SITTING's, not the marking's: the educational activity
  // is the exam she sat, and a mark entered late does not extend her history.
  const grade = await prisma.grade.findFirst({
    where: { studentId },
    orderBy: { exam: { date: 'desc' } },
    select: { exam: { select: { date: true } } },
  });
  if (grade) candidates.push({ at: grade.exam.date, kind: 'grade_exam_date' });

  const submission = await prisma.studentExamSubmission.findFirst({
    where: { studentId },
    orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
    select: { submittedAt: true, startedAt: true },
  });
  if (submission) {
    candidates.push({
      at: submission.submittedAt ?? submission.startedAt,
      kind: 'assessment_submission',
    });
  }

  const quran = await prisma.quranProgressLog.findFirst({
    where: { studentId },
    orderBy: { loggedAt: 'desc' },
    select: { loggedAt: true },
  });
  if (quran) candidates.push({ at: quran.loggedAt, kind: 'quran_progress' });

  if (candidates.length === 0) {
    // **No educational history at all is not "retain until now".** A guardian-only
    // account and a beneficiary who never attended anything have no educational
    // retention period, and reporting one would invite a purge that this policy
    // never authorised.
    return {
      studentId,
      lastActivityAt: null,
      lastActivityKind: null,
      retainUntil: null,
      elapsed: false,
    };
  }

  const latest = candidates.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
  const retainUntil = addYears(latest.at, EDUCATIONAL_RETENTION_YEARS);
  return {
    studentId,
    lastActivityAt: latest.at,
    lastActivityKind: latest.kind,
    retainUntil,
    // Strictly after: on the boundary day itself the period has not elapsed.
    elapsed: now.getTime() > retainUntil.getTime(),
  };
}

/**
 * **A DRY RUN, and it stays one.** Reports every beneficiary whose retention
 * period has elapsed, with the fact that decided each — so the policy can be
 * inspected, argued with and corrected before anything acts on it.
 *
 * **It deletes nothing and schedules nothing.** Destructive execution is gated
 * on §4.10a's open classifications, and this report is deliberately the whole
 * of the implementation until they are settled.
 */
export async function elapsedRetentionReport(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RetentionReport[]> {
  const beneficiaries = await prisma.user.findMany({
    where: { isBeneficiary: true },
    select: { id: true },
  });
  const reports: RetentionReport[] = [];
  for (const person of beneficiaries) {
    const report = await retentionFor(prisma, person.id, now);
    if (report.elapsed) reports.push(report);
  }
  return reports;
}

/**
 * **Destroys the educational record of everyone past ten years** (§4.10a; Owner
 * decision, 2026-09-04 authorising execution).
 *
 * ## It destroys the RECORD, not the account — and that distinction is the
 * whole design
 *
 * §4.10a's clock is about *identifiable educational history*: it is retained ten
 * years after the last educational activity, for educational continuity, former-
 * beneficiary requests and attestations. When those purposes lapse, **the
 * history goes; the account does not**. A person whose studies ended a decade
 * ago may well be a مؤطِّرة today, and closing her account because her own
 * education ended would be an obvious wrong. Closing an account is a deliberate
 * act with its own authority — Option A, Option B, guardian-only cleanup — and
 * this is not one of them.
 *
 * ## One primitive, two policies
 *
 * `destroyEducationalRecord` is the same function Option B runs. The data
 * treatment is identical; only the reason differs — there, she asked and a Super
 * Admin approved, here nobody asked and the calendar arrived. A second
 * implementation would be a second answer to *what counts as her educational
 * record*, and the two would drift.
 *
 * ## Fail closed, per person
 *
 * One subject that cannot be erased is counted and skipped, never allowed to
 * abort the sweep — a single stuck record must not freeze the whole policy — and
 * an unexpected error still propagates, or a run that swallowed everything would
 * report success while destroying nothing.
 *
 * **In practice this deletes nothing for years**, because the platform is months
 * old and the boundary is ten years past the last activity. That is the correct
 * time to build it: the behaviour can be proved on fixtures with no live record
 * anywhere near the boundary.
 */
export async function purgeElapsedRetention(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ purged: number; failed: number }> {
  const due = await elapsedRetentionReport(prisma, now);

  let purged = 0;
  let failed = 0;
  for (const report of due) {
    try {
      await prisma.$transaction(async (tx) => {
        await destroyEducationalRecord(tx, report.studentId);
        await audit.write(tx, {
          // System-initiated: the calendar decided, not a person (R60.8).
          actorUserId: null,
          actionType: 'retention.educational_purge',
          targetEntity: 'User',
          targetId: report.studentId,
          /**
           * **Ids and the boundary, never a value** (TD-8, TD-14). Which fact
           * decided the clock is recorded because it is what makes the decision
           * checkable; how many grades she had is not, because a count is itself
           * a fact about her education.
           */
          detail: {
            years: EDUCATIONAL_RETENTION_YEARS,
            last_activity_kind: report.lastActivityKind,
            retain_until: report.retainUntil?.toISOString() ?? null,
          },
        });
      });
      purged += 1;
    } catch (error) {
      if (error instanceof AppError) {
        failed += 1;
      } else {
        throw error;
      }
    }
  }
  return { purged, failed };
}
