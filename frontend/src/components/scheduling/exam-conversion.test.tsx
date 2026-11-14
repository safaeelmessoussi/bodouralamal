import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ExamConversionFacts } from '../../adapters/sessions.js';
import { ExamConversionFields, SessionTypeField } from './exam-conversion.js';
import PAGE from '../../pages/admin/schedule-sessions.tsx?raw';
import DIALOG from '../calendar/event-details-dialog.tsx?raw';

const facts = (over: Partial<ExamConversionFacts> = {}): ExamConversionFacts => ({
  exam_types: [{ id: 't1', name: 'اختبار شفوي' }],
  levels: [
    {
      id: 'l1',
      name: 'المستوى 1',
      category_name: 'المرأة',
      subjects: [{ id: 's1', name: 'الحفظ', requires_surahs: true }],
      surahs: [{ id: 1, name: 'الفاتحة' }],
    },
  ],
  level_id: 'l1',
  subject_id: 's1',
  surah_id: 1,
  max_grade: 20,
  version: 3,
  ...over,
});

const fields = (f: ExamConversionFacts): string =>
  renderToStaticMarkup(
    <ExamConversionFields
      sessionId="x"
      facts={f}
      typeId="t1"
      token="tok"
      onCancel={() => undefined}
      onConverted={() => undefined}
    />,
  );

describe('R269 — «تعديل الحصة» → النوع: اختبار', () => {
  it('«النوع» offers the class as it is, then every exam type', () => {
    const html = renderToStaticMarkup(<SessionTypeField facts={facts()} value="" onChange={() => undefined} />);
    expect(html).toContain('النوع');
    expect(html).toContain('حصة');
    expect(html).toContain('اختبار شفوي');
  });

  it('asks only what the class does not say: no Level when it has one, the Surah for a by-Surah subject, the maximum', () => {
    const html = fields(facts());
    expect(html).not.toContain('مستوى الاختبار');
    expect(html).toContain('المادة');
    expect(html).toContain('السورة');
    expect(html).toContain('العلامة القصوى');
    expect(html).toContain('تحويلها إلى اختبار');
    expect(html).toContain('حذف الاختبار يعيدها حصة');
  });

  it('asks the Level when the class has several', () => {
    const two = facts({
      level_id: null,
      levels: [...facts().levels, { id: 'l2', name: 'المستوى 2', category_name: 'المرأة', subjects: [], surahs: [] }],
    });
    expect(fields(two)).toContain('مستوى الاختبار');
    expect(fields(two)).toContain('المرأة — المستوى 2');
  });

  it('«حصص الجدول» says a class became an exam, edits it no more, and offers «إرجاعها حصة»', () => {
    expect(PAGE).toContain("r.replaced_by_exam ? t('admin.sessions.becameExam') : t(`admin.sessions.status.${r.status}`)");
    expect(PAGE).toContain("available: (r) => !r.replaced_by_exam },");
    expect(PAGE).toContain("label: t('admin.sessions.revertAction'),");
    expect(PAGE).toContain('deleteExam(exam.id, accessToken)');
  });

  it('the calendar\'s door for an exam that replaced a class عن بُعد is that class\'s call', () => {
    expect(DIALOG).toContain("? (occurrence.replaced_session_id ?? null)");
    expect(DIALOG).toContain('href={`/classroom/${room}`}');
  });
});
