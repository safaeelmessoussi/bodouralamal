import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertTestOwnershipTag } from './educational-fixture.js';

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

function ownershipSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...ownershipSourceFiles(path));
    else if (
      entry.name.endsWith('.integration.test.ts') ||
      (directory.includes(`${join('src', 'test-support')}`) &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts'))
    ) {
      files.push(path);
    }
  }
  return files;
}

/** Extract balanced `.deleteMany(...)` arguments without being fooled by a
 * parenthesis in a string or comment. This is source governance, not a parser:
 * it answers only the one shape this guard owns. */
export function deleteManyArguments(source: string): string[] {
  const needle = '.deleteMany(';
  const argumentsFound: string[] = [];
  let searchFrom = 0;

  while (true) {
    const call = source.indexOf(needle, searchFrom);
    if (call === -1) return argumentsFound;
    const start = call + needle.length;
    let depth = 1;
    let state: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' =
      'code';
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index]!;
      const next = source[index + 1];

      if (state === 'line-comment') {
        if (char === '\n') state = 'code';
        continue;
      }
      if (state === 'block-comment') {
        if (char === '*' && next === '/') {
          state = 'code';
          index += 1;
        }
        continue;
      }
      if (state !== 'code') {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (
          (state === 'single' && char === "'") ||
          (state === 'double' && char === '"') ||
          (state === 'template' && char === '`')
        ) {
          state = 'code';
        }
        continue;
      }

      if (char === '/' && next === '/') {
        state = 'line-comment';
        index += 1;
      } else if (char === '/' && next === '*') {
        state = 'block-comment';
        index += 1;
      } else if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'template';
      else if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          argumentsFound.push(source.slice(start, index));
          searchFrom = index + 1;
          break;
        }
      }
    }

    if (depth !== 0) throw new Error('unbalanced deleteMany call in integration source');
  }
}

describe('integration test ownership boundaries', () => {
  it('never lets an undefined or absent predicate erase a mass-delete boundary', () => {
    const unsafe: string[] = [];
    for (const file of ownershipSourceFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      const source = readFileSync(file, 'utf8');
      for (const args of deleteManyArguments(source)) {
        if (!/\bwhere\s*:/.test(args)) unsafe.push(`${relative}: deleteMany without where`);
        if (/\bundefined\b/.test(args)) unsafe.push(`${relative}: undefined inside deleteMany`);
      }
    }
    expect(unsafe).toEqual([]);
  });

  /**
   * **The guard above has never failed, and that is exactly what has to be
   * disproved.**
   *
   * Its first assertion reads the real tree and expects `[]`. A detector that
   * matched nothing at all — a broken scanner, a rule that never fires, a file
   * walk that returns no files — would satisfy that assertion perfectly and
   * report a clean repository forever. This project has shipped three CI guards
   * with precisely that property.
   *
   * So the detector is aimed at the two constructs it exists for, and required
   * to report them; and at their safe counterparts, and required to stay quiet.
   * Without the second half the first proves only that it is noisy.
   */
  it('actually FIRES on the constructs it exists to catch', () => {
    /**
     * **Assembled, not written out.** `check-prisma-mass-write.sh` scans this
     * tree for exactly these shapes and would — correctly — report a literal
     * one here as a real defect. A fixture must be readable to the detector
     * under test without being a mass-write in the source it lives in, so the
     * dangerous token is joined at runtime.
     */
    const IGNORABLE = ['unde', 'fined'].join('');
    const unsafeAbsentWhere = `await prisma.session.deleteMany();`;
    const unsafeUndefined =
      `await prisma.courseScheduleStaff.deleteMany({ where: { userId: actorUserId ?? ${IGNORABLE} } });`;

    const flag = (source: string) => {
      const found: string[] = [];
      for (const args of deleteManyArguments(source)) {
        if (!/\bwhere\s*:/.test(args)) found.push('absent-where');
        if (/\bundefined\b/.test(args)) found.push('undefined');
      }
      return found;
    };

    // The original P1.2 defect, verbatim, must be reported.
    expect(flag(unsafeUndefined)).toContain('undefined');
    expect(flag(unsafeAbsentWhere)).toContain('absent-where');

    // And the safe shapes must not be, or the guard would be unusable and would
    // be relaxed rather than obeyed.
    expect(flag(`await prisma.branch.deleteMany({ where: { id: { in: ids } } });`)).toEqual([]);
    expect(
      flag(`await prisma.user.deleteMany({ where: { nameArabic: { startsWith: TAG } } });`),
    ).toEqual([]);

    // The scanner claims to survive parentheses inside strings and comments.
    // Asserted, because a scanner that lost its place would silently stop
    // reporting everything after the first such call.
    const tricky = [
      `await prisma.x.deleteMany({ where: { name: { startsWith: "a)b" } } });`,
      `// deleteMany( in a comment`,
      `await prisma.y.deleteMany({ where: { id: ${IGNORABLE} } });`,
    ].join('\n');
    expect(flag(tricky)).toEqual(['undefined']);
  });

  it('requires a narrow, reserved scenario namespace before tag-based cleanup', () => {
    expect(() => assertTestOwnershipTag('[branch-perm-test]')).not.toThrow();
    expect(() => assertTestOwnershipTag('[branch-perm-test] سياق')).not.toThrow();
    expect(() => assertTestOwnershipTag('[consent-safeguard]')).not.toThrow();
    for (const tag of ['', ' ', '[]', '[x]', '[unterminated', 'not-bracketed', '[تجريبي]']) {
      expect(() => assertTestOwnershipTag(tag), tag).toThrow(/unsafe test ownership tag/);
    }
  });
});
