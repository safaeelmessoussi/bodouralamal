import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  deleteLog,
  fetchCoverage,
  fetchQuranScope,
  logProgress,
  type QuranLogRow,
  type QuranScope,
  type QuranScopeLevel,
  type SurahCoverage,
} from '../../adapters/quran.js';
import { useSession } from '../../contexts/session.js';
import { levelLabel } from '../scope/level-select.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { DataTable, type SortState } from '../ui/data-table.js';
import { sortRows } from '../../lib/sort-rows.js';
import { Feedback } from '../ui/feedback.js';
import { SearchInput, SelectField, TextField } from '../ui/field.js';
import { ProgressBar } from '../ui/progress-bar.js';

/**
 * **إدخال الحفظ — one workspace, every portal that enters progress** (§C2,
 * rule C, 2026-08-20).
 *
 * The back office and the teaching portal ask the *same* operational question —
 * *record what this مستفيدة memorised* — so they render this one component
 * inside their own chrome rather than each owning a form. **What differs
 * between them is not the screen: it is what `/quran-students` answers**, which
 * is decided server-side by the caller's own token. An Admin sees her branches'
 * beneficiaries, a مؤطِّرة sees the beneficiaries whose Quran she teaches, and
 * neither client says which it is.
 *
 * That is rule O read forwards: the component never decides authorization, it
 * renders the dataset it was given, and the server refuses anything else.
 *
 * ## Three dependent selectors, and why the dependency is real here
 *
 * *whom* → *which Level* → *which Surah*. Rule AE says a dependency between
 * selectors belongs to **forms**, not filters — this is a form, and the
 * dependency is the curriculum: `LevelSurah` decides which Surahs a Level
 * teaches, so a Surah list means nothing until a Level is known.
 *
 * **One relevant Level opens directly; several ask** (§C10). Picking
 * `level_ids[0]` for a مستفيدة enrolled in two Levels would silently choose one
 * syllabus, and which one would depend on insertion order.
 *
 * ## A failed read is not an empty roster
 *
 * §C29, and the defect class this project has repeatedly shipped: the roster
 * load used to `catch { setStudents([]) }`, so a 401, a 403 or a 500 rendered
 * as «لا توجد مستفيدات». Only a 200 may say that. The states are distinct here
 * and the error one is `role="alert"`.
 */
