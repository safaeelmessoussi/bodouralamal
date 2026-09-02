import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { actorFor } from '../test-support/actor.js';
import {
  activateConsentText,
  activeConsentText,
  createConsentText,
  digestOf,
  listConsentTexts,
  resolvePresentedConsentText,
  updateConsentText,
} from './legal-consent-text.service.js';

/**
 * **The versioned legal consent wording** (§2.3, §4.1a; Owner decision,
 * 2026-09-02, SRS R119).
 *
 * ## What this suite is for
 *
 * The thing being replaced was not a bug in a function — it was an *absence of
 * a relationship*. The Arabic wording lived in the frontend's i18n catalogue,
 * the version lived in a `SystemSetting` string an administrator typed, and a
 * `ConsentRecord` stored only that string. Every drift between the three passed
 * every test that existed, because nothing asserted a relationship that nothing
 * enforced.
 *
 * So these tests are about *properties of the evidence*, and each one is a
 * question a compliance reviewer actually asks:
 *
 * 1. **Can only the right person create and activate a wording?**
 * 2. **Does the form receive the exact wording that will be recorded?**
 * 3. **Can wording somebody agreed to be changed afterwards?** (It must not be.)
 * 4. **Can two administrators put two wordings in force at once?** (It must not
 *    be possible, and the guard is the database, not a check in a service.)
 * 5. **Can a person be recorded as agreeing to a version they never saw?**
 * 6. **Given a record, can the exact wording be retrieved?**
 * 7. **With nothing in force, does the platform refuse rather than improvise?**
 *
 * ## The wording used here is unmistakably not approved
 *
 * §2.3 makes approving the Arabic consent wording an Owner compliance task.
 * Nothing in this repository holds the real text, and a fixture that looked
 * like it would be the first step toward one being deployed.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[consent-text-test]';

const WORDING_A = 'نص تجريبي (أ) — لا قيمة قانونية له ولم تتم الموافقة عليه.';
const WORDING_B = 'نص تجريبي (ب) — لا قيمة قانونية له ولم تتم الموافقة عليه.';

let superId = '';
let adminId = '';

/**
 * What was in force before this suite ran, restored **exactly** — the TD-15
 * `version` included, because `activateConsentText` increments it on whatever
 * it supersedes and P1.2's all-table digest covers that column.
 */
let previous: { id: string; version: number; supersededAt: Date | null } | null = null;
let previousCaptured = false;

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

/** Only this suite's rows: the development database is shared (P1.2). */
const mine = <T extends { version_label: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.version_label.startsWith(TAG));

async function draft(label: string, body = WORDING_A) {
  return createConsentText(prisma, await superAdmin(), {
    versionLabel: `${TAG} ${label}`,
    bodyArabic: body,
  });
}

