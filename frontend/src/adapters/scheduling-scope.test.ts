import { describe, expect, it } from 'vitest';

import ADAPTER from './scheduling.ts?raw';
import ACTIVITY from '../components/scheduling/class-section.tsx?raw';

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **An event's scope crosses the wire in the API's own casing (R72).**
 *
 * The scheduling form built `{ branchIds: [...] }` and spread it straight into
 * an `EventInput` whose keys are `branch_ids` — and the server's schema is
 * `.strict()`, so **every branch-, category- and level-scoped event created
 * from that form was refused with 400**. Only the global case worked, because
 * `global` happens to be spelled the same in both.
 *
 * It is asserted at the source because the bug was invisible to every existing
 * test: the adapter compiled, the types were satisfied on both sides of the
 * spread, and no fixture exercised a scoped event through this path.
 */
describe('the event scope payload speaks snake_case', () => {
  it('maps every scope kind explicitly', () => {
    for (const key of ['branch_ids', 'category_ids', 'level_ids', 'group_ids']) {
      expect(code(ADAPTER)).toContain(key);
    }
  });

  it('does not spread the camelCase shape into the payload', () => {
    // The exact line that shipped the defect.
    expect(code(ADAPTER)).not.toContain('...(input.scope ?? { global: true })');
  });
});

/**
 * **`group` is a scope the server has always accepted and no form offered.**
 * It is also the ONLY one a Teacher may use (TD-2, §4.9), so without it R72's
 * capability would have been a control that could only be refused.
 */
describe('the activity form offers the group dimension', () => {
  it('lists it among the caller\'s independent dimensions', () => {
    expect(code(ACTIVITY)).toContain("'group'");
  });

  it('gives a Teacher that dimension and no other', () => {
    // Redesigned 2026-09-14: each dimension is now its own independent,
    // always-visible control (`ActivitySection`'s own doc comment) rather
    // than one of a single "choose ONE kind" select's options — but a
    // Teacher's own allowance is still exactly `['group']`, on the same
    // R72/§4.9 authority.
    const teacherDimensions = code(ACTIVITY).match(
      /TEACHER_SCOPE_DIMENSIONS: readonly ScopeDimensionKey\[\] = \[([\s\S]*?)\];/,
    );
    expect(teacherDimensions).not.toBeNull();
    expect(teacherDimensions![1]).toContain("'group'");
    for (const forbidden of ['branch', 'category', 'level']) {
      expect(teacherDimensions![1]).not.toContain(`'${forbidden}'`);
    }
  });
});
