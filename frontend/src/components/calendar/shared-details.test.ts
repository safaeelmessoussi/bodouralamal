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

describe('the Session page is no longer the way in', () => {
  it('offers no «فتح صفحة الحصة وموادها» from the dialog', () => {
    expect(code(DIALOG)).not.toContain('detailsOpenSession');
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
