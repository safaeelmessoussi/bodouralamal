import { describe, expect, it } from 'vitest';

import type {
  AdministrativeGroup,
  RosterEntry,
} from '../../adapters/administrative-groups.js';

/**
 * `/admin/groups` — the client half of the contract guard.
 *
 * `api<T>()` is an unchecked cast, so an adapter naming a field the API never
 * sends compiles and fails only in a browser. `WIRE` below is written with the
 * key set the server test pins and typed as the adapter's interface, so a rename
 * on either side is a typecheck failure here.
 */
const WIRE: AdministrativeGroup = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'المجموعة ١',
  level_id: '00000000-0000-4000-8000-000000000002',
  branch_id: '00000000-0000-4000-8000-000000000003',
  display_order: 1,
  member_count: 3,
  version: 0,
};

const ROSTER: RosterEntry = {
  id: '00000000-0000-4000-8000-000000000004',
  student_id: '00000000-0000-4000-8000-000000000005',
  name: 'طالبة',
  enrolled_at: '2026-08-05T09:00:00.000Z',
};

describe('the adapter types match the wire contract', () => {
  it('a group carries exactly the seven documented keys', () => {
    expect(Object.keys(WIRE).sort()).toEqual([
      'branch_id',
      'display_order',
      'id',
      'level_id',
      'member_count',
      'name',
      'version',
    ]);
  });

  it('carries nothing that belongs to delivery (§20 rule 22, BR-23)', () => {
    // The whole point of Revision 43's split. A capacity field here would let a
    // screen imply a limit the platform does not record.
    for (const retired of [
      'max_students',
      'capacity',
      'room_id',
      'teacher_id',
      'assistant_id',
      'day_of_week',
      'start_time',
    ]) {
      expect(WIRE).not.toHaveProperty(retired);
    }
  });

  it('a roster entry’s id is the ENROLMENT, not the student', () => {
    // They are different rows and different meanings: `id` is what identifies
    // the enrolment, while DELETE addresses the student. Confusing them is a
    // bug the type cannot catch, so it is asserted.
    expect(Object.keys(ROSTER).sort()).toEqual(['enrolled_at', 'id', 'name', 'student_id']);
    expect(ROSTER.id).not.toBe(ROSTER.student_id);
  });
});
