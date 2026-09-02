import type { PrismaClient } from '../generated/prisma/client.js';
import { digestOf } from '../services/legal-consent-text.service.js';

/**
 * **Install and remove a development consent wording around a suite.**
 *
 * ## The failure this exists for, twice over
 *
 * The first version of this helper saved and restored the
 * `legal.consent_text_version` `SystemSetting`, because every suite touching
 * registration used to upsert it in `beforeEach` and **delete it in
 * `afterAll`** — leaving the developer's database with no consent version, so
 * registration failed closed with a `503` for everybody afterwards. Green
 * tests, broken application, and the tests were the reason. It cost a P0.
 *
 * The second failure is the one this rewrite also fixes: restoration was the
 * **last** statement of an `afterAll` that deleted fixture rows first, so any
 * failure in that teardown skipped it and left the suite's scratch value in the
 * shared database (`email-ownership.integration.test.ts` left
 * `email-owner-test-v1` behind exactly this way). **Restoration is now
 * unconditional** — see `removeTestConsentText`, and call it from a `finally`.
 *
 * ## The wording is unmistakably not approved
 *
 * §2.3 makes approving the Arabic consent wording an Owner compliance task. A
 * fixture must never contain anything that could be mistaken for it, so the
 * body below says in Arabic that it is development text with no legal value,
 * and the label carries the suite's own tag. Production is never seeded with
 * it: nothing outside `src/**` and the development seed can reach this module.
 */
export interface InstalledConsentText {
  /** The version this suite installed and activated. */
  readonly id: string;
  readonly versionLabel: string;
  /**
   * What was active before, to be put back exactly. `null` if nothing was.
   *
   * **The TD-15 `version` is part of "exactly".** `activateConsentText`
   * increments it on the version it supersedes, so a suite that activates a
   * draft of its own bumps the installation's row — and P1.2's all-table digest
   * covers `version`, correctly: a restore that puts the status back and leaves
   * the counter moved has still changed shared state.
   */
  readonly previousActiveId: string | null;
  readonly previousActiveVersion: number | null;
  readonly previousActiveSupersededAt: Date | null;
}

/**
 * **Development wording, and it says so.** Arabic, because that is what the
 * column holds and a Latin placeholder would not exercise the same storage.
 */
export const DEV_CONSENT_BODY =
  'نص تجريبي للتطوير فقط — لا قيمة قانونية له ولم تتم الموافقة عليه.';

export async function installTestConsentText(
  prisma: PrismaClient,
  versionLabel: string,
  body: string = DEV_CONSENT_BODY,
): Promise<InstalledConsentText> {
  const actorId = await someUserId(prisma);
  return prisma.$transaction(async (tx) => {
    const previous = await tx.legalConsentText.findFirst({
      where: { status: 'active' },
      select: { id: true, version: true, supersededAt: true, versionLabel: true },
    });
    /**
     * **Re-installing an already-active label is refused, loudly.**
     *
     * A suite that installs in `beforeEach` without `??=` reaches this with its
     * own row already active. Treating that as *what was there before* loses
     * the installation's real wording, which then stays `superseded` after the
     * run — and the symptom is a P1.2 digest difference on a table whose row
     * COUNT is unchanged, which is about as hard to read as a failure gets.
     *
     * Adopting a `superseded` row of the same label is still fine and is why
     * the upsert exists: that is a previous run that died mid-suite.
     */
    if (previous?.versionLabel === versionLabel) {
      throw new Error(
        `installTestConsentText: «${versionLabel}» is already in force. ` +
          'Install once per suite (`consentText ??= await installTestConsentText(…)`); ' +
          'installing again would discard what this installation had active.',
      );
    }
    if (previous) {
      await tx.legalConsentText.update({
        where: { id: previous.id },
        data: { status: 'superseded', supersededAt: new Date() },
      });
    }
    // `upsert`, because a previous run that died mid-suite may have left the
    // label behind — and failing to start is a worse answer than adopting it.
    const row = await tx.legalConsentText.upsert({
      where: { versionLabel },
      update: {
        bodyArabic: body,
        bodyDigest: digestOf(body),
        status: 'active',
        activatedAt: new Date(),
        activatedById: actorId,
        supersededAt: null,
      },
      create: {
        versionLabel,
        bodyArabic: body,
        bodyDigest: digestOf(body),
        status: 'active',
        activatedAt: new Date(),
        activatedById: actorId,
        createdById: actorId,
      },
      select: { id: true, versionLabel: true },
    });
    return {
      ...row,
      previousActiveId: previous?.id ?? null,
      previousActiveVersion: previous?.version ?? null,
      previousActiveSupersededAt: previous?.supersededAt ?? null,
    };
  });
}

/**
 * **Puts back exactly what was there.** Call it FIRST in `afterAll`.
 *
 * The critical half of the restore, and the one that must never be skipped: the
 * installation gets back the wording it had in force, so the developer's
 * registration form still works after this file has run. Nothing is deleted
 * here — see `deleteTestConsentText` for the other half, and why it is
 * separate.
 */
export async function removeTestConsentText(
  prisma: PrismaClient,
  installed: InstalledConsentText | null,
): Promise<void> {
  if (!installed) return;
  await prisma.$transaction(async (tx) => {
    await tx.legalConsentText.update({
      where: { id: installed.id },
      data: { status: 'superseded', supersededAt: new Date() },
    });
    if (installed.previousActiveId) {
      await tx.legalConsentText.update({
        where: { id: installed.previousActiveId },
        data: {
          status: 'active',
          supersededAt: installed.previousActiveSupersededAt,
          // Put the counter back too — see `previousActiveVersion`.
          ...(installed.previousActiveVersion === null
            ? {}
            : { version: installed.previousActiveVersion }),
        },
      });
    }
  });
}

/**
 * **Removes the suite's own row.** Call it LAST in `afterAll`, after the
 * fixture teardown.
 *
 * ## Why this is a second function
 *
 * The two halves want opposite positions, and P1.2's all-table snapshot guard
 * is what forced the point:
 *
 * * The **restore** must run FIRST, because a teardown that throws would
 *   otherwise skip it and leave the shared database with the suite's scratch
 *   wording in force — the B10 leak, which was an ordering mistake rather than
 *   a missing restore.
 * * The **delete** must run LAST, because `consent_record.consent_text_id` is
 *   `RESTRICT`: while the suite's own consent records still exist, the delete
 *   fails and leaves a row behind — which the snapshot guard reports as changed
 *   pre-existing state, correctly.
 *
 * One function could not be in both places, so there are two.
 *
 * **Best effort by design.** When something still references the wording, the
 * row is left `superseded` rather than forced away: a superseded development
 * version is inert and honest, while deleting it would destroy the only copy of
 * the words a stored consent record points at.
 */
export async function deleteTestConsentText(
  prisma: PrismaClient,
  installed: InstalledConsentText | null,
): Promise<void> {
  if (!installed) return;
  try {
    await prisma.legalConsentText.delete({ where: { id: installed.id } });
  } catch {
    // Referenced by consent evidence. See the docstring — this is the correct
    // outcome, not a swallowed failure.
  }
}

/**
 * `created_by_id` is `NOT NULL`, and a fixture has no natural author. The Super
 * Admin the seed provisions is the honest choice; any live account will do, and
 * a database with none cannot run a registration suite anyway.
 */
async function someUserId(prisma: PrismaClient): Promise<string> {
  const row = await prisma.user.findFirstOrThrow({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return row.id;
}
