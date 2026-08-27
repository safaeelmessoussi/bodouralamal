import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * **Delete the onboarding tokens THIS suite consumed, not every one in the
 * database** (2026-08-27).
 *
 * Four registration/approval suites tore down with
 * `consumedToken.deleteMany({ where: { purpose: 'onboarding' } })`. That reads
 * as scoped — it names a purpose — and is not: it removes every onboarding
 * token there is, including the ones a developer's own half-finished
 * registration is holding. The isolation guard reported it as
 * `consumed_token 14 → 0`.
 *
 * `ConsumedToken` is a **replay guard**: a row means *this token has been
 * spent*. Deleting somebody else's row does not tidy anything, it makes a spent
 * token replayable — which is the one thing the table exists to prevent.
 *
 * The pattern is the same one `consent-setting.ts` records for a shared
 * setting: **capture what was there, and touch only what you added.**
 */
export interface SavedConsumedTokens {
  readonly preExisting: ReadonlySet<string>;
}

export async function captureConsumedTokens(
  prisma: Pick<PrismaClient, 'consumedToken'>,
): Promise<SavedConsumedTokens> {
  const rows = await prisma.consumedToken.findMany({ select: { jti: true } });
  return { preExisting: new Set(rows.map((r) => r.jti)) };
}

/**
 * Removes every onboarding token that was **not** there when the suite started.
 *
 * `notIn` on an empty list is a filter that matches everything, which is the
 * exact shape P1.2 was: guarded explicitly rather than relied upon.
 */
export async function clearConsumedTokensAddedSince(
  prisma: Pick<PrismaClient, 'consumedToken'>,
  saved: SavedConsumedTokens,
): Promise<void> {
  const keep = [...saved.preExisting];
  await prisma.consumedToken.deleteMany({
    where: {
      purpose: 'onboarding',
      ...(keep.length > 0 ? { jti: { notIn: keep } } : {}),
    },
  });
}
