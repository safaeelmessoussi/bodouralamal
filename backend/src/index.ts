// Boot entry. TD-13 fail-fast env validation runs before anything else — the
// process must refuse to start on a missing Required variable rather than fail
// later in a request.
import { createApp } from './app.js';
import { createBoss, startJobRunner, stopJobRunner } from './jobs/runner.js';
import { JobRunnerReadiness } from './jobs/readiness.js';
import { loadConfig } from './lib/config.js';
import { createPrismaClient } from './lib/prisma.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const boss = createBoss(config);
const jobReadiness = new JobRunnerReadiness(boss);
const app = createApp(prisma, config, jobReadiness);

function log(message: string, detail: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), level: 'info', message, ...detail })}\n`,
  );
}

const server = app.listen(config.PORT, () => {
  log('api listening', { port: config.PORT, node_env: config.NODE_ENV });
});

// R-3: pg-boss workers run inside the API container, keeping the VPS container
// count and memory footprint low (§3.1).
const runnerStartup = startJobRunner(boss, prisma, config, jobReadiness);
void runnerStartup
  .then(() => log('job runner started'))
  .catch((error: unknown) => {
    // TD-16: enqueues keep succeeding even with workers down, because they are
    // DB inserts inside their transactions — jobs are delayed, never lost. So a
    // failed runner is loud but not fatal to the API.
    process.stderr.write(
      `${JSON.stringify({
        time: new Date().toISOString(),
        level: 'error',
        message: 'job runner failed to start',
        // Startup errors from PostgreSQL/pg-boss may embed connection strings,
        // credentials or internal paths. Their text never belongs in runtime
        // logs; readiness plus the fixed message identifies the failed stage.
        error_type: error instanceof Error ? 'exception' : 'unknown',
      })}\n`,
    );
  });

/** Container stop must drain in-flight requests and jobs, not sever them
 *  mid-transaction. */
let shutdownStarted = false;

async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;

  const httpClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  // Stop polling as soon as shutdown begins. If registration was still in
  // flight, wait for that one startup promise first so no handler can be added
  // after pg-boss has stopped.
  const jobsStopped = runnerStartup
    .catch(() => undefined)
    .then(() => stopJobRunner(boss, jobReadiness));

  const drains = await Promise.allSettled([httpClosed, jobsStopped]);
  let failed = drains.some((result) => result.status === 'rejected');
  try {
    await prisma.$disconnect();
  } catch {
    failed = true;
  }

  if (failed) {
    process.stderr.write(
      `${JSON.stringify({
        time: new Date().toISOString(),
        level: 'error',
        message: 'api graceful shutdown failed',
      })}\n`,
    );
  }
  process.exit(failed ? 1 : 0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}
