import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LevelCertificate } from './level-certificate.js';
import { STUDENT_MODULES } from '../../lib/student-modules.js';
import { resolveRoute } from '../../lib/route.js';
import certificatesPage from '../../pages/dashboard/certificates.tsx?raw';

/**
 * SRS Revision 167 §3 — شهادة إتمام مستوى. The server decides which
 * certificates exist; these hold the document to stating exactly what it was
 * sent, and the page to printing ONE certificate as a page of its own.
 */
const certificate = {
  certificate_number: 12,
  student_name: 'فاطمة الزهراء العلوي',
  student_sex: 'female' as const,
  level_name: 'المستوى الأول',
  category_name: 'المرأة',
  branch_name: 'تاركة',
  completed_on: '2026-09-21',
  issued_on: '2026-10-02',
  level_position: 2,
  syllabus_surahs: ['آل عمران', 'النساء'],
  teaches_tafsir: true,
  academic_year_label: '2025-2026',
};

describe('R228 — the association\'s «شهادة تقديرية»', () => {
  it('states her name, the Level\'s place and name, what it covers, the year, the month and a padded number', () => {
    const html = renderToStaticMarkup(<LevelCertificate certificate={certificate} />);
    for (const expected of [
      'شهادة تقديرية',
      'وَرَتِّلِ اِ۬لْقُرْءَانَ تَرْتِيلاًۖ',
      'المزمل: 3',
      'فاطمة الزهراء العلوي',
      'ببرنامج المستوى الثاني',
      'المستوى الأول'.replace('الأول', 'الثاني'),
      'والذي يشمل حفظ وتفسير سورتي آل عمران والنساء',
      'خلال الموسم الدراسي 2025 – 2026',
      'حُرّر في مراكش',
      '10/2026',
      'توقيع الجمعية',
      'BA-00012',
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('student.certificates.');
    // Styled by classes only: the platform's CSP allows no inline style.
    expect(html).not.toContain('style=');
  });

  it('names a few Surahs, a long syllabus by its ends, and says «حفظ» alone without tafsir', async () => {
    const { coverage, levelOrdinal } = await import('./level-certificate.js');
    expect(coverage({ syllabus_surahs: ['الكهف'], teaches_tafsir: false })).toBe('والذي يشمل حفظ سورة الكهف');
    expect(coverage({ syllabus_surahs: ['الغاشية', 'الفجر', 'البلد'], teaches_tafsir: true })).toBe(
      'والذي يشمل حفظ وتفسير سور الغاشية، الفجر والبلد',
    );
    const many = ['الأحقاف', 'محمد', 'الفتح', 'الحجرات', 'ق', 'الذاريات', 'الناس'];
    expect(coverage({ syllabus_surahs: many, teaches_tafsir: false })).toBe('والذي يشمل حفظ السور من سورة الأحقاف إلى سورة الناس');
    expect(coverage({ syllabus_surahs: [], teaches_tafsir: true })).toBeNull();
    expect(levelOrdinal(0)).toBe('المستوى التحضيري');
    expect(levelOrdinal(7)).toBe('المستوى السابع');
  });
});

describe('R221 — worded in its holder\'s gender', () => {
  it('says «المستفيدة … اجتازت» for her, «المستفيد … اجتاز» for him, and the bracket form only when unrecorded', () => {
    const her = renderToStaticMarkup(<LevelCertificate certificate={certificate} />);
    expect(her).toContain('بأنّ المستفيدة');
    expect(her).toContain('قد اجتازت الاختبارات');
    const him = renderToStaticMarkup(<LevelCertificate certificate={{ ...certificate, student_sex: 'male' }} />);
    expect(him).toContain('بأنّ المستفيد ');
    expect(him).toContain('قد اجتاز الاختبارات');
    const unknown = renderToStaticMarkup(<LevelCertificate certificate={{ ...certificate, student_sex: null }} />);
    expect(unknown).toContain('قد اجتاز(ت) الاختبارات');
  });
});

describe('«تحميل PDF» — one certificate, a page of its own', () => {
  it('prints through a portal under <body> and drops everything else for that one print', () => {
    expect(certificatesPage).toContain('createPortal(');
    expect(certificatesPage).toContain("root.classList.add('print-certificate')");
    expect(certificatesPage).toContain("window.addEventListener('afterprint', done, { once: true })");
    // The stylesheet's half — one A4-landscape page, backgrounds kept — is
    // proven where it can be: a real print to PDF in `verify-certificates`.
  });
});

describe('شهاداتي is reachable', () => {
  it('is a module of her portal, under child context, with a route of its own', () => {
    const module = STUDENT_MODULES.find((m) => m.path === '/dashboard/student/certificates');
    expect(module).toMatchObject({ childContext: true, status: 'ready', labelKey: 'student.nav.certificates' });
    expect(resolveRoute('/dashboard/student/certificates')).toBe('dashboard-student-certificates');
  });
});