export function QuranWorkspace({
  studentId,
  hrefFor,
}: {
  /** The مستفيدة being worked on, or `null` for the roster. */
  studentId: string | null;
  /** How this portal writes its own `?student=` link — the one thing that
   *  genuinely differs, because the two portals sit on different paths. */
  hrefFor: (studentId: string | null) => string;
}): ReactNode {
  const { accessToken } = useSession();

  const [scope, setScope] = useState<QuranScope | null>(null);
  const [scopeState, setScopeState] = useState<'loading' | 'ready' | 'error'>('loading');

  const [surahs, setSurahs] = useState<SurahCoverage[]>([]);
  const [logs, setLogs] = useState<QuranLogRow[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'forbidden'>('idle');

  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [rosterSort, setRosterSort] = useState<SortState | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<QuranLogRow | null>(null);

  const [levelId, setLevelId] = useState('');
  const [surahId, setSurahId] = useState('');
  const [startAyah, setStartAyah] = useState('');
  const [endAyah, setEndAyah] = useState('');
  const [category, setCategory] = useState<'new_memorization' | 'revision'>('new_memorization');

  useEffect(() => {
    void (async () => {
      setScopeState('loading');
      try {
        setScope(await fetchQuranScope(accessToken));
        setScopeState('ready');
      } catch {
        // **Never `setScope({students: [], levels: []})`** — see the docstring.
        setScopeState('error');
      }
    })();
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!studentId) return;
    setState('loading');
    try {
      const data = await fetchCoverage(studentId, accessToken);
      setSurahs(data.surahs);
      setLogs(data.logs);
      setState('ready');
    } catch (error) {
      // §20 rule 17 answers 404 for a مستفيدة outside scope; this screen reports
      // the server's refusal rather than pre-empting it.
      setState(error instanceof ApiError && error.status === 404 ? 'forbidden' : 'error');
    }
  }, [studentId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const student = scope?.students.find((s) => s.id === studentId) ?? null;

  /** The Levels this مستفيدة is in that the caller may also enter against. */
  const levels: QuranScopeLevel[] = useMemo(() => {
    if (!scope || !student) return [];
    return scope.levels.filter((l) => student.level_ids.includes(l.level_id));
  }, [scope, student]);

  // One Level → open it. Several → leave the selector empty so it must be
  // answered, rather than defaulting to whichever sorted first.
  useEffect(() => {
    setLevelId(levels.length === 1 ? levels[0]!.level_id : '');
    setSurahId('');
  }, [levels]);

  const level = levels.find((l) => l.level_id === levelId) ?? null;
  const surah = level?.surahs.find((s) => String(s.surah_id) === surahId) ?? null;

  /**
   * Immediate Arabic feedback (§C12) — **advisory, never the authority**. The
   * server validates every bound again, and the ayah count comes from the
   * Surah the server sent rather than a table hard-coded in React.
   */
  const rangeError = ((): string | null => {
    if (startAyah === '' && endAyah === '') return null;
    const from = Number(startAyah);
    const to = Number(endAyah);
    if (startAyah !== '' && (!Number.isInteger(from) || from < 1)) return t('quran.errFrom');
    if (endAyah === '') return null;
    if (!Number.isInteger(to) || to < 1) return t('quran.errTo');
    if (startAyah !== '' && to < from) return t('quran.errReversed');
    if (surah && to > surah.total_ayahs) {
      return `${t('quran.errPastEnd')} (${surah.total_ayahs})`;
    }
    return null;
  })();

  const canSubmit =
    !busy &&
    studentId !== null &&
    levelId !== '' &&
    surahId !== '' &&
    startAyah !== '' &&
    endAyah !== '' &&
    rangeError === null;

  async function submit(): Promise<void> {
    if (!studentId || !canSubmit) return;
    setBusy(true);
    setNotice(null);
    try {
      await logProgress(
        {
          student_id: studentId,
          level_id: levelId,
          surah_id: Number(surahId),
          start_ayah: Number(startAyah),
          end_ayah: Number(endAyah),
          category,
        },
        accessToken,
      );
      setStartAyah('');
      setEndAyah('');
      await load();
      setNotice(
        t(category === 'revision' ? 'quran.savedRevision' : 'quran.savedMemorization'),
      );
    } catch (error) {
      setNotice(refusal(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteLog(removing.id, accessToken);
      await load();
      setNotice(t('quran.deleted'));
    } catch (error) {
      setNotice(refusal(error));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  if (scopeState === 'error') {
    return (
      <p className="state" role="alert">
        {t('common.loadFailed')}
      </p>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = (scope?.students ?? []).filter(
    (s) => needle === '' || s.name_arabic.toLowerCase().includes(needle),
  );

  if (!studentId) {
    return (
      <>
        {notice ? <Feedback>{notice}</Feedback> : null}
        <DataTable
          caption={t('quran.rosterCaption')}
          columns={[
            {
              key: 'name',
              header: t('quran.colStudent'),
              sortKey: 'name',
              cell: (s) => s.name_arabic,
            },
          ]}
          /**
           * R76 — **the roster, and only the roster.** `/quran-students`
           * answers the whole scope unpaginated and this screen already filters
           * it in memory, so ordering what it holds IS ordering the collection.
           *
           * The memorisation sheet below never sorts: it holds per-row draft
           * state, and reordering rows under a مؤطِّرة mid-entry would move her
           * own unsaved work (Owner, 2026-08-26).
           */
          rows={sortRows(visible, rosterSort, { name: (s) => s.name_arabic })}
          sort={rosterSort}
          onSort={setRosterSort}
          rowKey={(s) => s.id}
          status={scopeState === 'loading' ? 'loading' : 'ready'}
          actions={[
            {
              label: t('quran.openStudent'),
              onSelect: (s) => {
                window.location.href = hrefFor(s.id);
              },
            },
          ]}
          filtered={needle !== ''}
          onClearFilters={() => setQuery('')}
          toolbar={
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t('quran.searchPlaceholder')}
            />
          }
        />
      </>
    );
  }

  if (state === 'loading' || scopeState === 'loading') {
    return <p className="state">{t('common.loading')}</p>;
  }
  if (state === 'forbidden') {
    return (
      <p className="state" role="alert">
        {t('quran.outOfScope')}
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p className="state" role="alert">
        {t('common.loadFailed')}
      </p>
    );
  }

  return (
    <>
      {notice ? <Feedback>{notice}</Feedback> : null}

      <p className="state" role="status">
        {t('quran.workingOn')} {student?.name_arabic ?? ''}
      </p>

      <section className="form">
        {levels.length === 0 ? (
          // Real and nameable: her Levels configure no Quran syllabus, so there
          // is nothing to enter against. Not an error, and not a silent form.
          <p className="state" role="status">
            {t('quran.noCurriculum')}
          </p>
        ) : (
          <>
            {levels.length > 1 ? (
              <SelectField
                label={t('quran.level')}
                value={levelId}
                onChange={(v) => {
                  setLevelId(v);
                  setSurahId('');
                }}
                options={[
                  { value: '', label: t('quran.chooseLevel') },
                  // Rule D — `{Category} — {Level}` through the SHARED label,
                  // because Level names are not unique across Categories
                  // (§4.4b) and a hand-written em dash is a second format.
                  ...levels.map((l) => ({
                    value: l.level_id,
                    label: levelLabel({
                      id: l.level_id,
                      name: l.level_name,
                      category_name: l.category_name,
                    }),
                  })),
                ]}
              />
            ) : null}

            <SelectField
              label={t('quran.surah')}
              value={surahId}
              onChange={setSurahId}
              // §C11 — the Level's own syllabus, never all 114. The list is
              // empty until a Level is known, which is the dependency.
              options={[
                { value: '', label: t('quran.chooseSurah') },
                ...(level?.surahs ?? []).map((s) => ({
                  value: String(s.surah_id),
                  label: s.name_arabic,
                })),
              ]}
            />

            <TextField
              label={t('quran.startAyah')}
              value={startAyah}
              onChange={setStartAyah}
              type="tel"
              required
            />
            <TextField
              label={t('quran.endAyah')}
              value={endAyah}
              onChange={setEndAyah}
              type="tel"
              required
              {...(rangeError ? { error: rangeError } : {})}
              {...(surah ? { hint: `${t('quran.ofTotal')} ${surah.total_ayahs}` } : {})}
            />
            <SelectField
              label={t('quran.category')}
              value={category}
              onChange={(v) => setCategory(v as 'new_memorization' | 'revision')}
              options={[
                { value: 'new_memorization', label: t('quran.newMemorization') },
                { value: 'revision', label: t('quran.revision') },
              ]}
            />
            <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
              {t('quran.log')}
            </Button>
          </>
        )}
      </section>

      <h2>{t('quran.coverage')}</h2>
      {surahs.length === 0 ? (
        <p className="state" role="status">
          {t('quran.noProgress')}
        </p>
      ) : (
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
      )}

      <h2>{t('quran.history')}</h2>
      <DataTable
        caption={t('quran.history')}
        columns={[
          {
            key: 'surah',
            header: t('quran.surah'),
            cell: (l: QuranLogRow) =>
              surahs.find((s) => s.surah_id === l.surah_id)?.name_arabic ?? String(l.surah_id),
          },
          {
            key: 'range',
            header: t('quran.range'),
            cell: (l: QuranLogRow) => `${l.start_ayah}–${l.end_ayah}`,
          },
          {
            key: 'category',
            header: t('quran.category'),
            cell: (l: QuranLogRow) =>
              t(l.category === 'revision' ? 'quran.revision' : 'quran.newMemorization'),
          },
          {
            key: 'by',
            header: t('quran.loggedBy'),
            cell: (l: QuranLogRow) => l.logged_by_name ?? '—',
          },
        ]}
        rows={logs}
        rowKey={(l) => l.id}
        status="ready"
        actions={[
          {
            label: t('common.delete'),
            danger: true,
            onSelect: (l: QuranLogRow) => setRemoving(l),
          },
        ]}
      />

      <ConfirmDialog
        open={removing !== null}
        title={t('quran.deleteTitle')}
        body={t('quran.deleteBody')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

/** The server's coded refusals, in Arabic. Anything unrecognised stays generic
 *  rather than being guessed at. */
function refusal(error: unknown): string {
  if (!(error instanceof ApiError)) return t('common.saveFailed');
  const reason = error.details['reason'];
  if (reason === 'AYAH_OUT_OF_RANGE') return t('quran.errPastEnd');
  if (reason === 'INVALID_RANGE') return t('quran.errReversed');
  if (reason === 'SURAH_NOT_IN_LEVEL') return t('quran.errSurahNotInLevel');
  if (reason === 'LEVEL_NOT_ENROLLED') return t('quran.errLevelNotEnrolled');
  if (error.status === 404) return t('quran.outOfScope');
  return t('common.saveFailed');
}
