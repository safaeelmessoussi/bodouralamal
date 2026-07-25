// Boot entry. TD-13 fail-fast env validation runs before anything else — the
// process must refuse to start on a missing Required variable rather than fail
// later in a request.
import { createApp } from './app.js';
import { loadConfig } from './lib/config.js';
import { createPrismaClient } from './lib/prisma.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const app = createApp(prisma, config);

const server = app.listen(config.PORT, () => {
  process.stdout.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level: 'info',
      message: 'api listening',
      port: config.PORT,
      node_env: config.NODE_ENV,
    })}\n`,
  );
});

/** Container stop must drain in-flight requests, not sever them mid-transaction. */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
