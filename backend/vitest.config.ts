import { defineConfig } from 'vitest/config';

// Default `npm test` runs unit tests only — they need no external services and
// gate every PR (§19.2). Integration tests that require the compose stack are
// excluded here and run via `npm run test:integration`, so a missing stack can
// never make a mandatory acceptance test silently "pass" by being skipped.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
  },
});
