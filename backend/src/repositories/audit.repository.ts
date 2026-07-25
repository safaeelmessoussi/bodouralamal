import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * AuditLog writes (SRS TD-8, §7 attribution invariant).
 *
 * The log is **append-only**: no update or delete path exists in the
 * application, which is why this repository exposes only a write and reads for
 * reconstruction. Rows must be written **inside the transaction of the action
 * they describe** (TD-4) — a committed mutation with a lost audit row breaks the
 * §7 attribution invariant, under which who/when/why must be reconstructable
 * from the AuditLog alone.
 */

/** Either the base client or a transaction client — audit writes must be able
 *  to join the caller's transaction (§16.2, TD-4). */
export type Db = PrismaClient | Prisma.TransactionClient;

/** TD-8 action types used by the authentication lifecycle. */
export const AUDIT_ACTIONS = {
  login: 'auth.login',
  loginDenied: 'auth.login_denied',
  identityBound: 'auth.identity_bound',
  refresh: 'auth.refresh',
  logout: 'auth.logout',
  tokenRevoked: 'auth.token_revoked',
} as const;

export interface AuditEntry {
  /**
   * Null means **system-initiated**, not "attribution lost" (§7, Revision 17):
   * replay detection runs on an unauthenticated request, and the consent
   * re-evaluation job has no operator. The action type and detail carry the why.
   */
  actorUserId: string | null;
  actionType: string;
  targetEntity?: string;
  targetId?: string;
  /** Never PII beyond what TD-8 requires; never a raw token (TD-14). */
  detail: Prisma.InputJsonValue;
}

export async function write(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      actionType: entry.actionType,
      targetEntity: entry.targetEntity ?? null,
      targetId: entry.targetId ?? null,
      detail: entry.detail,
    },
  });
}

/**
 * Reconstruction query behind the §7 attribution invariant: every audit row
 * touching a session, newest first. Answers "who revoked this session, when,
 * and why" without reading the `RefreshToken` row, which may have been purged.
 */
export async function findBySessionId(db: Db, sessionId: string) {
  return db.auditLog.findMany({
    where: {
      actionType: { in: [AUDIT_ACTIONS.refresh, AUDIT_ACTIONS.logout, AUDIT_ACTIONS.tokenRevoked] },
      detail: { path: ['session_ids'], array_contains: [sessionId] },
    },
    orderBy: { createdAt: 'desc' },
  });
}
