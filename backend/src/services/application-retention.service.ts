import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as audit from '../repositories/audit.repository.js';
import { deleteUserAccountSystem } from './account-deletion.service.js';

/**
 * **How long a refused application is kept** (SRS §4.10a, Revision 131).
 *
 * > A **rejected** application is retained for **twelve months after
 * > rejection**, together with the necessary rejection evidence, so the decision
 * > and its reason survive the relevant academic cycle and an accidental
 * > re-acceptance within it is avoided. **This is a maximum, not indefinite
 * > retention.**
 *
 * ## What this module is, and what it deliberately omits
 *
 * **It now EXECUTES** (Owner, 2026-09-04). The dry run remains, because a
 * deterministic eligibility function is what makes the destructive half
 * testable and diagnosable — but the boundary is enforced rather than merely
 * reported.
 *
 * ## The two reference points, both now settled
 *
 * * **Rejected: twelve months from `decided_at`**, the rejection instant.
 * * **Pending and never converted: twelve months from `created_at`** (Owner
 *   decision, 2026-09-04). §4.10a said only *"from its own reference point"*;
 *   `created_at` and `consent_given_at` are both defensible and give different
 *   answers, and the Owner chose the one that cannot drift. **Deliberately not
 *   `updated_at`**: an administrator opening a record would postpone its
 *   expiry, which is a retention clock nobody controls.
 *
 * **There is no renewal lifecycle.** An application that expires is gone; if the
 * family still wants a place, a fresh application is one form. Building
 * extension machinery to avoid re-typing a form would be exactly the recoverable
 * complexity the Owner's simplicity principle rules out.
 *
 * **A rejected REGISTRATION is a person, not an application row**, so it is
 * measured here and executed through the account's own machinery — see
 * `elapsedRejectedRegistrations` below. Folding it into the application delete
 * would apply an application rule to an account.
 */

/** §4.10a's maximum. Not a legal citation — the association's own policy. */
export const APPLICATION_RETENTION_MONTHS = 12;

/** Which clock decided this row, so a report can be checked rather than trusted. */
export type ApplicationRetentionBasis = 'rejected_at' | 'created_at';

