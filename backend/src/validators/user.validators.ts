import { z } from 'zod';

import { uuid, version } from './common.js';
import * as person from './person.js';

/**
 * Zod schemas for the user-management boundary (§5.6 `/admin/users`, §16.2).
 *
 * TD-9's column limits are encoded here and nowhere else in the request path.
 */

/**
 * **The person's own details, from the shared definitions** (2026-08-28).
 *
 * The back office asks for exactly what registration asks for, under exactly its
 * limits — see `validators/person.ts` for why the two had drifted apart.
 * Nullable where the field is genuinely optional and may be cleared.
 */
const nickname = person.nickname.nullable();
const phone = person.phone.nullable();
const optionalNamePart = person.namePart.nullable();

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
    /**
     * **R80.3 — COMPLETION of a missing sex, never correction.**
     *
     * The service refuses it when one is already recorded
     * (`SEX_ALREADY_RECORDED`): changing a recorded sex has consequences for
     * placements already made and is its own decision, which R80.4 declines to
     * introduce silently under the name of completion.
     */
    sex: z.enum(['female', 'male']).optional(),
    version,
    /**
     * **The parts, never the composed name** (§1.1, Revision 40).
     *
     * `name_arabic` and `name_french` were accepted here directly, which made
     * the client the authority on how a person's name reads — on the one screen
     * where a staff member retypes it. The server composes both from these, as
     * registration already does.
     */
    first_name_arabic: person.namePart.optional(),
    last_name_arabic: person.namePart.optional(),
    first_name_french: optionalNamePart.optional(),
    last_name_french: optionalNamePart.optional(),
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

/** A high-impact workflow requires an explicit, non-localised confirmation. */
export const transferPlatformOwnerSchema = z
  .object({
    target_user_id: uuid,
    confirmation: z.literal('TRANSFER_PLATFORM_OWNERSHIP'),
  })
  .strict();
