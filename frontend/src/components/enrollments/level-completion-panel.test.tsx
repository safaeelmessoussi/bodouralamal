import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LevelCompletionRow } from '../../adapters/level-completions.js';
import { LevelCompletionPanel, unmetSummary } from './level-completion-panel.js';
import enrolmentsPage from '../../pages/admin/enrollments.tsx?raw';

/**
 * SRS Revision 167 §3 — «إتمام المستوى» under a Level. The server owns the rule
 * (`REQUIREMENTS_NOT_MET`, integration-tested); these hold the screen to SAYING
 * what is missing before anything is pressed, and to one door on the page.
 */
const row = (over: Partial<LevelCompletionRow> = {}): LevelCompletionRow => ({
  level_id: 'l1',
  level_name: 'المستوى الأول',
  category_name: 'المرأة',
  requirements: {
    complete: false,
    configured_surahs: 5,
    memorised_surahs: 3,
    examined_surahs: 1,
    exams_required: true,
  },
  mark: null,
  ...over,
});

const render = (r: LevelCompletionRow): string =>
  renderToStaticMarkup(
    <LevelCompletionPanel studentId="s1" studentName="فاطمة" row={r} token={null} onChanged={() => {}} />,
  );

describe('what is missing, in words', () => {
  it('names memorisation AND the tafseer exams, with the counts', () => {
    const text = unmetSummary(row().requirements)!;
    expect(text).toContain('الحفظ: 3 من 5');
    expect(text).toContain('اختبارات التفسير: أُجري 1 من 5');
  });

  it('never mentions exams where the Level has none, and says nothing at all once BR-11 is met', () => {
    const noExams = unmetSummary({ ...row().requirements, exams_required: false, examined_surahs: 0 })!;
    expect(noExams).toContain('الحفظ');
    expect(noExams).not.toContain('التفسير');
    expect(unmetSummary({ ...row().requirements, complete: true })).toBeNull();
  });

  it('a Level with no «مقرر الحفظ» says THAT — neither met nor a count of zero', () => {
    expect(unmetSummary({ ...row().requirements, complete: null, configured_surahs: 0 })).toContain('مقرر الحفظ');
  });
});

describe('the panel', () => {
  it('shows the message under the Level BEFORE anything is pressed — and still offers the mark', () => {
    const html = render(row());
    expect(html).toContain('data-unmet');
    expect(html).toContain('لم تُستوفَ شروط إتمام هذا المستوى بعد');
    expect(html).toContain('تسجيل إتمام المستوى');
  });

  it('a recorded completion offers the certificate as a SECOND, separate confirmation', () => {
    const html = render(
      row({
        mark: {
          completed_on: '2026-09-21',
          completed_by_name: 'المديرة',
          requirements_met: false,
          certificate_number: null,
          certificate_issued_on: null,
        },
      }),
    );
    expect(html).toContain('أتمّت المستوى');
    expect(html).toContain('سُجِّل الإتمام مع العلم بأن الشروط لم تكن مستوفاة');
    expect(html).toContain('تأكيد إظهار الشهادة');
    expect(html).toContain('الشهادة غير ظاهرة للمستفيدة بعد');
  });

  it('a showing certificate can only be withdrawn — the mark under it cannot be removed first', () => {
    const html = render(
      row({
        requirements: { ...row().requirements, complete: true },
        mark: {
          completed_on: '2026-09-21',
          completed_by_name: 'المديرة',
          requirements_met: true,
          certificate_number: 12,
          certificate_issued_on: '2026-09-22',
        },
      }),
    );
    expect(html).toContain('الشهادة رقم 12');
    expect(html).toContain('سحب الشهادة');
    expect(html).not.toContain('إلغاء تسجيل الإتمام');
  });
});

describe('المستفيدات — one door', () => {
  it('«تسجيل» and «تعديل» are ONE row action now, available to a مستفيدة with no placement too', () => {
    const actions = enrolmentsPage.slice(
      enrolmentsPage.indexOf('const actions: RowAction<StudentRow>[] = ['),
      enrolmentsPage.indexOf('return (', enrolmentsPage.indexOf('const actions: RowAction<StudentRow>[] = [')),
    );
    expect(actions).toContain("label: t('admin.enrollments.manage')");
    expect(actions.match(/label:/g)).toHaveLength(1);
    expect(actions).not.toContain('available:');
  });
});
