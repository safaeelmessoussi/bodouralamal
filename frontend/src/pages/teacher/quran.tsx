import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  deleteLog,
  fetchCoverage,
  listQuranStudents,
  logProgress,
  type QuranLogRow,
  type QuranStudent,
  type SurahCoverage,
} from '../../adapters/quran.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { SelectField, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/teacher/quran?student=` — **تتبع الحفظ** (§4.5, BR-13; M4a, R73.1).
 *
 * §14.1 listed this at `/teacher/students/{id}/quran`, whose path carried an id
 * **no menu could supply** — the third occurrence of the defect R69 fixed for
 * `مواد المستوى` and R70.1 for grade entry. R73.1 gave it a node with the
 * student as `?student=`, the `/resources?level=` precedent.
 *
 * **The selector lists only the مستفيدات this caller may log for** (R73.3), from
 * the server's own predicate — so the screen cannot offer somebody the write
 * would refuse. A مؤطرة who teaches a مستفيدة only Fiqh does not see her here,
 * and would be refused if she tried anyway: the server is the authority.
 *
 * **Coverage arrives with every write.** §4.5 requires the corrected percentage
 * to be visible immediately, so the response updates the cards rather than the
 * screen refetching what the request already computed.
 */
export function TeacherQuranPage({ studentId }: { studentId: string | null }): ReactNode {
  const { accessToken } = useSession();

  const [students, setStudents] = useState<QuranStudent[]>([]);
  const [surahs, setSurahs] = useState<SurahCoverage[]>([]);
  const [logs, setLogs] = useState<QuranLogRow[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'forbidden'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<QuranLogRow | null>(null);

  const [surahId, setSurahId] = useState('1');
  const [startAyah, setStartAyah] = useState('');
  const [endAyah, setEndAyah] = useState('');
  const [category, setCategory] = useState<'new_memorization' | 'revision'>('new_memorization');

  useEffect(() => {
    void (async () => {
      try {
        setStudents(await listQuranStudents(accessToken));
      } catch {
        setStudents([]);
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
      // The server's refusal is rendered as one — §20 rule 17 answers 404 for a
      // student outside scope, and this screen reports rather than pre-empts.
      setState(error instanceof ApiError && error.status === 404 ? 'forbidden' : 'error');
    }
  }, [studentId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(): Promise<void> {
    if (!studentId) return;
    setBusy(true);
    setNotice(null);
    try {
      await logProgress(
        {
          student_id: studentId,
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
      setNotice(t('teacher.quran.logged'));
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
      setNotice(t('teacher.quran.deleted'));
    } catch (error) {
      setNotice(refusal(error));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  const student = students.find((s) => s.id === studentId) ?? null;

  return (
    <TeacherLayout
      title={student ? student.name_arabic : t('teacher.nav.quran')}
      lede={t('teacher.quran.lede')}
    >
      {/* R73.1 — the page asks which مستفيدة, because a menu entry cannot supply
          an id. The list is the server's own scope predicate. */}
      <SelectField
        label={t('teacher.quran.student')}
        value={studentId ?? ''}
        onChange={(next) => {
          if (next === '') return;
          window.location.href = `/teacher/quran?student=${next}`;
        }}
        placeholder={t('common.choose')}
        options={students.map((s) => ({ value: s.id, label: s.name_arabic }))}
        hint={students.length === 0 ? t('teacher.quran.noStudents') : undefined}
      />

      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {!studentId ? (
        <p className="state">{t('teacher.quran.pickStudent')}</p>
      ) : state === 'loading' ? (
        <p className="state">{t('common.loading')}</p>
      ) : state === 'forbidden' ? (
        <p className="state" role="alert">
          {t('teacher.quran.outOfScope')}
        </p>
      ) : state === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : (
        <>
          <section className="form">
            <SelectField
              label={t('teacher.quran.surah')}
              value={surahId}
              onChange={setSurahId}
              // 114, from the seeded lookup — the definitive list (§4.5). Names
              // come from the coverage read once a surah has logs; before that
              // the number is what the مؤطرة has in front of her in the mushaf.
              options={Array.from({ length: 114 }, (_, i) => ({
                value: String(i + 1),
                label:
                  surahs.find((s) => s.surah_id === i + 1)?.name_arabic ??
                  `${t('teacher.quran.surah')} ${i + 1}`,
              }))}
            />
            <TextField
              label={t('teacher.quran.startAyah')}
              value={startAyah}
              onChange={setStartAyah}
              type="tel"
              required
            />
            <TextField
              label={t('teacher.quran.endAyah')}
              value={endAyah}
              onChange={setEndAyah}
              type="tel"
              required
              hint={t('teacher.quran.rangeHint')}
            />
            <SelectField
              label={t('teacher.quran.category')}
              value={category}
              onChange={(v) => setCategory(v as 'new_memorization' | 'revision')}
              options={[
                { value: 'new_memorization', label: t('teacher.quran.newMemorization') },
                { value: 'revision', label: t('teacher.quran.revision') },
              ]}
            />
            <Button
              variant="primary"
              disabled={busy || startAyah === '' || endAyah === ''}
              onClick={() => void submit()}
            >
              {t('teacher.quran.log')}
            </Button>
          </section>

          <h2>{t('teacher.quran.coverage')}</h2>
          {surahs.length === 0 ? (
            // A named state: nothing logged yet is different from a failed load.
            <p className="state" role="status">
              {t('teacher.quran.noProgress')}
            </p>
          ) : (
            <ul className="admin-list">
              {surahs.map((s) => (
                <li key={s.surah_id}>
                  <span>{s.name_arabic}</span>
                  {/* BR-13's union, as a percentage of the Surah's own total —
                      "the definitive denominator" (§4.5). */}
                  <span>
                    {s.coverage_percent}% — {s.merged_ayah_count}/{s.total_ayahs}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2>{t('teacher.quran.history')}</h2>
          {logs.length === 0 ? (
            <p className="state" role="status">
              {t('teacher.quran.noLogs')}
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">{t('teacher.quran.surah')}</th>
                  <th scope="col">{t('teacher.quran.range')}</th>
                  <th scope="col">{t('teacher.quran.category')}</th>
                  <th scope="col">{t('teacher.quran.loggedBy')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {surahs.find((s) => s.surah_id === l.surah_id)?.name_arabic ?? l.surah_id}
                    </td>
                    <td>
                      {l.start_ayah}–{l.end_ayah}
                    </td>
                    <td>
                      {t(
                        l.category === 'revision'
                          ? 'teacher.quran.revision'
                          : 'teacher.quran.newMemorization',
                      )}
                    </td>
                    <td>{l.logged_by_name ?? '—'}</td>
                    <td>
                      <Button variant="secondary" onClick={() => setRemoving(l)}>
                        {t('common.delete')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t('teacher.quran.deleteTitle')}
        body={t('teacher.quran.deleteBody')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setRemoving(null)}
      />
    </TeacherLayout>
  );
}

function refusal(error: unknown): string {
  if (!(error instanceof ApiError)) return t('common.saveFailed');
  const reason = error.details['reason'];
  if (reason === 'AYAH_OUT_OF_RANGE') return t('teacher.quran.ayahOutOfRange');
  if (reason === 'INVALID_RANGE') return t('teacher.quran.invalidRange');
  if (error.status === 404) return t('teacher.quran.outOfScope');
  return t('common.saveFailed');
}
