import { defineConfig } from 'vitest/config';

// Default `npm test` runs unit tests only — they need no external services and
// gate every PR (§19.2). Integration tests that require the compose stack are
// excluded here and run via `npm run test:integration`, so a missing stack can
// never make a mandatory acceptance test silently "pass" by being skipped.
export default defineConfig({
  test: {
    // Seed policy has executable, side-effect-free guards of its own. Keep the
    // test beside the seed it protects and collect it here; otherwise a green
    // default run would silently omit the Platform Owner bootstrap gate.
    include: ['src/**/*.test.ts', 'prisma/seed/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
  },
});
