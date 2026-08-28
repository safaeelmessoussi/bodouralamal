import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { CONSENT_TEXT_VERSION_KEY } from '../services/registration.service.js';

/**
 * Save and restore `legal.consent_text_version` around a suite.
 *
 * **This exists because the test suites broke the development environment.**
 * Every suite touching registration upserted this setting in `beforeEach` and
 * **deleted it in `afterAll`** — so running `npm run test:integration` left the
 * developer's database with no consent text version, and registration then
 * failed closed with a `503` for everyone who tried the form afterwards.
 *
 * The failure was doubly confusing: the tests were green, the application was
 * broken, and *the tests were the reason*. It cost a P0 investigation.
 *
 * A test fixture may create whatever state it needs. It may not leave the
 * database in a state the application cannot run in — "clean up after yourself"
 * means **restore what was there**, not "delete what you used".
 */
export interface SavedConsentVersion {
  readonly existed: boolean;
  readonly value: unknown;
  readonly version: number;
  readonly updatedById: string | null;
}

export async function captureConsentVersion(
  prisma: Pick<PrismaClient, 'systemSetting'>,
): Promise<SavedConsentVersion> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    select: { value: true, version: true, updatedById: true },
  });
  return {
    existed: row !== null,
    value: row?.value ?? null,
    version: row?.version ?? 0,
    updatedById: row?.updatedById ?? null,
  };
}

/**
 * Puts it back exactly as it was — including *absent*, which is a real state
 * the suites deliberately exercise and must be able to restore to.
 */
export async function restoreConsentVersion(
  prisma: Pick<PrismaClient, 'systemSetting'>,
  saved: SavedConsentVersion,
): Promise<void> {
  if (!saved.existed) {
    await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });
    return;
  }
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: {
      value: saved.value as Prisma.InputJsonValue,
      version: saved.version,
      updatedById: saved.updatedById,
    },
    create: {
      key: CONSENT_TEXT_VERSION_KEY,
      value: saved.value as Prisma.InputJsonValue,
      version: saved.version,
      updatedById: saved.updatedById,
    },
  });
}
