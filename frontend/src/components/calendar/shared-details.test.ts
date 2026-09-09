import { describe, expect, it } from 'vitest';

import PUBLIC_PAGE from '../../pages/calendar.tsx?raw';
import PERSONAL from './personal-calendar.tsx?raw';
import ADMIN from '../../pages/admin/scheduling.tsx?raw';
import DIALOG from './event-details-dialog.tsx?raw';
import { ar } from '../../i18n/ar.js';

const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * **One occurrence-details dialog, opened from all four calendars.**
 *
 * The component was never duplicated — it was **never opened**. Three surfaces
 * out of four passed `onOpenEvent={() => undefined}`, so a beneficiary, a مؤطرة
 * and an administrator could each see a class on a calendar and had no way to
 * ask anything about it. That is a harder defect to see than a fork, because
 * the shared component looks healthy in isolation.
 */
describe('every calendar opens the shared dialog', () => {
  for (const [name, source] of [
    ['public', PUBLIC_PAGE],
    ['personal (student + مؤطرة)', PERSONAL],
    ['back office', ADMIN],
  ] as const) {
    it(`${name} renders EventDetailsDialog`, () => {
      expect(code(source)).toContain('<EventDetailsDialog');
    });

    it(`${name} actually wires the click to it`, () => {
      // The tell of the defect: the handler existed and discarded its argument.
      expect(code(source)).not.toContain('onOpenEvent={() => undefined}');
    });
  }

  it('and nobody has built a second one', () => {
    for (const source of [PUBLIC_PAGE, PERSONAL, ADMIN]) {
      expect(code(source)).not.toContain('SessionDetailsDialog');
      expect(code(source)).not.toContain('OccurrenceDetailsDialog');
    }
  });
});

describe('recordings and materials are two questions, answered separately', () => {
  it('renders a heading and an empty state for each', () => {
    expect(code(DIALOG)).toContain("t('session.recordings')");
    expect(code(DIALOG)).toContain("t('session.noRecordings')");
    expect(code(DIALOG)).toContain("t('session.attachments')");
    expect(code(DIALOG)).toContain("t('session.noAttachments')");
  });

  it('and the combined sentence is gone from the catalogue too', () => {
    // A dead entry is what a future screen picks up and renders.
    expect('noMaterials' in (ar.session as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(ar)).not.toContain('لا تسجيلات ولا مواد');
  });

  it('says nothing about content until the read SUCCEEDED', () => {
    // §B8 — 401/403/500 must not become «لا توجد مواد». Both sections render
    // inside the ready branch, and error has its own line.
    expect(code(DIALOG)).toContain("{state === 'ready' ? (");
    expect(code(DIALOG)).toContain("state === 'error'");
  });
});

describe('the canonical dialog has no dedicated-page escape hatch', () => {
  it('materials carry both the shelf and the selected item', () => {
    expect(code(DIALOG)).toContain('/resources?level=${item.level_id}&content=${item.id}');
  });
  it('offers no «فتح صفحة الحصة وموادها» from the dialog', () => {
    expect('detailsOpenSession' in (ar.calendar as Record<string, unknown>)).toBe(false);
    expect(code(DIALOG)).not.toContain('/calendar/sessions/');
  });
});

describe('the focused read carries the caller’s own token (§B6)', () => {
  it('never fetches anonymously', () => {
    // The prior defect: an authenticated dialog reading the public tier, so a
    // مؤطرة saw less than she may.
    expect(code(DIALOG)).toContain('accessToken');
    expect(code(DIALOG)).not.toContain('token: null');
  });
});

/**
 * **R137 — a Session may gain a linked exam, and the dialog shows it without
 * a second fetch or a second implementation of "is it open yet".**
 *
 * The domain claim proven at the server (`assessment.integration.test.ts`,
 * `calendar.service.ts`'s `readSessionPage`): the Session's own date never
 * changes, availability is a wholly separate fact, and a linked exam this
 * caller could not otherwise see on the calendar (`examTierWhere`) is not
 * listed here either. This file pins the CLIENT half — the section renders,
 * reuses the existing three-state action, and asks nothing new of the
 * server per exam shown.
 */
describe('a Session dialog shows its linked exam, when one is scheduled (R137)', () => {
  it('renders a heading and each linked exam’s own title, only once ready', () => {
    expect(code(DIALOG)).toContain("t('session.linkedExams')");
    expect(code(DIALOG)).toContain('linkedExams.map((exam)');
    expect(code(DIALOG)).toContain(
      "state === 'ready' && (linkedExams.length > 0 || canLinkExam)",
    );
  });

  it('reuses the SAME availability action an exam occurrence’s own dialog uses — one implementation, not two', () => {
    // `ExamAccessAction` is the shared component; both call sites pass it
    // an id and an availableFrom rather than restating the three states.
    const definitions = code(DIALOG).match(/function ExamAccessAction\(/g) ?? [];
    expect(definitions).toHaveLength(1);
    expect(code(DIALOG)).toContain(
      '<ExamAccessAction examId={occurrence.id} availableFrom={occurrence.available_from} />',
    );
    expect(code(DIALOG)).toContain(
      '<ExamAccessAction examId={exam.id} availableFrom={exam.available_from} />',
    );
  });

  it('a physical linked exam is stated plainly, never offered an online start action', () => {
    expect(code(DIALOG)).toContain("exam.mode === 'online'");
    expect(code(DIALOG)).toContain("t('session.linkedExamPhysical')");
  });

  it('never fetches a second time for this — the same fetchSessionDetails read already in flight', () => {
    // Only one call site of fetchSessionDetails exists in the whole file.
    const calls = code(DIALOG).match(/fetchSessionDetails\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});

/**
 * **R137 — إضافة اختبار / ربط اختبار, staff-only, routed to الجدولة.**
 *
 * Rule O: the button is offered only to roles that could plausibly reach
 * الجدولة (`STAFF_ROLES`, the same set `AttendancePanel` already uses to
 * decide who sees the roster rather than one self-check-in button) —
 * offering it wider would be a control that can only refuse, and the real
 * authorization still lives entirely at the destination route.
 */
describe('the Session dialog offers ربط اختبار to staff, routed to الجدولة (R137)', () => {
  it('the action exists, gated on the same STAFF_ROLES set as attendance', () => {
    expect(code(DIALOG)).toContain('canLinkExam');
    expect(code(DIALOG)).toContain(
      "const STAFF_ROLES = ['admin', 'super_admin', 'teacher'];",
    );
    expect(code(DIALOG)).toContain('activeRoles.some((role) => STAFF_ROLES.includes(role))');
  });

  it('routes to الجدولة with the Session prefilled as the target — never a second form here', () => {
    expect(code(DIALOG)).toContain(
      '`/admin/schedules?kind=exam&new=1&target_kind=session&target_id=${encodeURIComponent(occurrence.id)}`',
    );
    // No local scheduling logic — the link is the whole implementation.
    expect(code(DIALOG)).not.toContain('scheduleExam(');
  });

  it('a reader with no linked exam and no staff role sees nothing at all — not an empty section', () => {
    expect(code(DIALOG)).toContain("linkedExams.length > 0 || canLinkExam");
  });
});
