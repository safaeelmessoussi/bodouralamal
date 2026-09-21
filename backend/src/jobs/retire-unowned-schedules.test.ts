import { describe, expect, it } from 'vitest';

import { retireUnownedSchedules } from './runner.js';

/**
 * Found by «حالة النظام» on its first reading (SRS Revision 169 §11): a cron
 * schedule lives in the DATABASE, so a release that removes a queue leaves its
 * schedule behind — creating, every night, a job no worker will ever take.
 */
function fakeBoss(schedules: string[], queueExists = true) {
  const calls: string[] = [];
  return {
    calls,
    getSchedules: async () => schedules.map((name) => ({ name })),
    unschedule: async (name: string) => void calls.push(`unschedule:${name}`),
    deleteQueuedJobs: async (name: string) => {
      calls.push(`deleteQueued:${name}`);
      if (!queueExists) throw new Error('queue does not exist');
    },
  };
}

describe('a schedule the code no longer owns is retired', () => {
  it('unschedules it and removes its never-started jobs — and touches nothing this release owns', async () => {
    const boss = fakeBoss(['token.purge', 'retention.educational-purge', 'upload.gc']);
    const logged: [string, Record<string, unknown>][] = [];
    const retired = await retireUnownedSchedules(boss, ['token.purge', 'upload.gc'], (q, d) => logged.push([q, d]));
    expect(retired).toEqual(['retention.educational-purge']);
    expect(boss.calls).toEqual([
      'unschedule:retention.educational-purge',
      'deleteQueued:retention.educational-purge',
    ]);
    expect(logged).toEqual([['retention.educational-purge', { schedule_retired: true }]]);
  });

  it('does nothing on an installation whose schedules are all current', async () => {
    const boss = fakeBoss(['token.purge']);
    expect(await retireUnownedSchedules(boss, ['token.purge'], () => undefined)).toEqual([]);
    expect(boss.calls).toEqual([]);
  });

  it('a queue that no longer exists has nothing to delete — that is not a failure, and the worker still starts', async () => {
    const boss = fakeBoss(['gone.queue'], false);
    await expect(retireUnownedSchedules(boss, [], () => undefined)).resolves.toEqual(['gone.queue']);
  });
});
