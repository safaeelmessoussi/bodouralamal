import type { ReactNode } from 'react';

import type { LevelCertificate as Certificate } from '../../adapters/level-completions.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';

/**
 * **شهادة إتمام مستوى — the document itself** (SRS Revision 167 §3).
 *
 * Presentational and pure: everything it states came from the server
 * (`GET /students/me/certificates`), which sends only certificates the
 * administration has CONFIRMED. Nothing here decides anything.
 *
 * It is drawn in HTML and CSS rather than as an image or a generated file, so
 * the browser's own text engine shapes the Arabic (joined letters, diacritics,
 * right-to-left) and the PDF she saves holds real, selectable, sharp text at any
 * size. The proportions are A4 landscape (`aspect-ratio: 297 / 210`), and every
 * length inside is relative to the certificate's own width (container query
 * units), so the on-screen preview, a phone and the printed page are the same
 * drawing at different scales.
 */
export function LevelCertificate({
  certificate,
  printing = false,
}: {
  certificate: Certificate;
  printing?: boolean;
}): ReactNode {
  const number = String(certificate.certificate_number).padStart(5, '0');
  return (
    <article
      className={printing ? 'certificate certificate--printing' : 'certificate'}
      data-certificate={certificate.certificate_number}
      aria-label={t('student.certificates.documentLabel')
        .replace('{level}', certificate.level_name)
        .replace('{name}', certificate.student_name)}
    >
      <div className="certificate__frame">
        <Corner className="certificate__corner certificate__corner--ts" />
        <Corner className="certificate__corner certificate__corner--te" />
        <Corner className="certificate__corner certificate__corner--bs" />
        <Corner className="certificate__corner certificate__corner--be" />

        <header className="certificate__head">
          <img className="certificate__logo" src="/logo-large.png" alt="" />
          <p className="certificate__association">{t('student.certificates.association')}</p>
        </header>

        <p className="certificate__basmala">{t('student.certificates.basmala')}</p>

        <h2 className="certificate__title">{t('student.certificates.documentTitle')}</h2>
        <Divider />

        <p className="certificate__line">{t('student.certificates.attests')}</p>
        <p className="certificate__name">{certificate.student_name}</p>
        <p className="certificate__line">{t('student.certificates.completed')}</p>
        <p className="certificate__level">
          {certificate.level_name}
          <span className="certificate__category"> — {certificate.category_name}</span>
        </p>
        <p className="certificate__line certificate__line--small">
          {t('student.certificates.where')
            .replace('{branch}', certificate.branch_name)
            .replace('{date}', formatDate(certificate.completed_on))}
        </p>

        <p className="certificate__hadith">
          «{t('student.certificates.hadith')}»
          <span className="certificate__hadith-source">{t('student.certificates.hadithSource')}</span>
        </p>

        <footer className="certificate__foot">
          <div className="certificate__meta">
            <span>{t('student.certificates.number')}</span>
            <strong dir="ltr">BA-{number}</strong>
          </div>
          <div className="certificate__seal" aria-hidden="true">
            <Seal />
          </div>
          <div className="certificate__meta certificate__meta--end">
            <span>{t('student.certificates.issuedOn')}</span>
            <strong>{formatDate(certificate.issued_on)}</strong>
            <span className="certificate__signature">{t('student.certificates.signature')}</span>
          </div>
        </footer>
      </div>
    </article>
  );
}

/** An eight-pointed star corner (the Moroccan «خاتم»), drawn once and mirrored
 *  by CSS for the other three corners. */
function Corner({ className }: { className: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path className="certificate__corner-line" d="M4 96V30Q4 4 30 4H96" />
      <path className="certificate__corner-line" d="M12 96V34Q12 12 34 12H96" />
      <g className="certificate__corner-star" transform="translate(30 30)">
        <rect x="-11" y="-11" width="22" height="22" />
        <rect x="-11" y="-11" width="22" height="22" transform="rotate(45)" />
        <circle r="4.5" className="certificate__corner-dot" />
      </g>
    </svg>
  );
}

function Divider(): ReactNode {
  return (
    <svg className="certificate__divider" viewBox="0 0 240 16" aria-hidden="true" focusable="false">
      <path d="M0 8H96M144 8H240" />
      <g transform="translate(120 8)">
        <rect x="-5.5" y="-5.5" width="11" height="11" />
        <rect x="-5.5" y="-5.5" width="11" height="11" transform="rotate(45)" />
      </g>
      <circle cx="102" cy="8" r="1.6" />
      <circle cx="138" cy="8" r="1.6" />
    </svg>
  );
}

function Seal(): ReactNode {
  const points = Array.from({ length: 24 }, (_, i) => {
    const angle = (i * Math.PI) / 12;
    const radius = i % 2 === 0 ? 46 : 40;
    return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 100 100" focusable="false">
      <polygon className="certificate__seal-burst" points={points} />
      <circle className="certificate__seal-ring" cx="50" cy="50" r="33" />
      <circle className="certificate__seal-ring" cx="50" cy="50" r="28" />
      <g className="certificate__seal-star" transform="translate(50 50)">
        <rect x="-12" y="-12" width="24" height="24" />
        <rect x="-12" y="-12" width="24" height="24" transform="rotate(45)" />
      </g>
    </svg>
  );
}
