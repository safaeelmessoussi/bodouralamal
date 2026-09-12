import type { PrismaClient } from '../generated/prisma/client.js';
import { deleteObject, statObjectStrict, type StorageClients } from '../lib/storage.js';
import { lockEducationalContent } from '../repositories/consent-safeguarding.repository.js';
import * as retirements from '../repositories/storage-retirement.repository.js';
import { migrateConsentForcedContent, retireConsentPublicObject } from './consent-reevaluation.service.js';
import { quarantineRetiredContentObject, retirePurgedContentObjects } from './storage-lifecycle.service.js';

/** Only the original caller may supply its positive settlement evidence: its
 * callback finished without dispatching COPY, or that COPY returned success. */
export async function acknowledgePlacementCopy(prisma: PrismaClient, id: string): Promise<void> {
  const record = await retirements.findRetirement(prisma, id);
  if (!record || record.completedAt !== null) return;
  await prisma.$transaction(async (tx) => {
    await lockEducationalContent(tx, [record.contentId]);
    await retirements.lockRetirement(tx, id);
    await retirements.settlePlacementCopy(tx, id);
  });
}

/** Execution history may expire; the domain obligation may not disappear. */
export async function executeRetirement(prisma: PrismaClient, storage: StorageClients, id: string,
  hooks: { afterConsentMigration?: () => Promise<void> } = {}): Promise<void> {
  const observed = await retirements.findRetirement(prisma, id);
  if (!observed || observed.completedAt !== null || observed.storageKey === null) return;
  try {
    if (observed.operation === 'placement_attempt' && !observed.copySettled) {
      const settled = await prisma.$transaction(async (tx) => {
        await lockEducationalContent(tx, [observed.contentId]);
        await retirements.lockRetirement(tx, id);
        const record = await retirements.findRetirement(tx, id);
        if (!record || record.completedAt !== null || record.copySettled) return true;
        // A unique destination has ONE possible atomic COPY (SDK retries are
        // disabled). Positive HEAD proves that write took effect; absence does
        // NOT prove it cannot still arrive after DB rollback/process death.
        if (await statObjectStrict(storage, record.bucket, record.storageKey!) === null) {
          await retirements.recordRetirementFailure(tx, id, 'COPY_OUTCOME_UNKNOWN');
          return false;
        }
        await retirements.settlePlacementCopy(tx, id);
        return true;
      }, { timeout: 120_000, maxWait: 10_000 });
      if (!settled) return; // durable backlog retains the exact locator
    }
    if (observed.operation === 'consent_migrate') {
      // This operation already owns the global Session→Content lock hierarchy.
      await migrateConsentForcedContent(prisma, storage, observed.contentId, observed.storageKey);
      await hooks.afterConsentMigration?.();
      await prisma.$transaction(async (tx) => {
        await lockEducationalContent(tx, [observed.contentId]);
        await retirements.lockRetirement(tx, id);
        const current = await retirements.currentContent(tx, observed.contentId);
        // A new revocation may have won after the migration found no work.
        // Completing its still-pending shared obligation here would lose that
        // transition. Keep it retryable; never acquire Session locks backwards.
        if (current?.deletedAt === null && current.storageKey === observed.storageKey &&
            current.storageBucket === 'public' && current.visibility === 'public' && current.consentForcedPrivate) {
          throw new Error('consent retirement is not yet converged');
        }
        await retirements.completeRetirement(tx, id);
      });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await lockEducationalContent(tx, [observed.contentId]);
      await retirements.lockRetirement(tx, id);
      const record = await retirements.findRetirement(tx, id);
      if (!record || record.completedAt !== null || record.storageKey === null) return;
      const current = await retirements.currentContent(tx, record.contentId);
      const canonical = current?.deletedAt === null && current.storageKey === record.storageKey &&
        (current.storageBucket === record.bucket || record.operation === 'manual_permanent_delete');
      if (!canonical) {
        const coordinate = { contentId: record.contentId, bucket: record.bucket, storageKey: record.storageKey };
        if (record.operation === 'discard_unreferenced' || record.operation === 'placement_attempt') {
          await deleteObject(storage, record.bucket, record.storageKey);
        } else if (record.operation === 'manual_permanent_delete') {
          await retirePurgedContentObjects(storage, coordinate);
          if (record.bucket === 'public' && current === null) {
            await retirePurgedContentObjects(storage, { ...coordinate, bucket: 'private' });
          }
        } else if (record.operation === 'retire_public') {
          await retireConsentPublicObject(storage, record.contentId, record.storageKey);
          if (current === null) await retirePurgedContentObjects(storage, { ...coordinate, bucket: 'private' });
        } else {
          await quarantineRetiredContentObject(storage, coordinate);
          if (current === null) await retirePurgedContentObjects(storage, coordinate);
        }
      }
      await retirements.completeRetirement(tx, id);
    }, { timeout: 120_000, maxWait: 10_000 });
  } catch (error) {
    await retirements.recordRetirementFailure(prisma, id);
    throw error;
  }
}
