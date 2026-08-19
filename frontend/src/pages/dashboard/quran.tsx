import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchMyCoverage,
  type QuranLogRow,
  type SurahCoverage,
} from '../../adapters/quran.js';
import { DataTable, type Column } from '../../components/ui/data-table.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { StudentLayout } from '../../components/student/student-layout.js';
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
 * **The child context has to be SENT, though** (fixed 2026-08-17). The header
 * was omitted, so a parent-only account received a `400` and one holding both
 * roles was shown its own progress instead of the child's. The rule is
 * `StudentDashboard`'s and is not restated: act as parent → name the active
 * child; act as student → send nothing, because sending a child id then would
 * be asking for someone else's record.
 *
 * **The engine is not duplicated.** This renders the same read the مؤطرة's
 * screen uses, including §4.5's self-heal guard; only how the subject was
 * established differs.
 */
export function StudentQuranPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRole } = useActiveRole();
  const { activeChildId } = useActiveChild();
  const [surahs, setSurahs] = useState<SurahCoverage[]>([]);
  const [logs, setLogs] = useState<QuranLogRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const childHeader = activeRole === 'parent' ? activeChildId : null;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await fetchMyCoverage(accessToken, childHeader);
      setSurahs(data.surahs);
      setLogs(data.logs);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [accessToken, childHeader]);

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
      {/* The shared table (2026-08-17). This was hand-rolled `admin-table`
          markup with its own empty paragraph, so a read-only list rendered
          differently here than on every other list in the platform. */}
      <DataTable
        caption={t('student.quran.history')}
        columns={logColumns(surahs)}
        rows={logs}
        rowKey={(l) => l.id}
        status="ready"
      />
        </>
      )}
    </Frame>
  );
}

/**
 * The log history's columns.
 *
 * A function of the coverage list because the log carries a `surah_id` and the
 * NAME lives on the coverage row — §4.5's seeded lookup is the one source for
 * those 114 names, and a copy here would be a second one.
 */
function logColumns(surahs: SurahCoverage[]): Column<QuranLogRow>[] {
  return [
    {
      key: 'surah',
      header: t('student.quran.surah'),
      cell: (l) => surahs.find((s) => s.surah_id === l.surah_id)?.name_arabic ?? String(l.surah_id),
    },
    { key: 'range', header: t('student.quran.range'), cell: (l) => `${l.start_ayah}–${l.end_ayah}` },
    {
      key: 'category',
      header: t('student.quran.category'),
      cell: (l) =>
        t(l.category === 'revision' ? 'student.quran.revision' : 'student.quran.newMemorization'),
    },
  ];
}

/** The same frame the Student Dashboard uses — header, measure, footer. */
/**
 * **Her portal frame** (R85), not this page's own chrome.
 *
 * It rendered header, `Container`, heading and footer itself, so the page had
 * no menu — she reached it by typing a URL or from one dashboard.
 * `StudentLayout` owns all of that, and owns it identically for the back office
 * and the teaching portal, so the three cannot drift.
 */
function Frame({ children }: { children: ReactNode }): ReactNode {
  return <StudentLayout title={t('student.quran.title')}>{children}</StudentLayout>;
}
