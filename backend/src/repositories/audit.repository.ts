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

/**
 * TD-8 retention: 12 months for authentication-lifecycle rows.
 */
export const AUTH_AUDIT_RETENTION_DAYS = 365;

/**
 * The `audit.purge` allowlist (TD-7, Revision 19) — the ONLY action types that
 * may ever be deleted from the audit log.
 *
 * Deliberately a standalone **enumerated** list rather than `AUDIT_ACTIONS`
 * or an `auth.` prefix test:
 *
 *   * A prefix/glob would silently sweep in any future action beginning with
 *     `auth.` — post-MVP local authentication adds several (§10.1) — without
 *     anyone deciding it was purgeable.
 *   * Deriving it from `AUDIT_ACTIONS` would couple "an auth action exists" to
 *     "it is deletable", so adding a *retained* auth event there would quietly
 *     make it purgeable.
 *
 * Everything absent from this list is retained indefinitely, including the
 * security events `consent_gate.override`, `grade.passfail_override`,
 * `settings.change` and `trash.manual_restore`. Extending this list requires an
 * SRS revision, not a code change.
 */
export const PURGEABLE_ACTION_TYPES: readonly string[] = [
  'auth.login',
  'auth.login_denied',
  'auth.identity_bound',
  'auth.refresh',
  'auth.logout',
  'auth.token_revoked',
];

/**
 * TD-7 `audit.purge`. Selects on **BOTH** the enumerated allowlist AND the age
 * horizon — never age alone (which would delete the entire log) and never a
 * prefix match. Returns the number of rows collected.
 */
export async function purgeExpiredAuthRows(
  db: Db,
  now: Date = new Date(),
  retentionDays: number = AUTH_AUDIT_RETENTION_DAYS,
): Promise<number> {
  const horizon = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db.auditLog.deleteMany({
    where: {
      // Both conditions are required. Dropping either one is a data-loss bug:
      // without the allowlist the job deletes indefinitely-retained security
      // events; without the horizon it deletes this morning's logins.
      actionType: { in: [...PURGEABLE_ACTION_TYPES] },
      createdAt: { lt: horizon },
    },
  });
  return result.count;
}

export interface AuditEntry {
  /**
   * Null means **system-initiated**, not "attribution lost" (§7, Revision 17):
   * replay detection runs on an unauthenticated request, and the consent
   * re-evaluation job has no operator. The action type and detail carry the why.
   */
  actorUserId: string | null;
  /**
   * **R60.8 — the capacity the actor was working in**, alongside and never
   * instead of `actorUserId`.
   *
   * The account stays the accountable identity. This answers a different
   * question: *"the Super Admin deleted it"* and *"the Super Admin, working as
   * مؤطِّرة, deleted it"* describe different events, and a trail that records
   * only the first cannot tell them apart.
   *
   * `undefined` for an un-narrowed session and for the system-initiated writes
   * where `actorUserId` is null too — there is genuinely no capacity to record.
   * Stored inside `detail`, which every row already has, so no schema change.
   */
  activeRole?: string | undefined;
  actionType: string;
  targetEntity?: string;
  targetId?: string;
  /** Never PII beyond what TD-8 requires; never a raw token (TD-14). */
  detail: Prisma.InputJsonValue;
}

/**
 * Detail-property names which signal that a governed entity's display or
 * identity value was copied into the audit log.
 *
 * This is deliberately NOT a free-text sanitizer. TD-8 currently mandates
 * reasons/justifications and old/new consent-setting values; deciding their
 * retention/access treatment is an Owner policy question. Rejecting them here
 * would silently change legal/safeguarding evidence. This guard covers the
 * independently determined class: redundant names, contacts, titles,
 * filenames and exact storage locators for which the target id or a
 * non-reversible coordinate id is the authoritative audit representation.
 */
function copiedIdentityOrLocatorKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
  if (
    /(^|_)(name|email|phone|telephone|mobile|address|contact|mailbox|username|title|label|filename)(_|$)/.test(
      normalized,
    )
  ) {
    return true;
  }
  return /^(storage|staging|canonical|previous|new|old|source|destination|retired|object)(?:_(?:storage|object))?_key$/.test(
    normalized,
  );
}

function assertMinimizedDetail(value: Prisma.InputJsonValue, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMinimizedDetail(item, [...path, String(index)]));
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  for (const [key, nested] of Object.entries(value)) {
    const at = [...path, key];
    if (copiedIdentityOrLocatorKey(key)) {
      throw new Error(
        `audit detail ${at.join('.')} must use an entity/coordinate id, not a copied identity, label or locator`,
      );
    }
    assertMinimizedDetail(nested as Prisma.InputJsonValue, at);
  }
}

export async function write(db: Db, entry: AuditEntry): Promise<void> {
  assertMinimizedDetail(entry.detail);
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      actionType: entry.actionType,
      targetEntity: entry.targetEntity ?? null,
      targetId: entry.targetId ?? null,
      // Merged into `detail` rather than added as a column: one short string on
      // an existing JSONB field, and no migration for a field that is absent on
      // system-initiated rows anyway.
      detail:
        entry.activeRole === undefined
          ? entry.detail
          : { ...(entry.detail as object), active_role: entry.activeRole },
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
