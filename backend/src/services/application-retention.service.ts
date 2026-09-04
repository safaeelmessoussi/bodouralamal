import type { PrismaClient } from '../generated/prisma/client.js';
import * as audit from '../repositories/audit.repository.js';

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
 * **A rejected REGISTRATION is a person, not an application row.** It lives on
 * `User.account_status`, and removing it is account deletion with its own model,
 * window and authority. Folding it in here would apply an application rule to an
 * account — and it is separately blocked, because `User` carries no rejection
 * timestamp to measure from.
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
