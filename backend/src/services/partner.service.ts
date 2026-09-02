import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import type { Actor } from '../policies/actor.js';

/**
 * **Partners** (NEW N) — reference data a Super Admin owns, rendered by §5.1.
 *
 * ## Two reads, deliberately
 *
 * `listPublicPartners` is what the landing page calls: **live and visible
 * only**, no authentication, no `version`. `listPartners` is the management
 * read: every live row including the withheld ones, with the TD-15 version its
 * edit form must send back.
 *
 * They are not one function with a flag. The public one must never be able to
 * return a withheld partner because a caller passed something, and a boolean
 * parameter is exactly how that happens.
 *
 * ## Super Admin only
 *
 * OD-01's sub-decision puts *scheduling types · Partners* with **Super Admin
 * only until a later Owner decision**, on the axis rule rather than on
 * visibility. Asserted here, in the service, so it reaches every caller.
 */
const PARTNER_ADMIN_ROLES = ['super_admin'] as const;

export interface PublicPartner {
  id: string;
  name: string;
  /** What the partner is, in the association's words. `null` is ordinary. */
  description: string | null;
}

export interface PartnerRow extends PublicPartner {
  displayOrder: number | null;
  isVisible: boolean;
  version: number;
}

/** BR-19's order: the stated position, then the name. `ar-x-icu` is native
 *  (TD-6a), so correct Arabic ordering needs no per-query COLLATE. */
const PARTNER_ORDER = [{ displayOrder: 'asc' as const }, { name: 'asc' as const }];

/**
 * `GET /partners` — **public**, and the landing page's only source.
 *
 * Unpaginated: the set is small, bounded by the association's real
 * relationships, and a public section showing a subset would be lying about who
 * its partners are — the same reasoning TD-10 gives for the Subject list.
 */
export async function listPublicPartners(prisma: PrismaClient): Promise<PublicPartner[]> {
  const rows = await prisma.partner.findMany({
    where: { deletedAt: null, isVisible: true },
    orderBy: PARTNER_ORDER,
    select: { id: true, name: true, description: true },
  });
  return rows;
}

/** `GET /admin/partners` — every live partner, withheld ones included. */
export async function listPartners(prisma: PrismaClient, actor: Actor): Promise<PartnerRow[]> {
  await assertFreshActive(prisma, actor.userId, PARTNER_ADMIN_ROLES, actor.activeRole);
  return prisma.partner.findMany({
    where: { deletedAt: null },
    orderBy: PARTNER_ORDER,
    select: { id: true, name: true, description: true, displayOrder: true, isVisible: true, version: true },
  });
}

export interface PartnerInput {
  name: string;
  description?: string | null;
  displayOrder?: number | null;
  isVisible?: boolean;
}

export async function createPartner(
  prisma: PrismaClient,
  actor: Actor,
  input: PartnerInput,
): Promise<PartnerRow> {
  await assertFreshActive(prisma, actor.userId, PARTNER_ADMIN_ROLES, actor.activeRole);

  return prisma.$transaction(async (tx) => {
    const partner = await tx.partner.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        displayOrder: input.displayOrder ?? null,
        ...(input.isVisible === undefined ? {} : { isVisible: input.isVisible }),
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'partner.create',
      targetEntity: 'Partner',
      targetId: partner.id,
      detail: {},
    });
    return {
      id: partner.id,
      name: partner.name,
      description: partner.description,
      displayOrder: partner.displayOrder,
      isVisible: partner.isVisible,
      version: partner.version,
    };
  });
}

export async function updatePartner(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: { name?: string; description?: string | null; displayOrder?: number | null; isVisible?: boolean },
): Promise<PartnerRow> {
  await assertFreshActive(prisma, actor.userId, PARTNER_ADMIN_ROLES, actor.activeRole);

  const partner = await updateWithVersion<{
    id: string;
    name: string;
    description: string | null;
    displayOrder: number | null;
    isVisible: boolean;
    version: number;
  }>({
    delegate: prisma.partner,
    id,
    expectedVersion,
    requireNotDeleted: true,
    data: { ...data },
  });

  await audit.write(prisma, {
    actorUserId: actor.userId,
    ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
    actionType: 'partner.update',
    targetEntity: 'Partner',
    targetId: id,
    // Which fields changed, never their values (§14, no PII in logs) — the same
    // rule the user edit follows, applied for consistency rather than because a
    // partner's name is personal.
    detail: { fields: Object.keys(data) },
  });

  return {
    id: partner.id,
    name: partner.name,
    description: partner.description,
    displayOrder: partner.displayOrder,
    isVisible: partner.isVisible,
    version: partner.version,
  };
}

/**
 * TD-5 soft delete.
 *
 * **Nothing references a Partner**, so there is no blocked-delete case to
 * report: it is a leaf. That is stated rather than left to be rediscovered —
 * the absence of an `assertNoBlockingReferences` call here is deliberate, not an
 * omission.
 */
export async function deletePartner(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<void> {
  await assertFreshActive(prisma, actor.userId, PARTNER_ADMIN_ROLES, actor.activeRole);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.partner.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('NOT_FOUND', 'no such partner');

    const now = new Date();
    await tx.partner.update({
      where: { id },
      data: { deletedAt: now, deletedById: actor.userId },
    });
    await trash.snapshot(
      tx,
      {
        targetEntity: 'Partner',
        targetId: id,
        snapshot: JSON.parse(JSON.stringify(existing)) as object,
        deletedById: actor.userId,
      },
      now,
    );
    await audit.write(tx, {
      actorUserId: actor.userId,
      ...(actor.activeRole ? { activeRole: actor.activeRole } : {}),
      actionType: 'partner.delete',
      targetEntity: 'Partner',
      targetId: id,
      detail: {},
    });
  });
}