async function clear(): Promise<void> {
  const rows = await prisma.legalConsentText.findMany({
    where: { versionLabel: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  // The suite's own consent evidence, before the wording it names: the FK is
  // RESTRICT precisely so evidence cannot lose the words it was given against.
  await prisma.consentRecord.deleteMany({ where: { consentTextId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.legalConsentText.deleteMany({ where: { id: { in: ids } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  // Whatever the installation had in force comes back. **Never deleted**: it is
  // somebody's evidence, and it is what the developer's own registration form
  // needs to work after this file has run.
  if (previous) {
    await prisma.legalConsentText.updateMany({
      where: { id: previous.id },
      data: {
        status: 'active',
        supersededAt: previous.supersededAt,
        version: previous.version,
      },
    });
  }
}

beforeEach(async () => {
  if (!previousCaptured) {
    previous = await prisma.legalConsentText.findFirst({
      where: { status: 'active' },
      select: { id: true, version: true, supersededAt: true },
    });
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

describe('only a Super Admin manages the legal wording', () => {
  it('refuses an Admin every verb — reading it too', async () => {
    // A read-only leak is still a leak, and this decides what people are held
    // to have agreed to. The negative half is asserted, because a permission
    // test that proves only the yes is not one.
    await expect(listConsentTexts(prisma, await admin())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      createConsentText(prisma, await admin(), {
        versionLabel: `${TAG} مرفوض`,
        bodyArabic: WORDING_A,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await draft('لاختبار الرفض');
    await expect(activateConsentText(prisma, await admin(), row.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lets a Super Admin create, edit and activate', async () => {
    const row = await draft('v1');
    expect(row.status).toBe('draft');
    const edited = await updateConsentText(
      prisma,
      await superAdmin(),
      row.id,
      { versionLabel: `${TAG} v1`, bodyArabic: WORDING_B },
      row.version,
    );
    expect(edited.body_arabic).toBe(WORDING_B);
    const live = await activateConsentText(prisma, await superAdmin(), row.id);
    expect(live.status).toBe('active');
    expect(live.activated_at).not.toBeNull();
  });
});

/* ── 2. Creating is not activating ──────────────────────────────────────── */

describe('a new wording reaches nobody until it is activated', () => {
  it('leaves a draft out of force, so drafting cannot change what people see', async () => {
    // The Owner's flow: create → write → label → review → **activate**, with
    // activation an explicit separate act. A draft that took effect on save
    // would make writing and deciding the same action.
    const before = await activeConsentText(prisma).catch(() => null);
    await draft('مسوّدة');
    const after = await activeConsentText(prisma).catch(() => null);
    expect(after?.id ?? null).toBe(before?.id ?? null);
  });

  it('refuses a duplicate version identifier with a coded reason', async () => {
    await draft('v1');
    await expect(draft('v1', WORDING_B)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'CONSENT_TEXT_VERSION_LABEL_TAKEN' },
    });
  });
});

/* ── 3. Immutability ────────────────────────────────────────────────────── */

describe('wording that has been in force is immutable', () => {
  it('refuses to edit an ACTIVE version — new wording is a new version', async () => {
    const row = await draft('v1');
    const live = await activateConsentText(prisma, await superAdmin(), row.id);
    await expect(
      updateConsentText(
        prisma,
        await superAdmin(),
        row.id,
        { versionLabel: `${TAG} v1`, bodyArabic: WORDING_B },
        live.version,
      ),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'CONSENT_TEXT_IMMUTABLE' },
    });
    const still = await activeConsentText(prisma);
    expect(still.bodyArabic).toBe(WORDING_A);
  });

  it('refuses to edit a SUPERSEDED version too', async () => {
    // The trap: *«nobody sees it any more, so it can be tidied»*. People WERE
    // shown it, and their records point at it — it is exactly as frozen as the
    // live one.
    const first = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), first.id);
    const second = await draft('v2', WORDING_B);
    await activateConsentText(prisma, await superAdmin(), second.id);

    const stale = mine(await listConsentTexts(prisma, await superAdmin())).find(
      (r) => r.id === first.id,
    );
    expect(stale?.status).toBe('superseded');
    await expect(
      updateConsentText(
        prisma,
        await superAdmin(),
        first.id,
        { versionLabel: `${TAG} v1`, bodyArabic: 'نص معدَّل' },
        stale!.version,
      ),
    ).rejects.toMatchObject({ details: { reason: 'CONSENT_TEXT_IMMUTABLE' } });
  });

  it('keeps the digest in step with the wording it certifies', async () => {
    // Defense in depth, never a substitute for the text: it detects a wording
    // altered underneath a record and says nothing about what it said.
    const row = await draft('v1');
    expect(row.body_digest).toBe(digestOf(WORDING_A));
    const edited = await updateConsentText(
      prisma,
      await superAdmin(),
      row.id,
      { versionLabel: `${TAG} v1`, bodyArabic: WORDING_B },
      row.version,
    );
    expect(edited.body_digest).toBe(digestOf(WORDING_B));
    expect(edited.body_digest).not.toBe(row.body_digest);
  });
});

/* ── 4. Exactly one active version ──────────────────────────────────────── */

describe('exactly one wording is in force', () => {
  it('supersedes the outgoing version as the incoming one takes effect', async () => {
    const first = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), first.id);
    const second = await draft('v2', WORDING_B);
    await activateConsentText(prisma, await superAdmin(), second.id);

    const rows = mine(await listConsentTexts(prisma, await superAdmin()));
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
    expect(rows.find((r) => r.id === first.id)?.status).toBe('superseded');
    expect(rows.find((r) => r.id === first.id)?.superseded_at).not.toBeNull();
    // The outgoing version keeps when it FIRST came into force.
    expect(rows.find((r) => r.id === first.id)?.activated_at).not.toBeNull();
  });

  /**
   * **The invariant is the DATABASE's, not the service's** — a partial unique
   * index over `status = 'active'`.
   *
   * Asserted by writing directly, bypassing every service check, because a
   * service-level guard is a race: two transactions can both read *«nothing is
   * active»* and both proceed. If this ever succeeds, two authoritative
   * wordings exist and somebody can be recorded against one nobody put in
   * force.
   */
  it('cannot be defeated by a direct write that bypasses the service', async () => {
    const first = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), first.id);
    const second = await draft('v2', WORDING_B);

    await expect(
      prisma.legalConsentText.update({
        where: { id: second.id },
        data: { status: 'active', activatedAt: new Date(), activatedById: superId },
      }),
    ).rejects.toThrow();

    expect((await activeConsentText(prisma)).id).toBe(first.id);
  });

  it('refuses to reactivate a superseded wording', async () => {
    // Its `activated_at` records when it FIRST came into force; overwriting
    // that erases the one fact an audit needs from it.
    const first = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), first.id);
    const second = await draft('v2', WORDING_B);
    await activateConsentText(prisma, await superAdmin(), second.id);
    await expect(
      activateConsentText(prisma, await superAdmin(), first.id),
    ).rejects.toMatchObject({ details: { reason: 'CONSENT_TEXT_SUPERSEDED' } });
  });
});

/* ── 5. What a form is given, and what it may submit ────────────────────── */

describe('what is displayed is what is recorded', () => {
  it('hands the form the EXACT wording of the version in force', async () => {
    const row = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), row.id);
    const active = await activeConsentText(prisma);
    // One record, one response: no *«frontend text X, separately fetched
    // version Y»* is possible, because there is no second source for either.
    expect(active.id).toBe(row.id);
    expect(active.bodyArabic).toBe(WORDING_A);
    expect(active.versionLabel).toBe(`${TAG} v1`);
  });

  /**
   * **The race the round trip exists for.**
   *
   * A Super Admin activates new wording between the form being drawn and being
   * submitted. Recording the NEW version would state that this person agreed to
   * words they never saw; recording the OLD one would record agreement to a
   * wording the association may have withdrawn *because it was wrong*. So the
   * server refuses, and the client re-presents.
   */
  it('refuses a submission naming a version that went out of force', async () => {
    const first = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), first.id);
    const presented = (await activeConsentText(prisma)).id;

    const second = await draft('v2', WORDING_B);
    await activateConsentText(prisma, await superAdmin(), second.id);

    await expect(resolvePresentedConsentText(prisma, presented)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'CONSENT_TEXT_SUPERSEDED' },
    });
  });

  it('accepts the version still in force, and returns its label to record', async () => {
    const row = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), row.id);
    await expect(resolvePresentedConsentText(prisma, row.id)).resolves.toEqual({
      id: row.id,
      versionLabel: `${TAG} v1`,
    });
  });

  it('refuses a submission that names no version at all', async () => {
    // Filling the blank with *whatever is active* would reintroduce the race by
    // the back door, and it is the obvious convenience to add.
    const row = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), row.id);
    await expect(resolvePresentedConsentText(prisma, undefined)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

/* ── 6. Retrieval, and legacy evidence ──────────────────────────────────── */

describe('given a consent record, the exact wording is retrievable', () => {
  it('resolves the words a record was given against, long after the fact', async () => {
    const first = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), first.id);

    const student = await makeUser(null, 'موافِقة');
    const record = await prisma.consentRecord.create({
      data: {
        studentId: student,
        consentType: 'data_processing',
        granted: true,
        method: 'online_form',
        consentTextVersion: `${TAG} v1`,
        consentTextId: first.id,
        grantedByUserId: student,
      },
      select: { id: true },
    });

    // Two more versions come and go. The record still resolves to what it was.
    const second = await draft('v2', WORDING_B);
    await activateConsentText(prisma, await superAdmin(), second.id);

    const resolved = await prisma.consentRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: { consentTextVersion: true, consentText: { select: { bodyArabic: true } } },
    });
    expect(resolved.consentText?.bodyArabic).toBe(WORDING_A);
    // The human-readable label is retained beside the reference, because it is
    // what an export and an audit row carry.
    expect(resolved.consentTextVersion).toBe(`${TAG} v1`);
  });

  /**
   * **Legacy evidence is preserved honestly, and never fabricated.**
   *
   * A record written before R119 names a version whose wording was never
   * stored. No `LegalConsentText` is manufactured for it: attaching it to a row
   * containing today's text would assert that this person read those words,
   * which nobody can prove. `NULL` says *the wording is not resolvable*, and
   * the string beside it is the evidence that does exist.
   */
  it('leaves a pre-R119 record unresolved rather than attaching it to today s text', async () => {
    const row = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), row.id);

    const student = await makeUser(null, 'موافِقة قديمة');
    const legacy = await prisma.consentRecord.create({
      data: {
        studentId: student,
        consentType: 'data_processing',
        granted: true,
        method: 'online_form',
        // A string from before the versioned model. Its wording is unknown.
        consentTextVersion: 'legacy-2026-05-v1',
        grantedByUserId: student,
      },
      select: { id: true },
    });

    const read = await prisma.consentRecord.findUniqueOrThrow({
      where: { id: legacy.id },
      select: { consentTextVersion: true, consentTextId: true, consentText: true },
    });
    expect(read.consentTextId).toBeNull();
    expect(read.consentText).toBeNull();
    // The evidence that DOES exist is intact — not discarded, not restamped.
    expect(read.consentTextVersion).toBe('legacy-2026-05-v1');
  });

  it('will not let a wording somebody agreed to be deleted', async () => {
    // `RESTRICT`. Evidence must stay reconstructible, so tidying the catalogue
    // can never destroy the words a stored consent points at.
    const row = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), row.id);
    const student = await makeUser(null, 'موافِقة');
    await prisma.consentRecord.create({
      data: {
        studentId: student,
        consentType: 'data_processing',
        granted: true,
        method: 'online_form',
        consentTextVersion: `${TAG} v1`,
        consentTextId: row.id,
        grantedByUserId: student,
      },
    });
    await expect(prisma.legalConsentText.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

/* ── 7. Fail closed ─────────────────────────────────────────────────────── */

describe('with no wording in force, the platform refuses', () => {
  it('answers a coded 503 rather than improvising a version', async () => {
    // Every registration path goes through this one helper, so they cannot
    // disagree about which wording is in force — or about failing without one.
    const active = await prisma.legalConsentText.findFirst({
      where: { status: 'active' },
      select: { id: true },
    });
    if (active) {
      await prisma.legalConsentText.update({
        where: { id: active.id },
        data: { status: 'superseded', supersededAt: new Date() },
      });
    }
    try {
      await expect(activeConsentText(prisma)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        details: { reason: 'CONSENT_TEXT_VERSION_NOT_CONFIGURED' },
      });
    } finally {
      if (active) {
        await prisma.legalConsentText.update({
          where: { id: active.id },
          data: { status: 'active', supersededAt: null },
        });
      }
    }
  });
});

