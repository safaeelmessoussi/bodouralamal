import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { actorFor } from '../test-support/actor.js';
import {
  activateDocument,
  activeDocument,
  createDocument,
  listDocuments,
  updateDocument,
} from './legal-document.service.js';

/**
 * **The versioned Privacy Policy and Terms of Use** (R138 §12/§13).
 *
 * Same shape as `legal-consent-text.integration.test.ts`, which this suite is
 * deliberately modelled on — the whole design decision was "reuse the pattern
 * that already answers these questions" rather than inventing a second one.
 * The property under test here is `kind`, the one thing genuinely new:
 *
 * 1. **Can only the right person manage either kind?**
 * 2. **Can two administrators put two versions of the SAME kind in force at
 *    once?** (Must not be possible — the database enforces it.)
 * 3. **Does activating one kind ever touch the other's own active row?**
 *    (Must not — this is the property `LegalConsentText` does not need,
 *    because it has no kind at all.)
 * 4. **Can wording that has been in force be changed afterwards?** (Must not.)
 * 5. **With nothing in force for a kind, does the platform refuse rather than
 *    improvise?**
 *
 * The wording used here is unmistakably not the real Privacy Policy or Terms
 * of Use — those are drafted separately (R138 §12) and this suite exists to
 * prove the PUBLICATION MECHANISM, not to carry the real text.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[legal-doc-test]';

const WORDING_A = 'نص تجريبي (أ) — لا قيمة قانونية له.';
const WORDING_B = 'نص تجريبي (ب) — لا قيمة قانونية له.';

let superId = '';
let adminId = '';

async function makeUser(role: string | null, label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { sex: 'female', nameArabic: `${TAG} ${label}`, accountStatus: 'active' },
  });
  if (role) {
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: roleRow.id, branchId: null },
    });
  }
  return user.id;
}

const superAdmin = () => actorFor(prisma, superId);
const admin = () => actorFor(prisma, adminId);

const mine = <T extends { version_label: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.version_label.startsWith(TAG));

async function draft(
  kind: 'privacy_policy' | 'terms_of_use',
  label: string,
  body = WORDING_A,
) {
  return createDocument(prisma, await superAdmin(), {
    kind,
    versionLabel: `${TAG} ${label}`,
    bodyArabic: body,
  });
}

/**
 * What each kind had in force before this suite ran, restored exactly — the
 * TD-15 `version` included, matching `legal-consent-text`'s own suite.
 */
const previous: Record<
  'privacy_policy' | 'terms_of_use',
  { id: string; version: number; supersededAt: Date | null } | null
> = { privacy_policy: null, terms_of_use: null };
let previousCaptured = false;

