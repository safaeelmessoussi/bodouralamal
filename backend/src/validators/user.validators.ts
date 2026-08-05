import { z } from 'zod';

import { uuid, version } from './common.js';

/**
 * Zod schemas for the user-management boundary (§5.6 `/admin/users`, §16.2).
 *
 * TD-9's column limits are encoded here and nowhere else in the request path.
 */

/** TD-9: `name_arabic` is 1–120. */
const nameArabic = z.string().trim().min(1).max(120);
/** Nullable — an optional name the person may clear. */
const nameFrench = z.string().trim().min(1).max(120).nullable();
const nickname = z.string().trim().min(1).max(60).nullable();
const phone = z
  .string()
  .trim()
  .min(5)
  .max(20)
  .regex(/^[0-9+ ]+$/, 'digits, + and spaces only')
  .nullable();

/**
 * **`.strict()`, and the refused keys are the point.**
 *
 * `account_status` is refused rather than dropped: suspension carries TD-4.15's
 * obligation to revoke every live session in the same transaction, and a client
 * that set the field here and received `200` would believe access had been
 * withdrawn when a 30-day credential was still live. `pre_provisioned_email` is
 * refused because it authorises *claiming* an account (§7 R15), and
 * `public_display_name` because §20 rule 21 resolves the published identity
 * server-side.
 */
export const updateUserSchema = z
  .object({
    version,
    name_arabic: nameArabic.optional(),
    name_french: nameFrench.optional(),
    nickname: nickname.optional(),
    phone: phone.optional(),
  })
  .strict();

/** TD-9: 500 characters, and blank is refused — a suspension with no stated
 *  reason is indistinguishable later from one whose reason was lost. */
export const suspendUserSchema = z.object({
  version,
  reason: z.string().trim().min(1).max(500),
});

export const reactivateUserSchema = z.object({ version });

/**
 * The **complete** set of assignments the user should hold afterwards.
 *
 * `branch_id: null` means **all branches for that assignment** (§7 R24), never
 * *no branch* — which is why it is a required, explicitly nullable key rather
 * than an optional one: omitting it and meaning "unscoped" would make the
 * unscoped grant the easiest thing to type by accident.
 */
export const setUserRolesSchema = z.object({
  assignments: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(40),
        branch_id: uuid.nullable(),
      }),
    )
    .max(20),
});
