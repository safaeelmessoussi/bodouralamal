import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { requireActor } from '../middleware/authenticate.js';
import { getOwnProfile, updateOwnProfile } from '../services/profile.service.js';
import { parse } from './parse.js';

/**
 * `GET /profile` and `PATCH /profile` — the personal section's contract
 * (TD-3.1, §5.2, Revision 65).
 *
 * **Role-independent by construction.** No role is read and none is required:
 * §5.2 places `/profile` under *Shared / Cross-Role*, and a مؤطِّرة editing her
 * own phone number is not acting in any capacity — she is a person with an
 * account. `/me` answers *which account is this*; this answers *who is the
 * person behind it*, and R63 already recorded why those stay separate surfaces.
 *
 * **No id, anywhere.** The subject is the JWT `sub`.
 */

/** TD-9's limits, at the boundary where §16.2 puts validation. */
const patchSchema = z
  .object({
    /** TD-9: digits, `+` and spaces. Non-unique — families share phones. */
    phone: z
      .string()
      .trim()
      .min(5)
      .max(20)
      .regex(/^[0-9+ ]+$/)
      .nullable()
      .optional(),
    nickname: z.string().trim().min(1).max(60).nullable().optional(),
    /** TD-15: the version the caller loaded. A stale one is a `409`. */
    version: z.number().int().nonnegative(),
  })
  .strict();

function dto(profile: Awaited<ReturnType<typeof getOwnProfile>>) {
  return {
    id: profile.id,
    name_arabic: profile.nameArabic,
    name_french: profile.nameFrench,
    nickname: profile.nickname,
    phone: profile.phone,
    email: profile.email,
    sex: profile.sex,
    account_status: profile.accountStatus,
    reference_code: profile.referenceCode,
    version: profile.version,
  };
}

export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    res.json(dto(await getOwnProfile(prisma, actor.userId)));
  };
}

export function update(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    // The SHARED parser, not `schema.parse`: a raw `ZodError` escapes as a 500,
    // so a body naming a field this endpoint refuses answered *server error*
    // instead of *that field is not accepted* — which is the whole point of
    // refusing it rather than ignoring it. Caught by the test that sends one.
    const { version, ...fields } = parse(patchSchema, req.body ?? {});
    const updated = await updateOwnProfile(
      prisma,
      { userId: actor.userId, activeRole: actor.activeRole ?? null },
      version,
      fields,
    );
    res.json(dto(updated));
  };
}
