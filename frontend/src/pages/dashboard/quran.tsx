import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchMyCoverage,
  type QuranLogRow,
  type SurahCoverage,
} from '../../adapters/quran.js';
import { ApplicationHeader } from '../../components/header/application-header.js';
import { SiteFooter } from '../../components/site-footer.js';
import { Container } from '../../components/ui/container.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/dashboard/student/quran` — **My Quran Progress** (§14.1, §4.5; M4b).
 *
 * **Read-only, and read-only by construction.** §4.5: *"Students view read-only;
 * only teachers log entries."* There is no write verb on this path at all — the
 * capability is absent rather than guarded, which is the stronger form of the
 * same rule, and the server would refuse one regardless.
 *
 * **No student id anywhere on this screen.** It calls `/students/me/quran`,
 * whose subject comes from the child context or the JWT — so a parent acting for
 * a child sees that child, a student sees herself, and neither can name anybody
 * else. The `?student=` deep link that the مؤطرة's screen needs would be a
 * liability here, so it does not exist.
 *
 * **The engine is not duplicated.** This renders the same read the مؤطرة's
 * screen uses, including §4.5's self-heal guard; only how the subject was
 * established differs.
 */
export function StudentQuranPage(): ReactNode {
  const { accessToken } = useSession();
  const [surahs, setSurahs] = useState<SurahCoverage[]>([]);
  const [logs, setLogs] = useState<QuranLogRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await fetchMyCoverage(accessToken);
      setSurahs(data.surahs);
      setLogs(data.logs);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Frame>
      {state === 'loading' ? (
        <p className="state">{t('common.loading')}</p>
      ) : state === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : (
        <>
      <p className="lede">{t('student.quran.lede')}</p>

      {surahs.length === 0 ? (
        // A named state, not an empty table: nothing logged yet is a real and
        // ordinary answer for a مستفيدة who has just been enrolled, and it is
        // different from a failed load.
        <p className="state" role="status">
          {t('student.quran.empty')}
        </p>
      ) : (
        <ul className="admin-list">
          {surahs.map((s) => (
            <li key={s.surah_id}>
              <span>{s.name_arabic}</span>
              {/* BR-13's union as a percentage of the Surah's own total — the
                  definitive denominator (§4.5). Western digits (R-digits). */}
              <span>
                {s.coverage_percent}% — {s.merged_ayah_count}/{s.total_ayahs}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2>{t('student.quran.history')}</h2>
      {logs.length === 0 ? (
        <p className="state" role="status">
          {t('student.quran.noLogs')}
        </p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">{t('student.quran.surah')}</th>
              <th scope="col">{t('student.quran.range')}</th>
              <th scope="col">{t('student.quran.category')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{surahs.find((s) => s.surah_id === l.surah_id)?.name_arabic ?? l.surah_id}</td>
                <td>
                  {l.start_ayah}–{l.end_ayah}
                </td>
                <td>
                  {t(
                    l.category === 'revision'
                      ? 'student.quran.revision'
                      : 'student.quran.newMemorization',
                  )}
                </td>
              </tr>
            ))}
          </tbody>
            </table>
          )}
        </>
      )}
    </Frame>
  );
}

/** The same frame the Student Dashboard uses — header, measure, footer. */
function Frame({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <ApplicationHeader />
      <main id="main" className="section">
        <Container>
          <h1>{t('student.quran.title')}</h1>
          {children}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
