import { describe, expect, it } from 'vitest';

// **The schema as a raw import, not `node:fs`.** The frontend tsconfig carries
// no Node types, and reaching for them here would add a whole type surface to
// this project for one file — the same reasoning `atomic-components.test.tsx`
// records for using `import.meta.glob` instead.
import SCHEMA from '../../../../backend/prisma/schema.prisma?raw';
import ADAPTER from '../../adapters/notifications.ts?raw';
import LIST from './notification-list.tsx?raw';
import { ar } from '../../i18n/ar.js';

/**
 * **Every notification type the SERVER can write must have Arabic words here.**
 *
 * `HEADLINE_KEYS` is a `Record` over the frontend union, so a type in the union
 * without a headline fails the type check. That closes half the gap. The other
 * half is what this file exists for: **the union itself is hand-maintained**, so
 * a new value in the Prisma enum that nobody adds to the union compiles happily
 * and renders through whatever the list does with an unknown type.
 *
 * This project has already shipped that exact defect once — a chain of ternaries
 * fell through to *cancelled*, so a class that MOVED would have been announced
 * as one called off. The `Record` was the fix; **reading the enum is what makes
 * it complete**.
 */
/** The enum as the database defines it — comments and blank lines stripped. */
function backendTypes(): string[] {
  const block = /enum NotificationType \{([\s\S]*?)\n\}/.exec(SCHEMA);
  if (!block) throw new Error('NotificationType enum not found in schema.prisma');
  return block[1]!
    .split('\n')
    .map((line) => line.replace(/\/\/\/.*/, '').trim())
    .filter((line) => /^[a-z_]+$/.test(line));
}

/** The union as the client declares it. */
function frontendTypes(): string[] {
  const block = /export type NotificationType =([\s\S]*?);/.exec(ADAPTER);
  if (!block) throw new Error('NotificationType union not found in the adapter');
  return [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('the server’s types and the client’s union agree', () => {
  it('finds both, so this guard cannot pass by reading nothing', () => {
    // The tell of a vacuous guard is one that has never failed. Both sides must
    // be non-empty before any comparison means anything.
    expect(backendTypes().length).toBeGreaterThan(4);
    expect(frontendTypes().length).toBeGreaterThan(4);
  });

  it('every type the database can store is one the client can name', () => {
    const missing = backendTypes().filter((t) => !frontendTypes().includes(t));
    expect(missing).toEqual([]);
  });

  it('and the client claims none the database cannot store', () => {
    const invented = frontendTypes().filter((t) => !backendTypes().includes(t));
    expect(invented).toEqual([]);
  });
});

describe('every type has Arabic words, and none falls through', () => {
  it('has a headline key per type', () => {
    for (const type of backendTypes()) {
      expect(LIST, `no headline for ${type}`).toContain(`${type}: 'notifications.`);
    }
  });

  it('and every one of those keys resolves to Arabic', () => {
    const keys = [...LIST.matchAll(/[a-z_]+: '(notifications\.[A-Za-z]+)'/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(4);
    for (const key of keys) {
      const value = key
        .split('.')
        .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], ar);
      expect(typeof value, key).toBe('string');
      // `t()` returns its own argument on a miss, so a typo ships as the key
      // itself — the failure rule X exists for.
      expect(value).not.toBe(key);
    }
  });

  it('renders no fallback that could stand in for a missing type', () => {
    // A `??` or a default branch would silently restore the defect the Record
    // was introduced to remove.
    expect(LIST).not.toMatch(/HEADLINE_KEYS\[[^\]]+\]\s*\?\?/);
  });
});
