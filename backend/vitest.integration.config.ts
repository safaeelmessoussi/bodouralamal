import { defineConfig } from 'vitest/config';

// Integration suite: requires the compose stack (nginx + minio, and later
// PostgreSQL). Kept separate from the unit run so its prerequisites are
// explicit and failures are loud rather than skipped (§19.2).
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These suites share ONE real database and mutate global rows (the
    // `legal.consent_text_version` setting, seeded fixtures). Running files in
    // parallel makes them race each other rather than test the system — one
    // file's teardown pulled a setting out from under another file's fixture.
    // Serial execution is the honest configuration for a shared-database suite;
    // the whole run is a few seconds, so there is nothing to gain by racing.
    fileParallelism: false,
  },
});