export interface ApplicationRetentionReport {
  applicationId: string;
  /** `rejected_at` for a decided row, `created_at` for one never decided. */
  basis: ApplicationRetentionBasis;
  /** The instant the clock started, whichever clock it is. */
  measuredFrom: Date;
  retainUntil: Date;
  elapsed: boolean;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Every application whose twelve months have elapsed, on whichever clock.
 *
 * **Read-only, and it stays that way** — `purgeElapsedApplications` is the
 * destructive half and calls this. Keeping the eligibility rule in one function
 * means the thing that deletes and the thing that reports can never disagree
 * about what is due, which is the failure that makes a purge frightening.
 *
 * **Approved applications are absent by construction.** They have become a
 * child, an enrolment and a family link; the row is the record of how that
 * person joined and is retained with the educational archive, not on this clock.
 *
 * **Soft-deleted rows are INCLUDED, deliberately.** A tombstoned application
 * still holds the child's copied name and birth date, so it is still
 * identifiable data with a retention boundary — and being in the Trash is not a
 * reason to keep it longer than one that never was. This is the one query in the
 * module that reads past `deleted_at`, and `trash-coverage` records it as such.
 */
export async function elapsedApplications(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<ApplicationRetentionReport[]> {
  const rows = await prisma.childApplication.findMany({
    where: {
      OR: [
        { status: 'rejected', decidedAt: { not: null } },
        // Never converted: `child_user_id` is written only at approval, so its
        // absence is the durable form of "this never became anybody".
        { status: 'pending', childUserId: null },
      ],
    },
    select: { id: true, status: true, decidedAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  return rows
    .map((row) => {
      const rejected = row.status === 'rejected' && row.decidedAt !== null;
      const measuredFrom = rejected ? row.decidedAt! : row.createdAt;
      const retainUntil = addMonths(measuredFrom, APPLICATION_RETENTION_MONTHS);
      return {
        applicationId: row.id,
        basis: (rejected ? 'rejected_at' : 'created_at') as ApplicationRetentionBasis,
        measuredFrom,
        retainUntil,
        // Strictly after: on the boundary day itself the period has not elapsed.
        elapsed: now.getTime() > retainUntil.getTime(),
      };
    })
    .filter((report) => report.elapsed);
}

/**
 * **Deletes every application past its twelve months** (Owner, 2026-09-04).
 *
 * ## Why the row goes rather than being stripped
 *
 * The Owner's simplicity principle: once an approved retention boundary is
 * reached, prefer permanent deletion to further archival machinery. A stripped
 * `ChildApplication` would be a row with every identifying column nulled, no
 * subject, and a `consent_text_version` recording that somebody consented on
 * behalf of a child who never existed — an evidence shape with nothing left to
 * evidence. **No Trash row is written**: a restorable snapshot of the data whose
 * retention just expired is the retention not expiring.
 *
 * **The decision survives in audit**, which has its own independent purpose and
 * its own schedule. The audit row names the application id, the clock that
 * decided it and the elapsed boundary — **never a name, never a date of birth**
 * (TD-8, TD-14): a row recording an erasure must not become the last copy.
 *
 * ## Idempotent and safe to run twice
 *
 * Deletion is by explicit id list within one transaction, and a second run finds
 * nothing due because the rows are gone. A crash between the delete and the
 * audit write rolls both back together.
 */
export async function purgeElapsedApplications(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const due = await elapsedApplications(prisma, now);
  if (due.length === 0) return { deleted: 0 };

  const ids = due.map((d) => d.applicationId);

  return prisma.$transaction(async (tx) => {
    /**
     * **The Trash snapshot goes first, in the same transaction.**
     *
     * A snapshot is a JSON copy of the row written so the row can come back, so
     * deleting the application and keeping its snapshot would leave the child's
     * name and birth date in JSONB and the retention would be cosmetic. This is
     * the identical trap `deIdentifyAccount` documents for `User`, and it is
     * worth stating twice because the two are far apart in the codebase.
     */
    await tx.trash.deleteMany({
      where: { targetEntity: 'ChildApplication', targetId: { in: ids } },
    });

    const result = await tx.childApplication.deleteMany({
      where: { id: { in: ids } },
    });

    for (const item of due) {
      await audit.write(tx, {
        // **System-initiated**: no administrator decided this, the calendar did.
        // R60.8 states that an audit row omits the capacity where none exists.
        actorUserId: null,
        actionType: 'childapplication.retention_purge',
        targetEntity: 'ChildApplication',
        targetId: item.applicationId,
        detail: {
          basis: item.basis,
          retain_until: item.retainUntil.toISOString(),
          months: APPLICATION_RETENTION_MONTHS,
        },
      });
    }

    return { deleted: result.count };
  });
}


/**
 * **Rejected registrations past twelve months** (Owner, R133 §14).
 *
 * A rejected registration is a `User` with `account_status = 'rejected'`, and
 * nobody ever presses Delete on one — which is why it needs a bounded clock at
 * all, exactly like an application nobody decided.
 *
 * ## The timestamp, and the legacy rows it deliberately skips
 *
 * It measures from `account_status_decided_at`, written by the four operations
 * that decide a status. **`updated_at` is not that instant** — any later edit
 * moves it — so a clock reading it would measure the wrong thing and inferring a
 * rejection date from it would fabricate history.
 *
 * **Rows decided before that column existed carry NULL and are skipped by
 * construction.** That is the legacy exception, and it is silence rather than a
 * guess: there is no trustworthy instant for them, and inventing one to make the
 * sweep tidy would be the exact fabrication this design refuses. They remain for
 * an administrator to delete deliberately, like any other account.
 */
export async function elapsedRejectedRegistrations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ userId: string; rejectedAt: Date; retainUntil: Date }[]> {
  const rows = await prisma.user.findMany({
    where: {
      accountStatus: 'rejected',
      deletedAt: null,
      // NULL is the legacy exception: skipped, never guessed at.
      accountStatusDecidedAt: { not: null },
    },
    select: { id: true, accountStatusDecidedAt: true },
    orderBy: { accountStatusDecidedAt: 'asc' },
  });

  return rows
    .map((row) => {
      const rejectedAt = row.accountStatusDecidedAt!;
      return {
        userId: row.id,
        rejectedAt,
        retainUntil: addMonths(rejectedAt, APPLICATION_RETENTION_MONTHS),
      };
    })
    // Strictly after, like every other clock on this platform.
    .filter((r) => now.getTime() > r.retainUntil.getTime());
}

/**
 * **Deletes every rejected registration past twelve months** (R133 §14).
 *
 * It **soft-deletes through the account's own lifecycle** rather than removing
 * rows itself: the account enters the seven-day Trash and the ordinary purge
 * takes it from there. One deletion path, and a Super Admin who spots a mistake
 * still has a week — which matters more here than anywhere, because nobody
 * chose this deletion and nobody is watching for it.
 *
 * **System-initiated**: no actor is borrowed, so `deleted_by` and the audit row
 * carry `null` (R60.8).
 *
 * Idempotent: a second run finds the same rows already soft-deleted and
 * `softDelete` refuses them as absent, which is counted rather than raised.
 */
export async function purgeElapsedRejectedRegistrations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ deleted: number; skipped: number }> {
  const due = await elapsedRejectedRegistrations(prisma, now);

  let deleted = 0;
  let skipped = 0;
  for (const row of due) {
    try {
      await deleteUserAccountSystem(prisma, row.userId);
      deleted += 1;
    } catch (error) {
      // A live responsibility, the last Super Admin, an account already gone —
      // each is a correct refusal, counted and left alone rather than allowed to
      // abort the sweep. An unexpected error still propagates.
      if (error instanceof AppError) skipped += 1;
      else throw error;
    }
  }
  return { deleted, skipped };
}
