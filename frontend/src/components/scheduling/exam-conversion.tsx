import { useEffect, useState, type ReactNode } from 'react';

import {
  convertSessionToExam,
  readExamConversion,
  type ExamConversionFacts,
} from '../../adapters/sessions.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { levelLabel } from '../scope/level-select.js';
import { Button } from '../ui/button.js';
import { Feedback } from '../ui/feedback.js';
import { SelectField, TextField } from '../ui/field.js';

/**
 * **R269 — «تعديل الحصة» → النوع** (the Owner, 2026-11-14: «in تعديل الحصة of
 * that session, i want to be able to change its type to exam»).
 *
 * The facts are the server's (`GET /sessions/{id}/exam-conversion`): which exam
 * types exist, the class's own Levels with the Subjects and Surahs each holds,
 * and what to open on. Nothing here decides who may convert — a reader the
 * server refuses simply gets no «النوع» field.
 */
export function useExamConversion(sessionId: string, token: string | null): ExamConversionFacts | null {
  const [facts, setFacts] = useState<ExamConversionFacts | null>(null);
  useEffect(() => {
    let live = true;
    readExamConversion(sessionId, token)
      .then((result) => {
        if (live) setFacts(result);
      })
      .catch(() => {
        if (live) setFacts(null);
      });
    return () => {
      live = false;
    };
  }, [sessionId, token]);
  return facts;
}

/** «النوع»: the class as it is, or one of the exam types. */
export function SessionTypeField({
  facts,
  value,
  onChange,
}: {
  facts: ExamConversionFacts;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <SelectField
      label={t('admin.sessions.typeLabel')}
      value={value}
      onChange={onChange}
      hint={t('admin.sessions.typeHint')}
      options={[
        { value: '', label: t('admin.sessions.typeClass') },
        ...facts.exam_types.map((type) => ({ value: type.id, label: type.name })),
      ]}
    />
  );
}

/** What an exam needs and a class does not say — the rest is the class's own. */
export function ExamConversionFields({
  sessionId,
  facts,
  typeId,
  token,
  onCancel,
  onConverted,
}: {
  sessionId: string;
  facts: ExamConversionFacts;
  typeId: string;
  token: string | null;
  onCancel: () => void;
  onConverted: () => void;
}): ReactNode {
  const [levelId, setLevelId] = useState(facts.level_id ?? '');
  const level = facts.levels.find((l) => l.id === levelId) ?? null;
  const subjects = level?.subjects ?? [];
  const [subjectId, setSubjectId] = useState(facts.subject_id ?? '');
  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  const [surahId, setSurahId] = useState(facts.surah_id === null ? '' : String(facts.surah_id));
  const [maxGrade, setMaxGrade] = useState(String(facts.max_grade));
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  // A Subject the chosen Level does not teach is not kept unseen.
  useEffect(() => {
    if (level && subjectId !== '' && !level.subjects.some((s) => s.id === subjectId)) setSubjectId('');
  }, [level, subjectId]);
  const asksSurah = subject?.requires_surahs === true && (level?.surahs.length ?? 0) > 0;

  async function submit(): Promise<void> {
    const max = Number(maxGrade.replace(',', '.'));
    if (levelId === '') return setIssue(t('admin.sessions.convertNeedsLevel'));
    if (subjectId === '') return setIssue(t('admin.sessions.convertNeedsSubject'));
    if (!Number.isFinite(max) || max <= 0) return setIssue(t('admin.sessions.convertBadMax'));
    setBusy(true);
    setIssue(null);
    try {
      await convertSessionToExam(
        sessionId,
        {
          scheduling_type_id: typeId,
          level_id: levelId,
          subject_id: subjectId,
          surah_id: asksSurah && surahId !== '' ? Number(surahId) : null,
          max_grade: max,
          version: facts.version,
        },
        token,
      );
      onConverted();
    } catch (error) {
      setIssue(
        error instanceof ApiError && error.code === 'VERSION_CONFLICT'
          ? t('profile.versionConflict')
          : t('admin.sessions.convertFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Feedback>{t('admin.sessions.convertHint')}</Feedback>
      {facts.levels.length > 1 || levelId === '' ? (
        <SelectField
          label={t('admin.sessions.convertLevel')}
          value={levelId}
          onChange={setLevelId}
          options={[
            { value: '', label: '—' },
            ...facts.levels.map((l) => ({ value: l.id, label: levelLabel(l) })),
          ]}
        />
      ) : null}
      <SelectField
        label={t('admin.sessions.convertSubject')}
        value={subjectId}
        onChange={setSubjectId}
        options={[{ value: '', label: '—' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]}
      />
      {asksSurah ? (
        <SelectField
          label={t('admin.sessions.convertSurah')}
          value={surahId}
          onChange={setSurahId}
          options={[
            { value: '', label: t('admin.sessions.convertSurahNone') },
            ...(level?.surahs ?? []).map((s) => ({ value: String(s.id), label: s.name })),
          ]}
        />
      ) : null}
      <TextField label={t('admin.sessions.convertMax')} value={maxGrade} onChange={setMaxGrade} />
      {issue ? <Feedback tone="warn">{issue}</Feedback> : null}
      <div className="form__actions">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {t('admin.sessions.convertSubmit')}
        </Button>
      </div>
    </>
  );
}
