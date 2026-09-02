import { createHash } from 'node:crypto';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * **The versioned legal consent wording** (§2.3, §4.1a; Owner decision,
 * 2026-09-02).
 *
 * ## What this replaces, and why a string was not enough
 *
 * The Arabic wording lived in `frontend/src/i18n/ar.ts` and the version lived
 * in the `legal.consent_text_version` `SystemSetting`. A `ConsentRecord` stored
 * **only the version string**, so the relationship between *what a person read*
 * and *what the platform recorded* was human discipline: edit the i18n text
 * without bumping the setting and every record since silently misstates what
 * was agreed to; bump the setting without editing the text and the records
 * claim a version that never existed. Both drifts pass every test.
 *
 * A platform that cannot answer *«what exactly did this person agree to»* from
 * its own data is not holding consent evidence. This makes the answer a foreign
 * key.
 *
 * ## The five invariants, and where each is enforced
 *
 * 1. **Immutable once used** — `assertEditable` here, because "used" is a
 *    question about other tables that a CHECK cannot ask.
 * 2. **Exactly one active version** — a partial unique index in the database
 *    (`legal_consent_text_one_active`). A service-level check alone is a race,
 *    and this is the one invariant whose violation means somebody could be
 *    recorded as agreeing to wording nobody put in force.
 * 3. **New wording is a new version** — a consequence of (1): there is no verb
 *    here that rewrites the body of anything but a never-activated draft.
 * 4. **Nothing is destroyed** — there is no delete. Superseding is a status
 *    change, and old rows keep their exact wording forever.
 * 5. **Fail closed** — `activeConsentText` throws rather than returning
 *    anything when no version is in force, so registration cannot proceed by
 *    accident.
 *
 * ## Authorization
 *
 * Super Admin only, through `assertFreshActive` like every other §5.6 setting:
 * this decides what people are held to have agreed to, and R60's freshness
 * check is the difference between *had the role when the token was minted* and
 * *has it now*.
 */
const CONSENT_TEXT_ROLES = ['super_admin'] as const;

/**
 * **Defense in depth, and deliberately not the evidence.**
 *
 * The digest detects a wording altered underneath a record. It cannot say what
 * the wording was, so it never substitutes for retaining the text — a hash of a
 * legal notice proves tampering and answers no question a person actually has.
 */
export function digestOf(bodyArabic: string): string {
  return createHash('sha256').update(bodyArabic, 'utf8').digest('hex');
}

export interface LegalConsentTextRow {
  id: string;
  version_label: string;
  body_arabic: string;
  body_digest: string;
  status: 'draft' | 'active' | 'superseded';
  created_at: string;
  activated_at: string | null;
  superseded_at: string | null;
  /** How many recorded consents name this wording — why it cannot be edited. */
  consent_record_count: number;
  version: number;
}

const SELECT = {
  id: true,
  versionLabel: true,
  bodyArabic: true,
  bodyDigest: true,
  status: true,
  createdAt: true,
  activatedAt: true,
  supersededAt: true,
  version: true,
  _count: { select: { consentRecords: true, childApplications: true } },
} as const;

type Row = Prisma.LegalConsentTextGetPayload<{ select: typeof SELECT }>;

function toRow(row: Row): LegalConsentTextRow {
  return {
    id: row.id,
    version_label: row.versionLabel,
    body_arabic: row.bodyArabic,
    body_digest: row.bodyDigest,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    activated_at: row.activatedAt?.toISOString() ?? null,
    superseded_at: row.supersededAt?.toISOString() ?? null,
    consent_record_count: row._count.consentRecords + row._count.childApplications,
    version: row.version,
  };
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

/**
 * **The version new registrations are recorded against, or a refusal.**
 *
 * Fails closed with the same `SERVICE_UNAVAILABLE` /
 * `CONSENT_TEXT_VERSION_NOT_CONFIGURED` the `SystemSetting` era used, because
 * the operator-facing meaning has not changed: *nobody has put an approved
 * wording in force, and no consent may be recorded until somebody does*. The
 * remedy named in the message has changed, and so the message names the new
 * one.
 *
 * **This is the ONLY way the platform decides what is active.** Registration,
 * staff-recorded consent and the public read all go through it, so they cannot
 * disagree about which wording is in force.
 */
export async function activeConsentText(
  tx: Pick<PrismaClient, 'legalConsentText'>,
): Promise<{ id: string; versionLabel: string; bodyArabic: string; bodyDigest: string }> {
  const row = await tx.legalConsentText.findFirst({
    where: { status: 'active' },
    select: { id: true, versionLabel: true, bodyArabic: true, bodyDigest: true },
  });
  if (!row) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'no active legal consent text — a Super Admin must create and activate one (SRS §2.3)',
      { reason: 'CONSENT_TEXT_VERSION_NOT_CONFIGURED' },
    );
  }
  return row;
}

