import { defineConfig } from 'vitest/config';

// Integration suite: requires the compose stack (nginx + minio, and later
// PostgreSQL). Kept separate from the unit run so its prerequisites are
// explicit and failures are loud rather than skipped (§19.2).
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
