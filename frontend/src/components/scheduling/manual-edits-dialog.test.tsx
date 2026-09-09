import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ScheduleSession } from '../../adapters/sessions.js';
import { ManualEditsDialog, sessionsEligibleForOverwrite } from './manual-edits-dialog.js';

/**
 * **R138 §4.4 item 5 — the shared preserve-vs-overwrite question**, and the
 * eligibility filter that decides whether it is asked at all.
 *
 * One component, one filter, two callers (`schedule-sessions.tsx`'s wider
 * scopes and `scheduling.tsx`'s series editor) — item 6's explicit "do not
 * maintain two competing implementations for 'all Sessions'" is what this
 * file is pinning.
 */
function session(overrides: Partial<ScheduleSession>): ScheduleSession {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    date: '2026-06-16',
    start_time: '15:00',
    end_time: '17:00',
    status: 'scheduled',
    title: 'حصة',
    description: null,
    overridden: false,
    room_id: null,
    delivery_mode: 'in_person',
    online_media_mode: null,
    visibility: 'public',
    version: 0,
    staff: [],
    protected_reasons: [],
    ...overrides,
  };
}

describe('sessionsEligibleForOverwrite — the Session-level, not field-level, filter', () => {
  it('includes a Session protected for OVERRIDDEN alone', () => {
    const rows = [session({ protected_reasons: ['OVERRIDDEN'] })];
    expect(sessionsEligibleForOverwrite(rows)).toHaveLength(1);
  });

  it('excludes a Session the wider scope would already have touched (no protection)', () => {
    const rows = [session({ protected_reasons: [] })];
    expect(sessionsEligibleForOverwrite(rows)).toHaveLength(0);
  });

  it('excludes a Session ALSO protected by HAS_ATTENDANCE — this choice never moves it', () => {
    // The worked case an admin must never be misled about: asking whether to
    // overwrite it would promise a choice that changes nothing for this row.
    const rows = [session({ protected_reasons: ['HAS_ATTENDANCE', 'OVERRIDDEN'] })];
    expect(sessionsEligibleForOverwrite(rows)).toHaveLength(0);
  });

  it('excludes a Session protected by HAS_CONTENT or LIFECYCLE alone (never OVERRIDDEN)', () => {
    const rows = [
      session({ id: 'a', protected_reasons: ['HAS_CONTENT'] }),
      session({ id: 'b', protected_reasons: ['LIFECYCLE'] }),
    ];
    expect(sessionsEligibleForOverwrite(rows)).toHaveLength(0);
  });

  it('restricts to fromDate for the this_and_future split, when given', () => {
    const rows = [
      session({ id: 'past', date: '2026-06-01', protected_reasons: ['OVERRIDDEN'] }),
      session({ id: 'future', date: '2026-06-30', protected_reasons: ['OVERRIDDEN'] }),
    ];
    const eligible = sessionsEligibleForOverwrite(rows, '2026-06-16');
    expect(eligible.map((r) => r.id)).toEqual(['future']);
  });

  it('considers the whole schedule when fromDate is omitted (all_sessions / series edit)', () => {
    const rows = [
      session({ id: 'past', date: '2026-01-01', protected_reasons: ['OVERRIDDEN'] }),
      session({ id: 'future', date: '2026-12-31', protected_reasons: ['OVERRIDDEN'] }),
    ];
    expect(sessionsEligibleForOverwrite(rows)).toHaveLength(2);
  });
});

describe('ManualEditsDialog — the question stated, not merely asked', () => {
  const render = (count: number): string =>
    renderToStaticMarkup(
      <ManualEditsDialog
        count={count}
        busy={false}
        onOverwrite={() => undefined}
        onPreserve={() => undefined}
        onCancel={() => undefined}
      />,
    );

  it('states the affected count — the number IS the point (§4.4)', () => {
    const html = render(3);
    expect(html).toContain('3');
  });

  it('names both real choices, in the Owner-specified wording', () => {
    const html = render(1);
    expect(html).toContain('تطبيق التغييرات على جميع الحصص، بما فيها الحصص المعدّلة يدويًا');
    expect(html).toContain('الإبقاء على الحصص المعدّلة يدويًا كما هي');
  });

  it('offers a real way out that abandons the edit, not just the two answers', () => {
    expect(render(1)).toContain('إلغاء');
  });
});
