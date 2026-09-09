import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * **The versioned Privacy Policy and Terms of Use** (R138 §12/§13).
 *
 * ## The pattern is `LegalConsentText`'s, with one discriminator
 *
 * `LegalConsentText` (§2.3, §4.1a) already solved *versioned, immutable,
 * Super-Admin-managed legal text with exactly one authoritative active row,
 * enforced by the database, nothing ever destroyed*. Building a second,
 * differently-shaped mechanism for a second kind of legal text would be
 * exactly the "elaborate CMS" the Owner's instruction warns against — so this
 * reuses the same five invariants and the same shape, adding only `kind`
 * (`privacy_policy` | `terms_of_use`) as the thing that lets two independent
 * documents each have their own current version at once.
 *
 * 1. **Immutable once used** — `assertEditable`, identical reasoning.
 * 2. **Exactly one active version PER KIND** — a partial unique index in the
 *    database (`legal_document_one_active_per_kind`), not a service-level
 *    check, for the same race-safety reason.
 * 3. **New wording is a new version** — no verb here rewrites the body of
 *    anything but a never-activated draft.
 * 4. **Nothing is destroyed** — superseding is a status change; a version the
 *    public page once showed stays readable forever.
 * 5. **Fail closed** — `activeDocument` throws when no version of a kind is
 *    in force, so the public page cannot silently show nothing at all.
 *
 * ## Authorization
 *
 * Super Admin only, through `assertFreshActive` — deciding what the public
 * Privacy Policy/Terms say is the same footing as deciding what §5.6's other
 * platform-wide settings say.
 */
const LEGAL_DOCUMENT_ROLES = ['super_admin'] as const;

export type LegalDocumentKind = 'privacy_policy' | 'terms_of_use';

export interface LegalDocumentRow {
  id: string;
  kind: LegalDocumentKind;
  version_label: string;
  body_arabic: string;
  status: 'draft' | 'active' | 'superseded';
  created_at: string;
  activated_at: string | null;
  superseded_at: string | null;
  version: number;
}

const SELECT = {
  id: true,
  kind: true,
  versionLabel: true,
  bodyArabic: true,
  status: true,
  createdAt: true,
  activatedAt: true,
  supersededAt: true,
  version: true,
} as const;

type Row = Prisma.LegalDocumentGetPayload<{ select: typeof SELECT }>;

function toRow(row: Row): LegalDocumentRow {
  return {
    id: row.id,
    kind: row.kind,
    version_label: row.versionLabel,
    body_arabic: row.bodyArabic,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    activated_at: row.activatedAt?.toISOString() ?? null,
    superseded_at: row.supersededAt?.toISOString() ?? null,
    version: row.version,
  };
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

/**
 * **The version the public page must show, or a refusal.**
 *
 * Fails closed with `SERVICE_UNAVAILABLE` / `LEGAL_DOCUMENT_NOT_CONFIGURED`,
 * the same shape `activeConsentText` fails with: nobody has put an approved
 * Privacy Policy or Terms of Use in force for this kind, and the public page
 * must say so rather than show nothing or stale wording.
 */
export async function activeDocument(
  tx: Pick<PrismaClient, 'legalDocument'>,
  kind: LegalDocumentKind,
): Promise<{ id: string; versionLabel: string; bodyArabic: string; activatedAt: Date | null }> {
  const row = await tx.legalDocument.findFirst({
    where: { kind, status: 'active' },
    select: { id: true, versionLabel: true, bodyArabic: true, activatedAt: true },
  });
  if (!row) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'no active legal document of this kind — a Super Admin must create and activate one',
      { reason: 'LEGAL_DOCUMENT_NOT_CONFIGURED', kind },
    );
  }
  return row;
}

