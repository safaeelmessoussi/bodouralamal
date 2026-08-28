import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../lib/errors.js';
import * as users from '../repositories/user.repository.js';
import { assertStaffAccountsAvailable } from './staffing-integrity.service.js';

describe('staffing account integrity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates and locks every User globally in deterministic UUID order', async () => {
    const first = '00000000-0000-4000-8000-000000000001';
    const second = '00000000-0000-4000-8000-000000000002';
    const locked: string[] = [];
    vi.spyOn(users, 'lockUser').mockImplementation(async (_tx, id) => {
      locked.push(id);
      return true;
    });
    const findMany = vi.fn().mockResolvedValue([{ id: first }, { id: second }]);

    await assertStaffAccountsAvailable(
      { user: { findMany } } as never,
      [second, first, second],
    );

    expect(locked).toEqual([first, second]);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: { in: [first, second] },
        deletedAt: null,
        accountStatus: 'active',
      },
      select: { id: true },
    });
  });

  it('refuses before the state query when any governing User row is absent', async () => {
    vi.spyOn(users, 'lockUser').mockResolvedValue(false);
    const findMany = vi.fn();

    const error = await assertStaffAccountsAvailable(
      { user: { findMany } } as never,
      ['00000000-0000-4000-8000-000000000001'],
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'STAFF_ACCOUNT_UNAVAILABLE' },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('refuses atomically when a locked account is not live and active', async () => {
    vi.spyOn(users, 'lockUser').mockResolvedValue(true);
    const findMany = vi.fn().mockResolvedValue([]);

    const error = await assertStaffAccountsAvailable(
      { user: { findMany } } as never,
      ['00000000-0000-4000-8000-000000000001'],
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'STATE_CONFLICT',
      details: { reason: 'STAFF_ACCOUNT_UNAVAILABLE' },
    });
  });
});
