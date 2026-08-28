import type { PrismaClient } from '../generated/prisma/client.js';
import {
  issueOnboardingToken,
  type OnboardingClaims,
} from '../lib/onboarding-token.js';

/**
 * **Delete the onboarding tokens THIS suite issued and consumed, not every one
 * that appeared in the database while the suite was running.**
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
 * A before/after database snapshot is still too broad: a real registration
 * completed while a long integration sweep is running also appears "new" and
 * deleting its replay guard makes that real token reusable. Ownership is known
 * at issue time, so record the exact random JTIs instead of inferring it later.
 */
export interface OwnedOnboardingTokens {
  readonly issuedJtis: Set<string>;
  issue(
    identity: { email: string; providerSubjectId: string },
    key: string,
    now?: Date,
  ): { token: string; claims: OnboardingClaims };
}

export function ownedOnboardingTokens(): OwnedOnboardingTokens {
  const issuedJtis = new Set<string>();
  return {
    issuedJtis,
    issue(identity, key, now) {
      const issued = issueOnboardingToken(identity, key, now);
      issuedJtis.add(issued.claims.jti);
      return issued;
    },
  };
}

/**
 * Removes only exact JTIs issued by this suite. A token may have failed before
 * consumption; deleting a nonexistent exact coordinate is intentionally safe.
 */
export async function clearOwnedConsumedTokens(
  prisma: Pick<PrismaClient, 'consumedToken'>,
  owned: OwnedOnboardingTokens,
): Promise<void> {
  const jtis = [...owned.issuedJtis];
  if (jtis.length === 0) return;
  await prisma.consumedToken.deleteMany({
    where: { jti: { in: jtis } },
  });
  owned.issuedJtis.clear();
}
