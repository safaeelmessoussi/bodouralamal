import { describe, expect, it } from 'vitest';

import { JobRunnerReadiness, WORKER_FRESHNESS_MS } from './readiness.js';

function activity(
  name: string,
  overrides: Partial<{
    state: 'created' | 'active' | 'stopping' | 'stopped';
    count: number;
    createdOn: number;
    lastFetchedOn: number | null;
  }> = {},
) {
  return {
    name,
    state: 'active' as const,
    count: 0,
    createdOn: 1_000,
    lastFetchedOn: 1_000,
    ...overrides,
  };
}

function started(
  workers: string[],
  getWipData: () => ReturnType<typeof activity>[],
  clock: () => number,
): JobRunnerReadiness {
  const readiness = new JobRunnerReadiness({ getWipData }, clock);
  readiness.starting(workers);
  for (const worker of workers) readiness.workerRegistered(worker);
  readiness.ready();
  return readiness;
}

describe('job runner readiness', () => {
  it('does not call a runner healthy before startup begins', () => {
    const readiness = new JobRunnerReadiness({ getWipData: () => [] });

    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'not_started',
      expected_workers: 0,
      registered_workers: 0,
      active_workers: 0,
    });
  });

  it('is healthy only after the full expected catalog is registered and active', () => {
    const names = ['token.purge', 'audit.purge'];
    const readiness = started(
      names,
      () => names.map((name) => activity(name)),
      () => 1_000,
    );

    expect(readiness.snapshot()).toEqual({
      state: 'ok',
      reason: 'ready',
      expected_workers: 2,
      registered_workers: 2,
      active_workers: 2,
    });
  });

  it('fails startup when registration did not cover the expected catalog', () => {
    const readiness = new JobRunnerReadiness({ getWipData: () => [] });
    readiness.starting(['token.purge', 'audit.purge']);
    readiness.workerRegistered('token.purge');

    expect(() => readiness.ready()).toThrow(/complete worker catalog/);
    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'worker_registration_incomplete',
      expected_workers: 2,
      registered_workers: 1,
    });
  });

  it('keeps a runner startup failure machine-readable', () => {
    const readiness = new JobRunnerReadiness({ getWipData: () => [] });
    readiness.starting(['token.purge']);
    readiness.failed();

    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'startup_failed',
    });
  });

  it('detects an idle worker whose polling activity became stale', () => {
    let now = 1_000;
    const readiness = started(
      ['token.purge'],
      () => [activity('token.purge', { lastFetchedOn: 1_000 })],
      () => now,
    );

    now += WORKER_FRESHNESS_MS + 1;
    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'worker_stale',
      stale_workers: ['token.purge'],
    });
  });

  it('does not call a long-running handler stale while it is processing work', () => {
    let now = 1_000;
    const readiness = started(
      ['session-recording-ingest'],
      () => [
        activity('session-recording-ingest', {
          count: 1,
          lastFetchedOn: 1_000,
        }),
      ],
      () => now,
    );

    now += WORKER_FRESHNESS_MS * 10;
    expect(readiness.snapshot()).toMatchObject({
      state: 'ok',
      reason: 'ready',
    });
  });

  it('allows the initial fetch a bounded startup grace, then requires evidence', () => {
    let now = 1_000;
    const readiness = started(
      ['token.purge'],
      () => [activity('token.purge', { lastFetchedOn: null })],
      () => now,
    );

    expect(readiness.snapshot().state).toBe('ok');
    now += WORKER_FRESHNESS_MS + 1;
    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'worker_stale',
    });
  });

  it('detects a worker removed from pg-boss live work data', () => {
    const readiness = started(
      ['token.purge'],
      () => [],
      () => 1_000,
    );

    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'worker_missing',
      missing_workers: ['token.purge'],
    });
  });

  it('distinguishes an inactive worker from one missing from the registry', () => {
    const readiness = started(
      ['token.purge'],
      () => [activity('token.purge', { state: 'stopping' })],
      () => 1_000,
    );

    expect(readiness.snapshot()).toMatchObject({
      state: 'down',
      reason: 'worker_not_active',
      inactive_workers: ['token.purge'],
    });
  });

  it('reports a deliberately stopped runner as stopped', () => {
    const readiness = started(
      ['token.purge'],
      () => [activity('token.purge')],
      () => 1_000,
    );

    readiness.stopping();
    expect(readiness.snapshot().reason).toBe('stopping');
    readiness.stopped();
    expect(readiness.snapshot().reason).toBe('stopped');
  });
});