async function clear(): Promise<void> {
  const rows = await prisma.legalDocument.findMany({
    where: { versionLabel: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.legalDocument.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  for (const kind of ['privacy_policy', 'terms_of_use'] as const) {
    const was = previous[kind];
    if (was) {
      await prisma.legalDocument.updateMany({
        where: { id: was.id },
        data: { status: 'active', supersededAt: was.supersededAt, version: was.version },
      });
    }
  }
}

beforeEach(async () => {
  if (!previousCaptured) {
    for (const kind of ['privacy_policy', 'terms_of_use'] as const) {
      previous[kind] = await prisma.legalDocument.findFirst({
        where: { kind, status: 'active' },
        select: { id: true, version: true, supersededAt: true },
      });
    }
    previousCaptured = true;
  }
  await clear();
  superId = await makeUser('super_admin', 'مشرفة عامة');
  adminId = await makeUser('admin', 'مسؤولة');
});

afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

/* ── 1. Authorization ───────────────────────────────────────────────────── */

describe('only a Super Admin manages either legal document', () => {
  it('refuses an Admin every verb — reading it too', async () => {
    await expect(
      listDocuments(prisma, await admin(), 'privacy_policy'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createDocument(prisma, await admin(), {
        kind: 'privacy_policy',
        versionLabel: `${TAG} مرفوض`,
        bodyArabic: WORDING_A,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await draft('privacy_policy', 'لاختبار الرفض');
    await expect(activateDocument(prisma, await admin(), row.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lets a Super Admin create, edit and activate either kind', async () => {
    const row = await draft('terms_of_use', 'v1');
    expect(row.status).toBe('draft');
    const edited = await updateDocument(
      prisma,
      await superAdmin(),
      row.id,
      { versionLabel: `${TAG} v1`, bodyArabic: WORDING_B },
      row.version,
    );
    expect(edited.body_arabic).toBe(WORDING_B);
    const live = await activateDocument(prisma, await superAdmin(), row.id);
    expect(live.status).toBe('active');
    expect(live.activated_at).not.toBeNull();
  });
});

/* ── 2. Creating is not activating; labels are unique WITHIN a kind ──────── */

describe('a new version reaches nobody until it is activated', () => {
  it('leaves a draft out of force', async () => {
    const before = await activeDocument(prisma, 'privacy_policy').catch(() => null);
    await draft('privacy_policy', 'مسوّدة');
    const after = await activeDocument(prisma, 'privacy_policy').catch(() => null);
    expect(after?.id ?? null).toBe(before?.id ?? null);
  });

  it('refuses a duplicate version identifier WITHIN one kind', async () => {
    await draft('privacy_policy', 'v1');
    await expect(draft('privacy_policy', 'v1', WORDING_B)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'LEGAL_DOCUMENT_VERSION_LABEL_TAKEN' },
    });
  });

  it('allows the SAME label across the two different kinds — they are never compared', async () => {
    const privacy = await draft('privacy_policy', 'v1');
    const terms = await draft('terms_of_use', 'v1');
    expect(privacy.id).not.toBe(terms.id);
    expect(privacy.version_label).toBe(terms.version_label);
  });
});

/* ── 3. Immutability ────────────────────────────────────────────────────── */

describe('a document version that has been in force is immutable', () => {
  it('refuses to edit an ACTIVE version', async () => {
    const row = await draft('privacy_policy', 'v1');
    const live = await activateDocument(prisma, await superAdmin(), row.id);
    await expect(
      updateDocument(
        prisma,
        await superAdmin(),
        row.id,
        { versionLabel: `${TAG} v1`, bodyArabic: WORDING_B },
        live.version,
      ),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'LEGAL_DOCUMENT_IMMUTABLE' },
    });
    const still = await activeDocument(prisma, 'privacy_policy');
    expect(still.bodyArabic).toBe(WORDING_A);
  });

  it('refuses to edit a SUPERSEDED version too', async () => {
    const first = await draft('privacy_policy', 'v1');
    await activateDocument(prisma, await superAdmin(), first.id);
    const second = await draft('privacy_policy', 'v2', WORDING_B);
    await activateDocument(prisma, await superAdmin(), second.id);

    const stale = mine(await listDocuments(prisma, await superAdmin(), 'privacy_policy')).find(
      (r) => r.id === first.id,
    );
    expect(stale?.status).toBe('superseded');
    await expect(
      updateDocument(
        prisma,
        await superAdmin(),
        first.id,
        { versionLabel: `${TAG} v1`, bodyArabic: 'نص معدَّل' },
        stale!.version,
      ),
    ).rejects.toMatchObject({ details: { reason: 'LEGAL_DOCUMENT_IMMUTABLE' } });
  });
});

/* ── 4. Exactly one active version PER KIND ─────────────────────────────── */

describe('exactly one version is in force PER KIND', () => {
  it('supersedes the outgoing version of the SAME kind as the incoming one takes effect', async () => {
    const first = await draft('privacy_policy', 'v1');
    await activateDocument(prisma, await superAdmin(), first.id);
    const second = await draft('privacy_policy', 'v2', WORDING_B);
    await activateDocument(prisma, await superAdmin(), second.id);

    const rows = mine(await listDocuments(prisma, await superAdmin(), 'privacy_policy'));
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
    expect(rows.find((r) => r.id === first.id)?.status).toBe('superseded');
    expect(rows.find((r) => r.id === first.id)?.superseded_at).not.toBeNull();
  });

  /**
   * **The property `LegalConsentText` does not need to have, because it has
   * no `kind` at all.** Activating a Privacy Policy draft must never touch
   * the Terms of Use's own active row, and this is the test that would fail
   * if the partial unique index (or the service's `where: { kind, ... }`
   * scoping) were accidentally global instead of per-kind.
   */
  it('activating one kind never supersedes or blocks the other kind', async () => {
    const privacy = await draft('privacy_policy', 'v1');
    await activateDocument(prisma, await superAdmin(), privacy.id);
    const terms = await draft('terms_of_use', 'v1');
    const activeTerms = await activateDocument(prisma, await superAdmin(), terms.id);

    expect(activeTerms.status).toBe('active');
    const stillPrivacy = await activeDocument(prisma, 'privacy_policy');
    expect(stillPrivacy.id).toBe(privacy.id);
    const stillTerms = await activeDocument(prisma, 'terms_of_use');
    expect(stillTerms.id).toBe(terms.id);
  });

  /**
   * **The invariant is the DATABASE's, not the service's** — a partial unique
   * index over `(kind) WHERE status = 'active'`. Asserted by writing
   * directly, bypassing every service check, for the same race-safety reason
   * `legal-consent-text`'s own suite asserts it this way.
   */
  it('cannot be defeated by a direct write that bypasses the service', async () => {
    const first = await draft('privacy_policy', 'v1');
    await activateDocument(prisma, await superAdmin(), first.id);
    const second = await draft('privacy_policy', 'v2', WORDING_B);

    await expect(
      prisma.legalDocument.update({
        where: { id: second.id },
        data: { status: 'active', activatedAt: new Date(), activatedById: superId },
      }),
    ).rejects.toThrow();

    expect((await activeDocument(prisma, 'privacy_policy')).id).toBe(first.id);
  });

  it('refuses to reactivate a superseded version', async () => {
    const first = await draft('privacy_policy', 'v1');
    await activateDocument(prisma, await superAdmin(), first.id);
    const second = await draft('privacy_policy', 'v2', WORDING_B);
    await activateDocument(prisma, await superAdmin(), second.id);
    await expect(
      activateDocument(prisma, await superAdmin(), first.id),
    ).rejects.toMatchObject({ details: { reason: 'LEGAL_DOCUMENT_SUPERSEDED' } });
  });
});

/* ── 5. Fail closed, per kind ────────────────────────────────────────────── */

describe('with no version in force for a kind, the platform refuses', () => {
  it('answers a coded 503 for the empty kind while the other kind is unaffected', async () => {
    const activePrivacy = await prisma.legalDocument.findFirst({
      where: { kind: 'privacy_policy', status: 'active' },
      select: { id: true },
    });
    if (activePrivacy) {
      await prisma.legalDocument.update({
        where: { id: activePrivacy.id },
        data: { status: 'superseded', supersededAt: new Date() },
      });
    }
    try {
      await expect(activeDocument(prisma, 'privacy_policy')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        details: { reason: 'LEGAL_DOCUMENT_NOT_CONFIGURED', kind: 'privacy_policy' },
      });
      // terms_of_use is a different kind and must not be affected by the
      // privacy_policy row above being taken out of force.
      const terms = await draft('terms_of_use', 'v1');
      await activateDocument(prisma, await superAdmin(), terms.id);
      await expect(activeDocument(prisma, 'terms_of_use')).resolves.toMatchObject({
        id: terms.id,
      });
    } finally {
      if (activePrivacy) {
        await prisma.legalDocument.update({
          where: { id: activePrivacy.id },
          data: { status: 'active', supersededAt: null },
        });
      }
    }
  });
});

/* ── 6. Audit ───────────────────────────────────────────────────────────── */

describe('TD-8 — creation and activation are audited, minimized', () => {
  it('records who wrote a version and who put it into force, naming only the kind', async () => {
    const row = await draft('privacy_policy', 'v1');
    await activateDocument(prisma, await superAdmin(), row.id);

    const rows = await prisma.auditLog.findMany({
      where: { actorUserId: superId, targetId: row.id },
      orderBy: { createdAt: 'asc' },
      select: { actionType: true, detail: true },
    });
    expect(rows.map((r) => r.actionType)).toEqual(['legaldocument.create', 'legaldocument.activate']);
    expect(rows[0]!.detail).toMatchObject({ kind: 'privacy_policy' });
    // Never the body, never a copied label.
    expect(JSON.stringify(rows[0]!.detail)).not.toContain(WORDING_A);
    expect(JSON.stringify(rows[0]!.detail)).not.toContain(`${TAG} v1`);
  });

  it('names what an activation replaced, so a date can be reconstructed', async () => {
    const first = await draft('privacy_policy', 'v1');
    await activateDocument(prisma, await superAdmin(), first.id);
    const second = await draft('privacy_policy', 'v2', WORDING_B);
    await activateDocument(prisma, await superAdmin(), second.id);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: second.id, actionType: 'legaldocument.activate' },
      select: { detail: true },
    });
    expect(row.detail).toMatchObject({ kind: 'privacy_policy', superseded_version_id: first.id });
  });
});
