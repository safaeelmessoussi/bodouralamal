import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import { loadWritableContent } from './content.service.js';

/**
 * **R258 — the order of a Subject's items, set by the administration** (the
 * Owner, 2026-10-30: «i want to be able to set the order of the audios of each
 * subject», with «دورة الغزوات» as the example — an order no title sorts into).
 *
 * `ids` are one Subject's items in the order wanted; each takes its place
 * (`display_order` 1…n). Every item must be one the caller may edit — the
 * same rule as editing it (`loadWritableContent`: staff, within their branch
 * scope; out of scope is 404) — and all must share one Subject, because the
 * order is that Subject's. Items of the Subject left out keep theirs; an item
 * with none follows the ordered ones, in title order, wherever it is listed.
 */
export async function setContentOrder(
  prisma: PrismaClient,
  actor: Actor,
  ids: readonly string[],
): Promise<{ id: string; display_order: number }[]> {
  if (new Set(ids).size !== ids.length) {
    throw new AppError('VALIDATION_FAILED', 'an item is listed twice', { reason: 'DUPLICATE_ITEM' });
  }
  for (const id of ids) await loadWritableContent(prisma, actor, id);
  const rows = await prisma.educationalContent.findMany({
    where: { id: { in: [...ids] }, deletedAt: null },
    select: { id: true, subjectId: true },
  });
  const subjects = new Set(rows.map((row) => row.subjectId));
  if (subjects.size > 1) {
    throw new AppError('VALIDATION_FAILED', 'the items belong to different Subjects', { reason: 'MIXED_SUBJECTS' });
  }
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.educationalContent.update({ where: { id }, data: { displayOrder: index + 1 } });
    }
    await audit.write(tx as unknown as Prisma.TransactionClient, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'content.reorder',
      // The Subject whose order this is; an item of no Subject («عام») names the first item.
      ...(([...subjects][0] ?? null) !== null
        ? { targetEntity: 'Subject', targetId: [...subjects][0]! }
        : { targetEntity: 'EducationalContent', targetId: ids[0]! }),
      detail: { items: ids.length },
    });
  });
  return ids.map((id, index) => ({ id, display_order: index + 1 }));
}
