import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';

/**
 * One privacy-safe digest per application table for the integration wrapper.
 *
 * The snapshot deliberately covers every `public` base table rather than a
 * hand-maintained fixture list. A list is how the next relationship escapes the
 * guard. `_prisma_migrations` is deployment metadata, not application state;
 * pg-boss lives in its own schema and is likewise outside this boundary.
 *
 * Creation/update timestamps are excluded because a whole-set operation may
 * have to snapshot and restore shared reference data in `finally` (R110's
 * reorder is the current example). Every logical field, version, relationship,
 * row count and primary key remains in the digest, so restoring only a count or
 * replacing a row still fails.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
  SELECT table_name AS "tableName"
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name <> '_prisma_migrations'
  ORDER BY table_name
`;

/**
 * **A guard that can produce nothing compares equal to itself.**
 *
 * The wrapper decides isolation with `cmp -s BEFORE AFTER`, and two empty files
 * are identical — so a snapshot that silently returned no rows would report
 * every run as clean. That is the fail-open shape this project has already
 * shipped three times in CI guards that depended on an absent `rg`. An empty
 * catalogue means the query, the schema or the connection is wrong, never that
 * the application has no tables.
 */
if (tables.length === 0) {
  throw new Error(
    'snapshot found no application tables — refusing to emit an empty state digest',
  );
}

try {
  for (const { tableName } of tables) {
    // The identifier comes from PostgreSQL's own catalogue. Quote it anyway so
    // a future mixed-case or reserved-word table cannot alter the query shape.
    const quoted = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await prisma.$queryRawUnsafe<
      Array<{ rowCount: bigint; digest: string }>
    >(`
      SELECT
        count(*)::bigint AS "rowCount",
        md5(
          COALESCE(
            string_agg(md5("logicalRow"::text), '' ORDER BY md5("logicalRow"::text)),
            ''
          )
        ) AS digest
      FROM (
        SELECT to_jsonb(t) - ARRAY['created_at', 'updated_at']::text[] AS "logicalRow"
        FROM ${quoted} AS t
      ) AS logical_rows
    `);
    const row = rows[0];
    if (!row) throw new Error(`could not snapshot table ${tableName}`);
    process.stdout.write(`${tableName}\t${row.rowCount.toString()}\t${row.digest}\n`);
  }
} finally {
  await prisma.$disconnect();
}
