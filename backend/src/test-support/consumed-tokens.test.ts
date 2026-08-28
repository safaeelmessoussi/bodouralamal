import { describe, expect, it, vi } from 'vitest';

import {
  clearOwnedConsumedTokens,
  ownedOnboardingTokens,
} from './consumed-tokens.js';

describe('owned onboarding-token cleanup', () => {
  it('targets exact issued JTIs and never infers ownership from database state', async () => {
    const owned = ownedOnboardingTokens();
    const first = owned.issue(
      { email: 'first@example.com', providerSubjectId: 'first' },
      'test-key-that-is-long-enough',
    );
    const second = owned.issue(
      { email: 'second@example.com', providerSubjectId: 'second' },
      'test-key-that-is-long-enough',
    );
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });

    await clearOwnedConsumedTokens(
      { consumedToken: { deleteMany } } as never,
      owned,
    );

    expect(deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        jti: { in: [first.claims.jti, second.claims.jti] },
      },
    });
    expect(owned.issuedJtis.size).toBe(0);
  });

  it('does not turn an empty ownership set into a mass-delete predicate', async () => {
    const deleteMany = vi.fn();

    await clearOwnedConsumedTokens(
      { consumedToken: { deleteMany } } as never,
      ownedOnboardingTokens(),
    );

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('retains ownership coordinates when cleanup fails so teardown can retry', async () => {
    const owned = ownedOnboardingTokens();
    const issued = owned.issue(
      { email: 'retry@example.com', providerSubjectId: 'retry' },
      'test-key-that-is-long-enough',
    );
    const deleteMany = vi.fn().mockRejectedValue(new Error('database unavailable'));

    await expect(
      clearOwnedConsumedTokens(
        { consumedToken: { deleteMany } } as never,
        owned,
      ),
    ).rejects.toThrow('database unavailable');
    expect(owned.issuedJtis).toEqual(new Set([issued.claims.jti]));
  });
});