/** Every version of one kind, newest first. Super Admin only. */
export async function listDocuments(
  prisma: PrismaClient,
  caller: Actor,
  kind: LegalDocumentKind,
): Promise<LegalDocumentRow[]> {
  await assertFreshActive(prisma, caller.userId, LEGAL_DOCUMENT_ROLES, caller.activeRole);
  const rows = await prisma.legalDocument.findMany({
    where: { kind },
    select: SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toRow);
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

export interface CreateDocumentInput {
  kind: LegalDocumentKind;
  versionLabel: string;
  bodyArabic: string;
}

function normalize(input: { versionLabel: string; bodyArabic: string }): {
  versionLabel: string;
  bodyArabic: string;
} {
  const versionLabel = input.versionLabel.trim();
  // The body is trimmed at the ends and NOWHERE else — internal whitespace and
  // paragraph structure are part of the wording somebody approved, the same
  // reasoning `legal-consent-text.service.ts` records for its own body.
  const bodyArabic = input.bodyArabic.replace(/^\s+|\s+$/g, '');
  if (versionLabel === '' || versionLabel.length > 60) {
    throw new AppError('VALIDATION_FAILED', 'version label must be 1–60 characters', {
      issues: [{ path: 'version_label', message: 'must be between 1 and 60 characters' }],
    });
  }
  if (bodyArabic === '') {
    throw new AppError('VALIDATION_FAILED', 'the document body must not be blank', {
      issues: [{ path: 'body_arabic', message: 'must not be blank' }],
    });
  }
  return { versionLabel, bodyArabic };
}

/** Creates a DRAFT of one kind. Creating is never activating. */
export async function createDocument(
  prisma: PrismaClient,
  caller: Actor,
  input: CreateDocumentInput,
): Promise<LegalDocumentRow> {
  const actor = await assertFreshActive(
    prisma,
    caller.userId,
    LEGAL_DOCUMENT_ROLES,
    caller.activeRole,
  );
  const { versionLabel, bodyArabic } = normalize(input);

  return prisma.$transaction(async (tx) => {
    const clash = await tx.legalDocument.findUnique({
      where: { kind_versionLabel: { kind: input.kind, versionLabel } },
      select: { id: true },
    });
    if (clash) {
      throw new AppError('STATE_CONFLICT', 'that version identifier is already used for this kind', {
        reason: 'LEGAL_DOCUMENT_VERSION_LABEL_TAKEN',
      });
    }
    const created = await tx.legalDocument.create({
      data: {
        kind: input.kind,
        versionLabel,
        bodyArabic,
        status: 'draft',
        createdById: actor.userId,
      },
      select: SELECT,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'legaldocument.create',
      targetEntity: 'LegalDocument',
      targetId: created.id,
      // The kind (a structural classification, not an identity/locator) and
      // nothing else — never the body or the label, on `legal-consent-text`'s
      // own reasoning: `assertMinimizedDetail` refuses a copied identity or
      // label, `targetId` is the version and its row is never deleted, so the
      // label is one join away rather than a second copy that cannot drift
      // only because nothing may edit it.
      detail: { kind: input.kind },
    });
    return toRow(created);
  });
}

/**
 * **Edits a DRAFT, and refuses everything else** — identical reasoning to
 * `updateConsentText`: a wording that has ever been in force is evidence of
 * what the public page showed, so correcting it is always a new version.
 */
export async function updateDocument(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  input: { versionLabel: string; bodyArabic: string },
  expectedVersion: number,
): Promise<LegalDocumentRow> {
  const actor = await assertFreshActive(
    prisma,
    caller.userId,
    LEGAL_DOCUMENT_ROLES,
    caller.activeRole,
  );
  const { versionLabel, bodyArabic } = normalize(input);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.legalDocument.findUnique({
      where: { id },
      select: { id: true, kind: true, status: true, version: true, activatedAt: true },
    });
    if (!existing) throw new AppError('NOT_FOUND', 'no such legal document version');
    assertEditable(existing);
    // TD-15 — two Super Admins on one draft; refusing beats overwriting.
    if (existing.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'that version was changed by someone else');
    }
    const clash = await tx.legalDocument.findUnique({
      where: { kind_versionLabel: { kind: existing.kind, versionLabel } },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      throw new AppError('STATE_CONFLICT', 'that version identifier is already used for this kind', {
        reason: 'LEGAL_DOCUMENT_VERSION_LABEL_TAKEN',
      });
    }
    const saved = await tx.legalDocument.update({
      where: { id },
      data: { versionLabel, bodyArabic, version: { increment: 1 } },
      select: SELECT,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'legaldocument.update',
      targetEntity: 'LegalDocument',
      targetId: id,
      detail: { kind: existing.kind },
    });
    return toRow(saved);
  });
}

/** Identical shape to `LegalConsentText`'s own `assertEditable`. */
function assertEditable(row: { status: string; activatedAt: Date | null }): void {
  if (row.status !== 'draft' || row.activatedAt !== null) {
    throw new AppError('STATE_CONFLICT', 'a document that has been in force cannot be edited', {
      reason: 'LEGAL_DOCUMENT_IMMUTABLE',
      status: row.status,
    });
  }
}

/**
 * **Puts a draft into force**, superseding whatever of its OWN kind was
 * active. A Privacy Policy activation never touches the Terms of Use's own
 * active row, and vice versa — `kind` scopes the whole operation.
 *
 * Same transaction ordering as `activateConsentText`, for the same reason:
 * the outgoing version is stamped `superseded` BEFORE the incoming one is
 * stamped `active`, because the partial unique index permits exactly one
 * `active` row per kind and the reverse order would violate it mid-statement.
 */
export async function activateDocument(
  prisma: PrismaClient,
  caller: Actor,
  id: string,
  now: Date = new Date(),
): Promise<LegalDocumentRow> {
  const actor = await assertFreshActive(
    prisma,
    caller.userId,
    LEGAL_DOCUMENT_ROLES,
    caller.activeRole,
  );

  return prisma.$transaction(async (tx) => {
    const target = await tx.legalDocument.findUnique({
      where: { id },
      select: { id: true, kind: true, status: true },
    });
    if (!target) throw new AppError('NOT_FOUND', 'no such legal document version');
    if (target.status === 'active') {
      throw new AppError('STATE_CONFLICT', 'that version is already in force', {
        reason: 'LEGAL_DOCUMENT_ALREADY_ACTIVE',
      });
    }
    // A superseded version is not reactivated — its `activated_at` records
    // when it FIRST came into force (same reasoning as `activateConsentText`).
    // Bringing old wording back is a new version carrying the same text.
    if (target.status === 'superseded') {
      throw new AppError('STATE_CONFLICT', 'a superseded document is not put back into force', {
        reason: 'LEGAL_DOCUMENT_SUPERSEDED',
      });
    }

    const outgoing = await tx.legalDocument.findFirst({
      where: { kind: target.kind, status: 'active' },
      select: { id: true },
    });
    if (outgoing) {
      await tx.legalDocument.update({
        where: { id: outgoing.id },
        data: { status: 'superseded', supersededAt: now, version: { increment: 1 } },
      });
    }
    const saved = await tx.legalDocument.update({
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
      actionType: 'legaldocument.activate',
      targetEntity: 'LegalDocument',
      targetId: id,
      // Ids and the kind, never labels — `targetId` is the version coming
      // into force, and this names the one it replaced for its kind.
      detail: { kind: target.kind, superseded_version_id: outgoing?.id ?? null },
    });
    return toRow(saved);
  });
}
