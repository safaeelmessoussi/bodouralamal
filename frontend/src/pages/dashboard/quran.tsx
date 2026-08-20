import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchMyCoverage,
  type LevelCoverage,
  type QuranLogRow,
  type SurahCoverage,
} from '../../adapters/quran.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { DataTable, type Column } from '../../components/ui/data-table.js';
import { ProgressBar } from '../../components/ui/progress-bar.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/dashboard/student/quran` — **حفظي** (§14.1, §4.5; M4b, redesigned §C15).
 *
 * ## Progress first, the log second
 *
 * The screen used to open on a list of Surahs *she had logs for* — so a
 * مستفيدة who had memorised nothing saw an empty page, and one halfway through
 * her syllabus could not tell what remained. It now shows **her syllabus**:
 * every Surah `LevelSurah` configures for her Level, including the ones still at
 * zero, each with the shared `ProgressBar`. The raw log is kept, below, because
 * §C18 asks that she be able to inspect what was recorded — but it is no longer
 * the first thing the page is.
 *
 * ## Grouped by Level, and only when there is more than one
 *
 * One Quran-relevant Level renders directly; several are grouped under
 * **`{Category} — {Level}`** (rule D), because Level names are not unique across
 * Categories (§4.4b). **The curricula are never merged into one list**: the same
 * Surah may belong to two Levels' syllabuses, and a merged list could not say
 * which context a figure belonged to. It appears under both, with the same
 * figure — memorisation is a fact about `(student, surah)` and does not fork per
 * Level.
 *
 * ## Read-only by construction
 *
 * §4.5: *"Students view read-only; only teachers log entries."* There is no
 * write verb on this path at all — the capability is absent rather than guarded,
 * which is the stronger form of the same rule.
 *
 * **No student id anywhere on this screen.** It calls `/students/me/quran`,
 * whose subject comes from the child context or the JWT, so a parent acting for
 * a child sees that child and a student sees herself. **The child context has to
 * be SENT** (fixed 2026-08-17): omitted, a parent-only account received a `400`
 * and one holding both roles was shown its own progress instead of the child's.
 */
export function StudentQuranPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRole } = useActiveRole();
  const { activeChildId } = useActiveChild();
  const [levels, setLevels] = useState<LevelCoverage[]>([]);
  const [surahs, setSurahs] = useState<SurahCoverage[]>([]);
  const [logs, setLogs] = useState<QuranLogRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const childHeader = activeRole === 'parent' ? activeChildId : null;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await fetchMyCoverage(accessToken, childHeader);
      setLevels(data.levels);
      setSurahs(data.surahs);
      setLogs(data.logs);
      setState('ready');
    } catch {
      // §C29 — a failed read is never rendered as "nothing memorised yet".
      setState('error');
    }
  }, [accessToken, childHeader]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <Frame>
        <p className="state">{t('common.loading')}</p>
      </Frame>
    );
  }
  if (state === 'error') {
    return (
      <Frame>
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      </Frame>
    );
  }

  /**
   * Surahs she has logged that her syllabus does not list — a real case, and
   * one that must not silently vanish. A مستفيدة changing Level, or a مؤطِّرة
   * recording something outside the configured curriculum before it was
   * configured, both produce it.
   */
  const inSyllabus = new Set(levels.flatMap((l) => l.surahs.map((s) => s.surah_id)));
  const extra = surahs.filter((s) => !inSyllabus.has(s.surah_id));

  return (
    <Frame>
      <p className="lede">{t('student.quran.lede')}</p>

      {levels.length === 0 && extra.length === 0 ? (
        // A named state, not an empty table: nothing logged yet is an ordinary
        // answer for a مستفيدة who has just been enrolled, and it is different
        // from a failed load.
        <p className="state" role="status">
          {t('student.quran.empty')}
        </p>
      ) : null}

      {levels.map((level) => (
        <section key={level.level_id}>
          {/* The heading is omitted for a single Level — its own title already
              says whose progress this is, and one group is not a grouping. */}
          {levels.length > 1 ? (
            <h2>
              {levelLabel({
                id: level.level_id,
                name: level.level_name,
                category_name: level.category_name,
              })}
            </h2>
          ) : null}
          <SurahBars surahs={level.surahs} />
        </section>
      ))}

      {extra.length > 0 ? (
        <section>
          <h2>{t('student.quran.beyondSyllabus')}</h2>
          <SurahBars surahs={extra} />
        </section>
      ) : null}

      <h2>{t('student.quran.history')}</h2>
      {/* The shared table (2026-08-17). This was hand-rolled `admin-table`
          markup with its own empty paragraph, so a read-only list rendered
          differently here than on every other list in the platform. */}
      <DataTable
        caption={t('student.quran.history')}
        columns={logColumns(surahs, levels)}
        rows={logs}
        rowKey={(l) => l.id}
        status="ready"
      />
    </Frame>
  );
}

/** One Surah, one bar — the shared primitive, never a Quran-specific one. */
function SurahBars({ surahs }: { surahs: SurahCoverage[] }): ReactNode {
  if (surahs.length === 0) {
    return (
      <p className="state" role="status">
        {t('student.quran.emptyLevel')}
      </p>
    );
  }
  return (
    <ul className="progress-list">
      {surahs.map((s) => (
        <li key={s.surah_id}>
          <ProgressBar
            label={s.name_arabic}
            value={s.coverage_percent}
            detail={`${s.merged_ayah_count}/${s.total_ayahs}`}
            complete={s.coverage_percent >= 100}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The log history's columns.
 *
 * The NAME lives on the coverage rows — §4.5's seeded lookup is the one source
 * for those 114 names, and a copy here would be a second one. It reads the
 * syllabus too, so a Surah she has logged nothing else for is still named.
 */
function logColumns(surahs: SurahCoverage[], levels: LevelCoverage[]): Column<QuranLogRow>[] {
  const names = new Map<number, string>();
  for (const level of levels) for (const s of level.surahs) names.set(s.surah_id, s.name_arabic);
  for (const s of surahs) names.set(s.surah_id, s.name_arabic);

  return [
    {
      key: 'date',
      header: t('student.quran.date'),
      // TD-11 — the calendar date, in the reader's own locale digits.
      cell: (l) => new Date(l.logged_at).toLocaleDateString('ar-MA'),
    },
    {
      key: 'category',
      header: t('student.quran.category'),
      cell: (l) =>
        t(l.category === 'revision' ? 'student.quran.revision' : 'student.quran.newMemorization'),
    },
    {
      key: 'surah',
      header: t('student.quran.surah'),
      cell: (l) => names.get(l.surah_id) ?? String(l.surah_id),
    },
    { key: 'range', header: t('student.quran.range'), cell: (l) => `${l.start_ayah}–${l.end_ayah}` },
  ];
}

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
