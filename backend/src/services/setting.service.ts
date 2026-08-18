import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import { assertFreshActive } from '../policies/freshness.policy.js';
import * as audit from '../repositories/audit.repository.js';
import { CONSENT_TEXT_VERSION_KEY } from './registration.service.js';

/**
 * Platform settings (SRS §5.6, TD-3.11, Revision 42).
 *
 * **Why this exists.** `legal.consent_text_version` is required before any
 * registration can be accepted (§4.1a), §15.1 deliberately does not seed it
 * (§2.3 makes versioning the Arabic text an owner compliance task), and the
 * screen meant to carry it had **no API behind it**. The value could therefore
 * be set by nothing in the product — a first deployment would have refused
 * every registration with no in-product remedy, and a development fixture is
 * not a production mechanism.
 */

/** §5.6 places System Settings under Super Admin, and nobody else. */
const SETTING_ROLES = ['super_admin'] as const;

export interface WritableSetting {
  key: string;
  /** Shown beside the value; the screen must not hardcode its own copy. */
  labelKey: string;
  hintKey: string;
  /**
   * Normalises and refuses. Returns the value **as it will be stored**.
   *
   * `string | number` rather than `string` (2026-08-17): `SystemSetting.value` is
   * `Json` and §15.1 seeds the grading scale as a **number** (`20`, `5000`).
   * Coercing those to strings here would change the shape every existing reader
   * of `grading.*` expects — `readGradingScale` type-checks for `number` and
   * would silently fall back to its default, quietly ignoring the setting a
   * Super Admin had just changed.
   */
  validate: (value: unknown) => string | number;
  /** How the screen should render the control. Numbers are not free text. */
  kind: 'text' | 'integer';
}

/**
 * A stored `Json` value as the wire carries it.
 *
 * `SystemSetting.value` is `Json`, and the two kinds in use are a string (the
 * consent text version) and a number (the grading scale). Both are rendered as
 * **strings** on the wire so one control and one audit format serve both — the
 * *storage* keeps the number a number, which is what `readGradingScale` reads.
 * Anything else (an object, an array, `null`) is *not configured*.
 */
function settingValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * **An explicit allow-list, not "any key".**
 *
 * `SystemSetting` also holds category default visibilities and the grading
 * scale — different audiences, different consequences. Only what is named here
 * is reachable through this API; anything else is `NOT_FOUND`, so a typo
 * creates nothing and an unlisted key cannot be written by a client that
 * guesses at it.
 */
export const WRITABLE_SETTINGS: WritableSetting[] = [
  {
    key: CONSENT_TEXT_VERSION_KEY,
    labelKey: 'admin.settings.consentVersionLabel',
    hintKey: 'admin.settings.consentVersionHint',
    kind: 'text',
    validate: (value) => {
      if (typeof value !== 'string') {
        throw new AppError('VALIDATION_FAILED', 'consent text version must be a string', {
          issues: [{ path: 'value', message: 'expected a string' }],
        });
      }
      const trimmed = value.trim();
      // Blank is refused deliberately: a blank version would *look* configured
      // while reproducing the exact failure the setting exists to prevent —
      // registration refusing every applicant — and would be harder to
      // diagnose than an absent row, not easier.
      if (trimmed === '' || trimmed.length > 100) {
        throw new AppError('VALIDATION_FAILED', 'consent text version must be 1–100 characters', {
          issues: [{ path: 'value', message: 'must be between 1 and 100 characters' }],
        });
      }
      return trimmed;
    },
  },

];

/**
 * **`integerSetting` lived here and went with R81** (2026-08-19).
 *
 * It validated the two grading rows — the only integer settings there were — and
 * the Owner retired both. `kind: 'integer'` **stays** in the contract below: it
 * is a published field the settings screen renders on, and narrowing a contract
 * to remove an unused branch buys nothing while costing a client change. The
 * next integer setting brings its own validator back.
 */

export interface SettingRow {
  key: string;
  label_key: string;
  hint_key: string;
  /** `null` when never configured — distinct from an empty string, which is refused. */
  value: string | null;
  /** Which control the screen should render — see `SettingDto`. */
  kind: 'text' | 'integer';
  version: number;
}

