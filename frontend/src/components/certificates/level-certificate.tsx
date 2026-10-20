import type { ReactNode } from 'react';

import type { LevelCertificate as Certificate } from '../../adapters/level-completions.js';
import { t, tList } from '../../i18n/index.js';

/**
 * **«شهادة تقديرية» — the document itself** (SRS Revision 167 §3; **R228**, the
 * Owner, 2026-10-20: «look like the image attached, which is a real
 * certificate delivered by the institute»).
 *
 * Drawn after the association's printed certificate: «شهادة تقديرية» and
 * «﴿وَرَتِّلِ اِ۬لْقُرْءَانَ تَرْتِيلاًۖ﴾» (المزمل: 3, Warsh) at the head, the association's logo in
 * the top corner, purple and gold ribbons across two corners, a thin gold
 * frame, the attestation in the middle — her name in blue ink, the Level's
 * place and name, what it covers, the school year — the association's blessing,
 * «حُرّر في مراكش» with the month, and the gold seal «توقيع الجمعية».
 *
 * Presentational and pure: every fact came from the server
 * (`GET /students/me/certificates`), which sends only certificates the
 * administration CONFIRMED. Worded in its holder's gender (R221). HTML and CSS,
 * so the browser shapes the Arabic and the saved PDF holds real text; A4
 * landscape, every length relative to the certificate's own width.
 */
export function LevelCertificate({
  certificate,
  printing = false,
}: {
  certificate: Certificate;
  printing?: boolean;
}): ReactNode {
  const number = String(certificate.certificate_number).padStart(5, '0');
  // R221 — worded in the holder's own gender; the bracket form only when unrecorded.
  const gender = certificate.student_sex ? `_${certificate.student_sex}` : '';
  const covers = coverage(certificate);
  return (
    <article
      className={printing ? 'certificate certificate--printing' : 'certificate'}
      data-certificate={certificate.certificate_number}
      aria-label={t('student.certificates.documentLabel')
        .replace('{level}', certificate.level_name)
        .replace('{name}', certificate.student_name)}
    >
      <Ribbon className="certificate__ribbon certificate__ribbon--top" />
      <Ribbon className="certificate__ribbon certificate__ribbon--bottom" />
      <div className="certificate__frame">
        <img className="certificate__logo" src="/logo-large.png" alt="" />

        <header className="certificate__head">
          <h2 className="certificate__title">{t('student.certificates.documentTitle')}</h2>
          <p className="certificate__verse">
            <span lang="ar">﴿{t('student.certificates.verse')}﴾</span>
            <small className="certificate__verse-ref">{t('student.certificates.verseRef')}</small>
          </p>
        </header>

        <div className="certificate__body">
          <p className="certificate__line">
            {t(`student.certificates.attests${gender}`)}{' '}
            <span className="certificate__name">{certificate.student_name}</span>
          </p>
          <p className="certificate__line">
            {t(`student.certificates.passed${gender}`).replace('{level}', levelOrdinal(certificate.level_position))}{' '}
            <span className="certificate__level">{certificate.level_name}</span>
          </p>
          {covers ? <p className="certificate__line">{covers}</p> : null}
          {certificate.academic_year_label ? (
            <p className="certificate__line">
              {t('student.certificates.year').replace('{year}', certificate.academic_year_label.replace('-', ' – '))}
            </p>
          ) : null}
          <p className="certificate__line certificate__line--blessing">{t('student.certificates.blessing1')}</p>
          <p className="certificate__line certificate__line--blessing">{t('student.certificates.blessing2')}</p>
        </div>

        <footer className="certificate__foot">
          <Seal />
          <span className="certificate__number" dir="ltr">
            BA-{number}
          </span>
          <div className="certificate__issued">
            <span>{t('student.certificates.issuedIn')}</span>
            <span>{monthYear(certificate.issued_on)}</span>
          </div>
        </footer>
      </div>
    </article>
  );
}

/** «المستوى الثاني»; a preparatory Level is «المستوى التحضيري». */
export function levelOrdinal(position: number): string {
  const words = tList('student.certificates.ordinals');
  const word = words[position];
  return word !== undefined
    ? t('student.certificates.levelOrdinal').replace('{ordinal}', word)
    : t('student.certificates.levelNumber').replace('{n}', String(position));
}

/**
 * «والذي يشمل حفظ وتفسير سورتي آل عمران والنساء» — the Level's «مقرر الحفظ»,
 * and «وتفسير» where a tafsir Subject is taught there. Nothing when the Level
 * has no syllabus.
 */
export function coverage(certificate: Pick<Certificate, 'syllabus_surahs' | 'teaches_tafsir'>): string | null {
  const surahs = certificate.syllabus_surahs;
  if (surahs.length === 0) return null;
  const and = t('student.certificates.and');
  const list =
    surahs.length === 1
      ? t('student.certificates.surahOne').replace('{a}', surahs[0]!)
      : surahs.length === 2
        ? t('student.certificates.surahTwo').replace('{a}', surahs[0]!).replace('{b}', surahs[1]!)
        : surahs.length <= 6
          ? t('student.certificates.surahFew').replace(
              '{list}',
              `${surahs.slice(0, -1).join('، ')} ${and}${surahs.at(-1)!}`,
            )
          : t('student.certificates.surahRange').replace('{a}', surahs[0]!).replace('{b}', surahs.at(-1)!);
  return t(certificate.teaches_tafsir ? 'student.certificates.coversTafsir' : 'student.certificates.covers').replace(
    '{surahs}',
    list,
  );
}

/** `2026-10-03` → «10/2026», as the printed certificates are dated. */
function monthYear(iso: string): string {
  const [year, month] = iso.split('-');
  return `${month ?? ''}/${year ?? ''}`;
}

/** The purple-and-gold ribbon that crosses a corner of the printed certificate. */
function Ribbon({ className }: { className: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 300 300" aria-hidden="true" focusable="false" preserveAspectRatio="none">
      <path className="certificate__ribbon-deep" d="M0 0H210L0 210Z" />
      <path className="certificate__ribbon-band" d="M0 150L150 0H185L0 185Z" />
      <path className="certificate__ribbon-gold" d="M0 196L196 0H212L0 212Z" />
      <path className="certificate__ribbon-gold certificate__ribbon-gold--thin" d="M0 236L236 0H242L0 242Z" />
    </svg>
  );
}

/** The gold seal «توقيع الجمعية», with its two ribbon tails. */
function Seal(): ReactNode {
  return (
    <div className="certificate__seal" aria-hidden="true">
      <svg viewBox="0 0 120 140" focusable="false">
        <path className="certificate__seal-tail" d="M38 92L22 136L40 126L50 140L58 98Z" />
        <path className="certificate__seal-tail" d="M82 92L98 136L80 126L70 140L62 98Z" />
        <circle className="certificate__seal-rim" cx="60" cy="58" r="54" />
        <circle className="certificate__seal-face" cx="60" cy="58" r="44" />
        <path className="certificate__seal-sign" d="M40 62C48 40 56 72 62 50S74 44 78 58" />
      </svg>
      <span className="certificate__seal-text">{t('student.certificates.signature')}</span>
    </div>
  );
}
