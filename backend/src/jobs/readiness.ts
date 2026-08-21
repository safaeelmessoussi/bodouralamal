import type { WipData } from 'pg-boss';

/**
 * pg-boss polls an idle queue every two seconds by default. Fifteen seconds
 * allows several missed polls and one database statement timeout without
 * declaring a healthy worker dead, while still making a lost runner visible
 * promptly through `/healthz` (TD-14 / TD-16).
 */
export const WORKER_FRESHNESS_MS = 15_000;

type RunnerPhase =
  | 'not_started'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopping'
  | 'stopped';

export type JobReadinessReason =
  | 'ready'
  | 'not_started'
  | 'starting'
  | 'startup_failed'
  | 'worker_registration_incomplete'
  | 'worker_registry_unavailable'
  | 'worker_missing'
  | 'worker_not_active'
  | 'worker_stale'
  | 'stopping'
  | 'stopped';

type WorkerActivity = Pick<
  WipData,
  'name' | 'state' | 'count' | 'createdOn' | 'lastFetchedOn'
>;

export interface WorkerInspector {
  getWipData(): readonly WorkerActivity[];
}

export interface JobReadinessSnapshot {
  readonly state: 'ok' | 'down';
  readonly reason: JobReadinessReason;
  readonly expected_workers: number;
  readonly registered_workers: number;
  readonly active_workers: number;
  readonly missing_workers?: readonly string[];
  readonly inactive_workers?: readonly string[];
  readonly stale_workers?: readonly string[];
}

type Clock = () => number;

/**
 * Process-local readiness for the process-local worker runner (SRS R-3).
 *
 * The queue schema answers whether durable queue infrastructure exists. This
 * class answers the different question the old health check could not: did
 * this API process start its expected workers, and are those workers still
 * polling or actively handling work?
 */
export class JobRunnerReadiness {
  private phase: RunnerPhase = 'not_started';
  private failureReason: Extract<
    JobReadinessReason,
    'startup_failed' | 'worker_registration_incomplete'
  > = 'startup_failed';
  private expectedWorkers: readonly string[] = [];
  private readonly registeredWorkers = new Set<string>();
  private readyAt: number | null = null;

  constructor(
    private readonly inspector: WorkerInspector,
    private readonly clock: Clock = Date.now,
    private readonly freshnessMs = WORKER_FRESHNESS_MS,
  ) {}

  starting(workerNames: readonly string[]): void {
    if (workerNames.length === 0) {
      throw new Error('worker catalog must contain at least one handler');
    }
    const unique = new Set(workerNames);
    if (unique.size !== workerNames.length) {
      throw new Error('worker catalog contains duplicate queue names');
    }

    this.phase = 'starting';
    this.failureReason = 'startup_failed';
    this.expectedWorkers = [...workerNames];
    this.registeredWorkers.clear();
    this.readyAt = null;
  }

  workerRegistered(workerName: string): void {
    if (this.phase === 'starting') this.registeredWorkers.add(workerName);
  }

  ready(): void {
    const missing = this.expectedWorkers.filter(
      (worker) => !this.registeredWorkers.has(worker),
    );
    if (missing.length > 0) {
      this.phase = 'failed';
      this.failureReason = 'worker_registration_incomplete';
      throw new Error('job runner did not register its complete worker catalog');
    }

    this.phase = 'ready';
    this.readyAt = this.clock();
  }

  failed(): void {
    if (this.phase !== 'failed') {
      this.phase = 'failed';
      this.failureReason = 'startup_failed';
    }
  }

  stopping(): void {
    this.phase = 'stopping';
  }

  stopped(): void {
    this.phase = 'stopped';
  }

  snapshot(): JobReadinessSnapshot {
    if (this.phase !== 'ready') {
      const reason =
        this.phase === 'failed'
          ? this.failureReason
          : this.phase;
      return this.down(reason, this.countActiveWorkers());
    }

    let activity: readonly WorkerActivity[];
    try {
      activity = this.inspector.getWipData();
    } catch {
      return this.down('worker_registry_unavailable', 0);
    }

    const now = this.clock();
    const inStartupGrace =
      this.readyAt !== null && now - this.readyAt <= this.freshnessMs;
    const missing: string[] = [];
    const inactive: string[] = [];
    const stale: string[] = [];
    let activeWorkers = 0;

    for (const expected of this.expectedWorkers) {
      const workers = activity.filter((worker) => worker.name === expected);
      if (workers.length === 0) {
        missing.push(expected);
        continue;
      }

      const active = workers.filter((worker) => worker.state === 'active');
      if (active.length === 0) {
        inactive.push(expected);
        continue;
      }
      activeWorkers += 1;

      const hasFreshWorker = active.some(
        (worker) =>
          worker.count > 0 ||
          (worker.lastFetchedOn !== null &&
            now - worker.lastFetchedOn <= this.freshnessMs) ||
          (worker.lastFetchedOn === null && inStartupGrace),
      );
      if (!hasFreshWorker) stale.push(expected);
    }

    if (missing.length > 0) {
      return this.down('worker_missing', activeWorkers, {
        missing_workers: missing,
      });
    }
    if (inactive.length > 0) {
      return this.down('worker_not_active', activeWorkers, {
        inactive_workers: inactive,
      });
    }
    if (stale.length > 0) {
      return this.down('worker_stale', activeWorkers, {
        stale_workers: stale,
      });
    }

    return {
      state: 'ok',
      reason: 'ready',
      expected_workers: this.expectedWorkers.length,
      registered_workers: this.registeredWorkers.size,
      active_workers: activeWorkers,
    };
  }

  private down(
    reason: Exclude<JobReadinessReason, 'ready'>,
    activeWorkers: number,
    detail: Pick<
      JobReadinessSnapshot,
      'missing_workers' | 'inactive_workers' | 'stale_workers'
    > = {},
  ): JobReadinessSnapshot {
    return {
      state: 'down',
      reason,
      expected_workers: this.expectedWorkers.length,
      registered_workers: this.registeredWorkers.size,
      active_workers: activeWorkers,
      ...detail,
    };
  }

  private countActiveWorkers(): number {
    try {
      const activity = this.inspector.getWipData();
      return this.expectedWorkers.filter((expected) =>
        activity.some(
          (worker) => worker.name === expected && worker.state === 'active',
        ),
      ).length;
    } catch {
      return 0;
    }
  }
}