/* ── 8. Audit ───────────────────────────────────────────────────────────── */

describe('TD-8 — creation and activation are audited', () => {
  it('records who wrote a wording and who put it into force', async () => {
    const row = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), row.id);

    const rows = await prisma.auditLog.findMany({
      where: { actorUserId: superId, targetId: row.id },
      orderBy: { createdAt: 'asc' },
      select: { actionType: true, detail: true },
    });
    expect(rows.map((r) => r.actionType)).toEqual([
      'legalconsenttext.create',
      'legalconsenttext.activate',
    ]);
    // **The digest, never the body.** Audit rows are purged on their own
    // schedule; duplicating the wording into a table whose retention is not the
    // evidence's would put the evidence on the wrong clock.
    expect(rows[0]!.detail).toMatchObject({ body_digest: digestOf(WORDING_A) });
    expect(JSON.stringify(rows[0]!.detail)).not.toContain(WORDING_A);
    // **No copied label either** (`assertMinimizedDetail`): `targetId` is the
    // version, its row is permanent, and the label is one join away.
    expect(JSON.stringify(rows[0]!.detail)).not.toContain(`${TAG} v1`);
  });

  it('names what an activation replaced, so a date can be reconstructed', async () => {
    const first = await draft('v1');
    await activateConsentText(prisma, await superAdmin(), first.id);
    const second = await draft('v2', WORDING_B);
    await activateConsentText(prisma, await superAdmin(), second.id);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: second.id, actionType: 'legalconsenttext.activate' },
      select: { detail: true },
    });
    // The id, not the label — and it is enough, because neither row is ever
    // deleted, so *what was in force between these two instants* is a join.
    expect(row.detail).toMatchObject({ superseded_version_id: first.id });
  });
});
