import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 reads the datasource URL from here rather than from schema.prisma.
// DATABASE_URL comes from the TD-13 inventory (repo-root .env).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