/** Every version, newest first. Super Admin only; historical ones read-only. */
export async function listConsentTexts(
  prisma: PrismaClient,
  caller: Actor,
): Promise<LegalConsentTextRow[]> {
  await assertFreshActive(prisma, caller.userId, CONSENT_TEXT_ROLES, caller.activeRole);
  const rows = await prisma.legalConsentText.findMany({
    select: SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toRow);
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

export interface CreateConsentTextInput {
  versionLabel: string;
  bodyArabic: string;
}

function normalize(input: CreateConsentTextInput): { versionLabel: string; bodyArabic: string } {
  const versionLabel = input.versionLabel.trim();
  /**
   * **The body is trimmed at the ends and NOWHERE else.**
   *
   * Internal whitespace, line breaks and paragraph structure are part of the
   * wording somebody approved; normalising them would change the text and the
   * digest while looking like tidying.
   */
  const bodyArabic = input.bodyArabic.replace(/^\s+|\s+$/g, '');
  if (versionLabel === '' || versionLabel.length > 60) {
    throw new AppError('VALIDATION_FAILED', 'version label must be 1–60 characters', {
      issues: [{ path: 'version_label', message: 'must be between 1 and 60 characters' }],
    });
  }
  if (bodyArabic === '') {
    throw new AppError('VALIDATION_FAILED', 'the wording must not be blank', {
      issues: [{ path: 'body_arabic', message: 'must not be blank' }],
    });
  }
  return { versionLabel, bodyArabic };
}

/** Creates a DRAFT. Creating is never activating — that is a second decision. */
export async function createConsentText(
  prisma: PrismaClient,
  caller: Actor,
  input: CreateConsentTextInput,
): Promise<LegalConsentTextRow> {
  const actor = await assertFreshActive(
    prisma,
    caller.userId,
    CONSENT_TEXT_ROLES,
    caller.activeRole,
  );
  const { versionLabel, bodyArabic } = normalize(input);

  return prisma.$transaction(async (tx) => {
    const clash = await tx.legalConsentText.findUnique({
      where: { versionLabel },
      select: { id: true },
    });
    // A coded refusal, not a raw unique-violation: the label is the thing a
    // person typed, so the screen must be able to say which field is wrong.
    if (clash) {
      throw new AppError('STATE_CONFLICT', 'that version identifier is already used', {
        reason: 'CONSENT_TEXT_VERSION_LABEL_TAKEN',
      });
    }
    const created = await tx.legalConsentText.create({
      data: {
        versionLabel,
        bodyArabic,
        bodyDigest: digestOf(bodyArabic),
        status: 'draft',
        createdById: actor.userId,
      },
      select: SELECT,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'legalconsenttext.create',
      targetEntity: 'LegalConsentText',
      targetId: created.id,
      /**
       * **The digest, and NEITHER the body nor the label.**
       *
       * The body: TD-8 rows are purged on their own schedule, so putting a
       * whole legal notice in one would duplicate the evidence into a table
       * whose retention is not the evidence's.
       *
       * The label: `assertMinimizedDetail` refuses a copied identity or label,
       * and it is right to — `targetId` is the version, the version's row is
       * never deleted, and the label is one join away. A copy here would be a
       * second answer that could not drift only because nothing may edit it.
       */
      detail: { body_digest: digestOf(bodyArabic) },
    });
    return toRow(created);
  });
}

/**
 * **Edits a DRAFT, and refuses everything else.**
 *
 * A wording that has ever been in force is evidence about what people were
 * shown. Correcting a typo in it would silently change what every record
 * against it claims — so the answer is a new version, always, and this says so
 * with a coded reason rather than a generic refusal.
 */
export async function updateConsentText(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  input: CreateConsentTextInput,
  expectedVersion: number,
): Promise<LegalConsentTextRow> {
  const actor = await assertFreshActive(
    prisma,
    caller.userId,
    CONSENT_TEXT_ROLES,
    caller.activeRole,
  );
  const { versionLabel, bodyArabic } = normalize(input);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.legalConsentText.findUnique({
      where: { id },
      select: { id: true, status: true, version: true, activatedAt: true },
    });
    if (!existing) throw new AppError('NOT_FOUND', 'no such consent text version');
    assertEditable(existing);
    // TD-15 — two administrators on one draft; refusing beats overwriting.
    if (existing.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'that version was changed by someone else');
    }
    const clash = await tx.legalConsentText.findUnique({
      where: { versionLabel },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      throw new AppError('STATE_CONFLICT', 'that version identifier is already used', {
        reason: 'CONSENT_TEXT_VERSION_LABEL_TAKEN',
      });
    }
    const saved = await tx.legalConsentText.update({
      where: { id },
      data: {
        versionLabel,
        bodyArabic,
        bodyDigest: digestOf(bodyArabic),
        version: { increment: 1 },
      },
      select: SELECT,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'legalconsenttext.update',
      targetEntity: 'LegalConsentText',
      targetId: id,
      detail: { body_digest: digestOf(bodyArabic) },
    });
    return toRow(saved);
  });
}

