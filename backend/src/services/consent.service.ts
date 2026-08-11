import { ConsentMethod, ConsentType } from '../generated/prisma/enums.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { assertCanAccessStudent } from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';
import { enqueueConsentReevaluationForStudent } from './enrollment.service.js';
import { activeConsentTextVersion } from './registration.service.js';

/**
 * Staff-recorded consent (SRS §4.1a, BR-1, TD-2, TD-8, TD-12).
 *
 * The second of the two §4.1a capture methods. `online_form` is what a parent
 * ticks during registration; `staff_recorded` is what staff enter when a
 * decision is **declared in person** — the association's beneficiaries include
 * families who cannot complete a web form themselves (§2.2 digital-literacy
 * constraint), so this is a first-class path, not a fallback.
 *
 * Four properties are load-bearing:
 *
 *   - **TD-2 restricts it to Admin and Super Admin.** A Teacher may *view* a
 *     student's data but may not declare a consent decision on a family's
 *     behalf; the matrix marks the row `⊘` for them.
 *   - **TD-12 lists staff-assisted consent recording as high-risk**, so the
 *     caller is re-read from the database per request.
 *   - **History is preserved.** §7 makes `ConsentRecord` append/state-change
 *     only, and BR-1 derives effective status from the **most recent** record —
 *     so a revocation is a new row, never an update that erases what was agreed.
 *   - **Every change enqueues a re-evaluation** (§4.1a, TD-7) inside the same
 *     transaction, so the group consent gate can never drift from the records.
 */

/** TD-2: "Record staff-declared consent grants/revocations" — Admin and above. */
const CONSENT_ROLES = ['admin', 'super_admin'] as const;

export interface ConsentDecision {
  consentType: 'media_release' | 'data_processing';
  granted: boolean;
  /** Why the decision was declared in person; stored on the audit row (TD-8). */
  note?: string;
}

export interface ConsentStateEntry {
  consentType: string;
  granted: boolean;
  method: string;
  consentTextVersion: string;
  grantedAt: Date;
  grantedByUserId: string;
}

/**
 * BR-1: effective status is the **most recent** record per consent type, and
 * **absence of a record is no consent** — never a default of "granted".
 */
export async function effectiveConsent(
  prisma: PrismaClient,
  studentId: string,
): Promise<Record<string, ConsentStateEntry | null>> {
  const rows = await prisma.consentRecord.findMany({
    where: { studentId },
    orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
  });

  const latest: Record<string, ConsentStateEntry | null> = {
    media_release: null,
    data_processing: null,
  };
  for (const row of rows) {
    // The list is newest-first, so the first row seen for a type is the current
    // one; later rows are history and must not overwrite it.
    if (latest[row.consentType] === null) {
      latest[row.consentType] = {
        consentType: row.consentType,
        granted: row.granted,
        method: row.method,
        consentTextVersion: row.consentTextVersion,
        grantedAt: row.grantedAt,
        grantedByUserId: row.grantedByUserId,
      };
    }
  }
  return latest;
}

/** Reading a student's consent state — same audience as recording it. */
export async function readConsent(
  prisma: PrismaClient,
  /**
   * R60 — the full caller, not a bare id. The **active role** has to reach
   * `assertFreshActive` (which rebuilds from live rows and would otherwise hand
   * back this account's full authority) and the audit row (§60.8). Threading the
   * `Actor` rather than a second `activeRole` parameter keeps the two from
   * drifting apart, which is why the id alone is no longer enough.
   */
  caller: Actor,
  studentId: string,
): Promise<Record<string, ConsentStateEntry | null>> {
  const actor = await assertFreshActive(prisma, caller.userId, CONSENT_ROLES, caller.activeRole);
  await assertCanAccessStudent(prisma, actor, studentId);
  return effectiveConsent(prisma, studentId);
}

/**
 * Records a consent decision declared in person (§4.1a `staff_recorded`).
 *
 * Returns the affected group ids so the caller can see what was enqueued —
 * useful in tests and in the eventual admin UI, and it makes the §4.1a coupling
 * visible rather than implicit.
 */
export async function recordStaffConsent(
  prisma: PrismaClient,
  caller: Actor,
  studentId: string,
  decision: ConsentDecision,
): Promise<{ recordId: string; reevaluatedSessions: string[] }> {
  const actor = await assertFreshActive(prisma, caller.userId, CONSENT_ROLES, caller.activeRole);
  await assertCanAccessStudent(prisma, actor, studentId);

  // §2.3/§4.1a: the versioned text is what the family agreed to. Without a
  // configured version there is nothing to record agreement *against*, so this
  // fails closed exactly as registration does. The SAME helper is used, so the
  // two capture paths can never disagree about which wording is active.
  const textVersion = await activeConsentTextVersion(prisma);

  return prisma.$transaction(async (tx) => {
    const student = await tx.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppError('NOT_FOUND', 'no such student in scope');

    // A new row, never an update: §7 keeps this append/state-change only so the
    // history of what a family agreed to, and when, survives a later change.
    const record = await tx.consentRecord.create({
      data: {
        studentId,
        consentType: decision.consentType as ConsentType,
        granted: decision.granted,
        method: ConsentMethod.staff_recorded,
        consentTextVersion: textVersion,
        grantedByUserId: actor.userId,
        ...(decision.granted ? {} : { revokedAt: new Date(), revokedByUserId: actor.userId }),
      },
      select: { id: true },
    });

    // §4.1a hard requirement: any ConsentRecord change re-evaluates the gate —
    // in THIS transaction (TD-4), so the job cannot outlive a rolled-back
    // decision or be lost by a committed one.
    //
    // Revision 43: the gate's subject is a SESSION's resolved audience (BR-2),
    // not a group, so the payload is `{ session_id }`. With no schedules yet
    // this enqueues nothing, exactly as a student in no group did before — a
    // normal outcome, not a silent failure.
    const reevaluatedSessions = await enqueueConsentReevaluationForStudent(tx, studentId);

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: decision.granted ? 'consent.grant' : 'consent.revoke',
      targetEntity: 'ConsentRecord',
      targetId: record.id,
      // TD-8: consent_type, method, text version, and the on-behalf actor —
      // which for a staff-recorded decision is the whole point of the row.
      detail: {
        student_id: studentId,
        consent_type: decision.consentType,
        method: ConsentMethod.staff_recorded,
        consent_text_version: textVersion,
        on_behalf_actor: actor.userId,
        sessions_reevaluated: reevaluatedSessions.length,
        ...(decision.note ? { note: decision.note } : {}),
      },
    });

    return { recordId: record.id, reevaluatedSessions };
  });
}
