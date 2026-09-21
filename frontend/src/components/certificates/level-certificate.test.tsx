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
  level_name: 'المستوى الأول',
  category_name: 'المرأة',
  branch_name: 'تاركة',
  completed_on: '2026-09-21',
  issued_on: '2026-09-22',
};

describe('the document', () => {
  it('states her name, the Level and its Category, the branch, both dates and a padded number — and nothing it was not sent', () => {
    const html = renderToStaticMarkup(<LevelCertificate certificate={certificate} />);
    for (const expected of [
      'شهادة إتمام مستوى',
      'فاطمة الزهراء العلوي',
      'المستوى الأول',
      'المرأة',
      'تاركة',
      'BA-00012',
      'خيركم من تعلّم القرآن وعلّمه',
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('student.certificates.');
    // Styled by classes only: the platform's CSP allows no inline style.
    expect(html).not.toContain('style=');
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
