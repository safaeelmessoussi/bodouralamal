import { describe, expect, it } from 'vitest';

import { ApiError } from './api.js';
import { BLOCKED_BY_LABEL_KEYS, blockingDependencies } from './blocked-by.js';
import { t } from '../i18n/index.js';

/**
 * **NEW A — a blocked deletion is not a stale-state conflict.**
 *
 * TD-5 answers both with `409`, and the code catalogue gives `STATE_CONFLICT`
 * one message: *«…يرجى تحديث الصفحة»*. That is true of optimistic staleness and
 * **false** of a Branch a group still references — refreshing changes nothing,
 * so the action reads as broken. The discriminator is `details.blocked_by`,
 * which only a blocked deletion carries.
 */
const envelope = (code: string, details: Record<string, unknown>) =>
  new ApiError(409, {
    code,
    message_key: 'errors.state_conflict',
    message: 'تم تعديل هذا العنصر أو تغييرت حالته. يرجى تحديث الصفحة.',
    details,
    request_id: 'e3986e8e02bb5a1b27b27d0594f784bc',
  });

describe('the two things 409 was saying at once', () => {
  it('reads the Owner’s actual payload — a group and a schedule', () => {
    const blocking = blockingDependencies(
      envelope('STATE_CONFLICT', { blocked_by: { groups: 1, course_schedules: 1 } }),
    );
    expect(blocking).toEqual([
      { label: 'مجموعات إدارية', count: 1 },
      { label: 'جداول حصص', count: 1 },
    ]);
  });

  it('is NULL for a stale-version conflict, where refreshing IS the answer', () => {
    // The important half. A caller treating every 409 as blocked would invent
    // dependencies for a genuine VERSION_CONFLICT and hide the right advice.
    expect(blockingDependencies(envelope('VERSION_CONFLICT', { expected_version: 3 }))).toBeNull();
  });

  it('is NULL for a STATE_CONFLICT that carries no dependencies', () => {
    expect(blockingDependencies(envelope('STATE_CONFLICT', {}))).toBeNull();
  });

  it('is NULL for anything that is not an API error at all', () => {
    expect(blockingDependencies(new TypeError('offline'))).toBeNull();
    expect(blockingDependencies(null)).toBeNull();
  });

  it('drops a dependency reported as zero rather than listing it', () => {
    expect(
      blockingDependencies(envelope('STATE_CONFLICT', { blocked_by: { rooms: 0, groups: 2 } })),
    ).toEqual([{ label: 'مجموعات إدارية', count: 2 }]);
  });
});

describe('no backend key ever reaches the screen', () => {
  it('translates every label the five call sites can emit', () => {
    // The complete vocabulary of `assertNoBlockingReferences` across Category,
    // Subject, Level, Branch and Room. A key missing here would render as
    // `course_schedules` in front of an administrator.
    const emitted = [
      'rooms', 'groups', 'course_schedules', 'sessions', 'levels', 'subjects',
      'teaching_groups', 'exams', 'grades', 'content', 'events', 'enrollments',
      'pending_requests',
    ];
    const blocking = blockingDependencies(
      envelope('STATE_CONFLICT', {
        blocked_by: Object.fromEntries(emitted.map((key) => [key, 1])),
      }),
    );
    expect(blocking).toHaveLength(emitted.length);
    for (const dependency of blocking ?? []) {
      expect(dependency.label, dependency.label).not.toMatch(/[a-z_]/);
    }
  });

  it('every label key resolves to Arabic, never to the key itself', () => {
    for (const key of BLOCKED_BY_LABEL_KEYS) {
      expect(t(key), key).not.toBe(key);
    }
  });

  it('an UNKNOWN key is shown rather than silently dropped', () => {
    // Omitting it would tell somebody the record is deletable when it is not.
    const blocking = blockingDependencies(
      envelope('STATE_CONFLICT', { blocked_by: { something_new: 3 } }),
    );
    expect(blocking).toEqual([{ label: 'something_new', count: 3 }]);
  });
});