/**
 * **Immutability, stated once.**
 *
 * `activatedAt` rather than "is currently active": a superseded version was in
 * force, people were shown it, and it is exactly as frozen as the live one.
 */
function assertEditable(row: { status: string; activatedAt: Date | null }): void {
  if (row.status !== 'draft' || row.activatedAt !== null) {
    throw new AppError('STATE_CONFLICT', 'a wording that has been in force cannot be edited', {
      reason: 'CONSENT_TEXT_IMMUTABLE',
      status: row.status,
    });
  }
}

/**
 * **Puts a draft into force**, superseding whatever was.
 *
 * One transaction, and the ordering matters: the outgoing version is stamped
 * `superseded` **before** the incoming one is stamped `active`, because the
 * partial unique index permits exactly one `active` row and the reverse order
 * would violate it mid-statement.
 *
 * Two administrators activating two different drafts at once: one transaction
 * commits, the other fails on the index. Neither can leave the platform with
 * two authoritative wordings, and no application-level check is trusted for it.
 */
export async function activateConsentText(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  now: Date = new Date(),
): Promise<LegalConsentTextRow> {
  const actor = await assertFreshActive(
    prisma,
    caller.userId,
    CONSENT_TEXT_ROLES,
    caller.activeRole,
  );

  return prisma.$transaction(async (tx) => {
    const target = await tx.legalConsentText.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!target) throw new AppError('NOT_FOUND', 'no such consent text version');
    if (target.status === 'active') {
      throw new AppError('STATE_CONFLICT', 'that version is already in force', {
        reason: 'CONSENT_TEXT_ALREADY_ACTIVE',
      });
    }
    /**
     * **A superseded version is not reactivated.** Its `activated_at` records
     * when it FIRST came into force, and overwriting that would erase the one
     * fact an audit needs from it. Bringing old wording back is a new version
     * carrying the same text — which is honest, and cheap.
     */
    if (target.status === 'superseded') {
      throw new AppError('STATE_CONFLICT', 'a superseded wording is not put back into force', {
        reason: 'CONSENT_TEXT_SUPERSEDED',
      });
    }

    const outgoing = await tx.legalConsentText.findFirst({
      where: { status: 'active' },
      select: { id: true },
    });
    if (outgoing) {
      await tx.legalConsentText.update({
        where: { id: outgoing.id },
        data: { status: 'superseded', supersededAt: now, version: { increment: 1 } },
      });
    }
    const saved = await tx.legalConsentText.update({
      where: { id },
      data: {
        status: 'active',
        activatedAt: now,
        activatedById: actor.userId,
        version: { increment: 1 },
      },
      select: SELECT,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'legalconsenttext.activate',
      targetEntity: 'LegalConsentText',
      targetId: id,
      /* Ids, not labels (`assertMinimizedDetail`): `targetId` is the version
         coming into force, and this names the one it replaced. Both rows are
         permanent, so *what was in force between these two instants* is a join
         away — and there is no copied label to drift from them. */
      detail: { superseded_version_id: outgoing?.id ?? null },
    });
    return toRow(saved);
  });
}

/**
 * **Resolves the version a submission says it was shown** (§4.1a).
 *
 * The whole point of the parameter: a form renders wording X and, while the
 * person is reading it, a Super Admin activates Y. Recording *Y* would state
 * that this person agreed to words they never saw. So the server checks that
 * what was presented is still what is in force, and **refuses** otherwise —
 * the client re-fetches and presents the new wording for a fresh decision.
 *
 * Refusing rather than accepting the stale version is deliberate: a version
 * taken out of force may have been withdrawn *because* it was wrong, and
 * recording new agreement against it would be recording agreement to a wording
 * the association has repudiated.
 */
export async function resolvePresentedConsentText(
  tx: Pick<PrismaClient, 'legalConsentText'>,
  presentedId: string | undefined,
): Promise<{ id: string; versionLabel: string }> {
  const active = await activeConsentText(tx);
  if (presentedId === undefined) {
    throw new AppError('VALIDATION_FAILED', 'the consent text version presented must be sent', {
      issues: [{ path: 'consent_text_id', message: 'required' }],
    });
  }
  if (presentedId !== active.id) {
    throw new AppError('STATE_CONFLICT', 'the legal wording changed while the form was open', {
      reason: 'CONSENT_TEXT_SUPERSEDED',
    });
  }
  return { id: active.id, versionLabel: active.versionLabel };
}
