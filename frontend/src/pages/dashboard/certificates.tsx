import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { listMyCertificates, type LevelCertificate as Certificate } from '../../adapters/level-completions.js';
import { LevelCertificate } from '../../components/certificates/level-certificate.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { Button } from '../../components/ui/button.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/dashboard/student/certificates` — **شهاداتي** (SRS Revision 167 §3).
 *
 * The certificates the administration has CONFIRMED for the acting student
 * (§4.3 — herself, or the child a guardian is acting for; the read carries no
 * id). A Level recorded as completed whose certificate has not been confirmed
 * is not here: the server does not send it.
 *
 * ## «تحميل PDF» is the browser's own print-to-PDF, on purpose
 *
 * The certificate is HTML and CSS. Printing it lets the browser's text engine
 * shape the Arabic, so the PDF holds real, sharp, selectable text — which a
 * server-side PDF library cannot do without an Arabic shaping engine, and a
 * canvas screenshot cannot do at all. Nothing is generated, stored or sent: no
 * new file to secure, retain or delete, and no dependency added.
 *
 * One certificate is printed at a time: it is rendered into a portal directly
 * under `<body>`, and `html.print-certificate` makes the print stylesheet drop
 * everything else for the duration of that one `window.print()`.
 */
export function StudentCertificatesPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRole } = useActiveRole();
  const { activeChildId } = useActiveChild();
  const [rows, setRows] = useState<Certificate[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [printing, setPrinting] = useState<Certificate | null>(null);

  const childHeader = activeRole === 'parent' ? activeChildId : null;

  const load = useCallback(async () => {
    setState('loading');
    try {
      setRows(await listMyCertificates(accessToken, childHeader));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accessToken, childHeader]);

  useEffect(() => {
    void load();
  }, [load]);

  // Print once the portal has rendered and its logo has had a frame to load;
  // clean up whether she saved, printed or cancelled.
  useEffect(() => {
    if (printing === null) return;
    const root = document.documentElement;
    root.classList.add('print-certificate');
    const done = (): void => {
      root.classList.remove('print-certificate');
      setPrinting(null);
    };
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      root.classList.remove('print-certificate');
    };
  }, [printing]);

  return (
    <StudentLayout title={t('student.certificates.title')}>
      <p className="lede">{t('student.certificates.lede')}</p>

      {state === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {state === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : null}
      {state === 'ready' && rows.length === 0 ? (
        // A named state (§14.4): none yet is an ordinary answer, and it says
        // how one comes to be here.
        <p className="state" role="status" data-no-certificates>
          {t('student.certificates.empty')}
        </p>
      ) : null}

      {state === 'ready' && rows.length > 0 ? (
        <ul className="certificate-list">
          {rows.map((certificate) => (
            <li key={certificate.certificate_number} className="certificate-list__item">
              <LevelCertificate certificate={certificate} />
              <div className="certificate-list__actions">
                <Button
                  variant="primary"
                  onClick={() => setPrinting(certificate)}
                  data-download-certificate={certificate.certificate_number}
                >
                  {t('student.certificates.download')}
                </Button>
                <span className="field__hint">{t('student.certificates.downloadHint')}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {printing
        ? createPortal(
            <div className="certificate-print-root">
              <LevelCertificate certificate={printing} printing />
            </div>,
            document.body,
          )
        : null}
    </StudentLayout>
  );
}