/** `GET /admin/settings` — the writable settings and their current values. */
export async function listSettings(
  prisma: PrismaClient,
  /**
   * R60 — the full caller, not a bare id. The **active role** has to reach
   * `assertFreshActive` (which rebuilds from live rows and would otherwise hand
   * back this account's full authority) and the audit row (§60.8). Threading the
   * `Actor` rather than a second `activeRole` parameter keeps the two from
   * drifting apart, which is why the id alone is no longer enough.
   */
  caller: Actor,
): Promise<SettingRow[]> {
  await assertFreshActive(prisma, caller.userId, SETTING_ROLES, caller.activeRole);

  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: WRITABLE_SETTINGS.map((s) => s.key) } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  // Every writable setting is listed, configured or not. Omitting the unset
  // ones would hide exactly the row an operator needs to find.
  return WRITABLE_SETTINGS.map((definition) => {
    const row = byKey.get(definition.key);
    return {
      key: definition.key,
      label_key: definition.labelKey,
      hint_key: definition.hintKey,
      // **A number is a value too** (2026-08-17). This read `typeof === 'string'`,
      // so the grading scale — seeded as `20` — would have listed as `null` and
      // the screen would have shown *"not configured"* for a row that is.
      value: settingValue(row?.value),
      kind: definition.kind,
      version: row?.version ?? 0,
    };
  });
}

/**
 * `PUT /admin/settings/{key}` — set a value, audited.
 *
 * **Changing a setting affects FUTURE reads only** (Revision 42, normative).
 * Registration copies `legal.consent_text_version` onto each `ConsentRecord`
 * at the moment of agreement, so a change here never rewrites a stored
 * consent — §4.1a's requirement that each record carry the exact text agreed
 * to is what forbids it. Retroactively restamping would assert that people
 * agreed to text they never saw.
 */
export async function updateSetting(
  prisma: PrismaClient,
  caller: Actor,
  key: string,
  value: unknown,
  expectedVersion: number,
): Promise<SettingRow> {
  const actor = await assertFreshActive(prisma, caller.userId, SETTING_ROLES, caller.activeRole);

  const definition = WRITABLE_SETTINGS.find((s) => s.key === key);
  // §20 rule 17: an unreachable key is NOT_FOUND, never a 403 that would
  // confirm the key exists somewhere.
  if (!definition) throw new AppError('NOT_FOUND', `no writable setting named ${key}`);

  const normalized = definition.validate(value);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.systemSetting.findUnique({ where: { key } });
    const previous = settingValue(existing?.value);

    // TD-15: a stale version means another Super Admin changed it while this
    // form was open. Refusing beats silently overwriting their decision — and
    // for a consent text version, overwriting is a compliance question.
    const currentVersion = existing?.version ?? 0;
    if (existing && currentVersion !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'setting changed since it was read');
    }

    const saved = existing
      ? await tx.systemSetting.update({
          where: { key },
          data: { value: normalized, version: { increment: 1 }, updatedById: actor.userId },
        })
      : await tx.systemSetting.create({
          // `version: 1`, not the default 0. `listSettings` reports 0 for a
          // setting that has never been written, so leaving a freshly created
          // row at 0 would make "never configured" and "configured once"
          // indistinguishable — and a client holding the 0 it read *before* the
          // create would then pass the TD-15 check and silently overwrite.
          data: { key, value: normalized, version: 1, updatedById: actor.userId },
        });

    // TD-8: OLD **and** NEW. A row carrying only the new value cannot answer
    // "what text was in force when this person consented", which is the
    // question a compliance review actually asks.
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'setting.update',
      targetEntity: 'SystemSetting',
      // No `targetId`: a SystemSetting's identity IS its key, and it is a
      // VarChar primary key rather than the UUID `target_id` expects. The key
      // travels in `detail` where it can be read without a type lie.
      detail: { key, previous_value: previous, new_value: normalized },
    });

    return {
      key: saved.key,
      label_key: definition.labelKey,
      hint_key: definition.hintKey,
      // Rendered as the wire renders it; `normalized` is what was STORED, and
      // for an integer setting that is a number.
      value: settingValue(normalized),
      kind: definition.kind,
      version: saved.version,
    };
  });
}
