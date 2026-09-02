import { describe, expect, it } from 'vitest';

import PAGE from './scheduling-types.tsx?raw';
import { AVAILABLE_TYPES } from '../../adapters/scheduling-types.js';

/**
 * **أنواع الجدولة offers every structural kind the domain has** (R110(9),
 * Owner 2026-09-02).
 *
 * The omission this pins: `holiday` reached the enum, the migration, the seed,
 * the write boundary and the label map, and the create form's option list alone
 * still read `['class', 'activity', 'exam']`. So a Super Admin could *see* a
 * عطلة row in the catalogue and had no way to create a second one — the
 * complete-capability-with-no-reach shape (rule P), and the seventh instance.
 *
 * **Asserted against the source, not against a render**, because the defect was
 * a literal array: a rendering test would need the option list to be reachable
 * from the outside, and it is a prop built inline.
 */
describe('the create form offers every structural kind', () => {
  it('lists all four, holiday included', () => {
    const list = /\(\[([^\]]*)\] as SchedulingType\[\]\)/.exec(PAGE)?.[1];
    expect(list).toBeDefined();
    const offered = [...list!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(offered).toEqual(['activity', 'class', 'exam', 'holiday']);
  });

  /**
   * **The list cannot drift from the adapter's own vocabulary.** Pinning the
   * four literals above says *these four*; this says *and no kind was added to
   * the domain without reaching this form* — which is the failure that actually
   * happened, one revision after `holiday` was introduced.
   */
  it('offers exactly what the adapter declares available', () => {
    const list = /\(\[([^\]]*)\] as SchedulingType\[\]\)/.exec(PAGE)?.[1];
    const offered = [...list!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(offered).toEqual([...AVAILABLE_TYPES].sort());
  });
});
