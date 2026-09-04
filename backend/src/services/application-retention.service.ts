import type { PrismaClient } from '../generated/prisma/client.js';

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
 * **It computes and explains. It deletes nothing and schedules nothing** — the
 * same phase-1 position as the ten-year educational computation, and for the
 * same reason: §4.10a's cross-domain classifications are not all settled, and a
 * partial purge that claims completion is worse than none.
 *
 * **It covers REJECTED child applications only**, and that boundary is
 * deliberate:
 *
 * * **Rejected is precise.** `decided_at` is the rejection instant, so
 *   *"twelve months after rejection"* has exactly one reading.
 * * **Pending is not.** §4.10a says a never-converted pending application
 *   follows *"the same twelve-month maximum **from its own reference point**"*,
 *   and does not say what that point is. `created_at` and `consent_given_at` are
 *   both defensible and give different answers; choosing between them is a
 *   product decision, so this module does not.
 * * **A rejected REGISTRATION is a person, not an application row.** It lives on
 *   `User.account_status`, and removing it is account deletion with its own
 *   model, window and authority. Folding it in here would apply an application
 *   rule to an account.
 */

/** §4.10a's maximum. Not a legal citation — the association's own policy. */
export const APPLICATION_RETENTION_MONTHS = 12;

export interface ApplicationRetentionReport {
  applicationId: string;
  /** The rejection instant — the only reference point §4.10a makes precise. */
  rejectedAt: Date;
  retainUntil: Date;
  elapsed: boolean;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Reports every rejected child application whose twelve months have elapsed.
 *
 * **A dry run.** Nothing is deleted, and the rows it names still carry the
 * child's copied identity fields — which is exactly why execution waits: those
 * fields are one of the classifications §4.10a leaves open.
 */
export async function elapsedRejectedApplications(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<ApplicationRetentionReport[]> {
  const rows = await prisma.childApplication.findMany({
    where: { status: 'rejected', decidedAt: { not: null } },
    select: { id: true, decidedAt: true },
    orderBy: { decidedAt: 'asc' },
  });

  return rows
    .map((row) => {
      const rejectedAt = row.decidedAt!;
      const retainUntil = addMonths(rejectedAt, APPLICATION_RETENTION_MONTHS);
      return {
        applicationId: row.id,
        rejectedAt,
        retainUntil,
        // Strictly after: on the boundary day itself the period has not elapsed.
        elapsed: now.getTime() > retainUntil.getTime(),
      };
    })
    .filter((report) => report.elapsed);
}
