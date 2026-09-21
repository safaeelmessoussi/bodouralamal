import type { ReactNode } from 'react';

import type { LevelCoverage } from '../../adapters/quran.js';
import { t } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { Badge } from '../ui/badge.js';

/**
 * **Has she completed this Level?** — SRS Revision 166 §1, BR-11.
 *
 * The verdict is the SERVER's (`policies/level-completion.ts`): every Surah of
 * the Level's «مقرر الحفظ» memorised and, where the Level teaches تفسير, an exam
 * taken on each. This only says it — on «حفظي» for the مستفيدة herself and on
 * the مؤطِّرة's Quran screen for whoever she is looking at, through one component
 * so the two cannot word one verdict two ways.
 *
 * **What is still missing is named**, Surah by Surah: «لم يكتمل بعد» with no
 * reason sends her to ask somebody what the screen already knows.
 */
export function LevelCompletionSummary({ level }: { level: LevelCoverage }): ReactNode {
  const c = level.completion;
  // An older server does not send it; say nothing rather than guess.
  if (!c) return null;

  if (c.complete === null) {
    return (
      <p className="field__hint" role="status">
        {c.marked_on ? (
          <Badge tone="ok">
            {t('quran.completion.complete')} — {formatDate(c.marked_on)}
          </Badge>
        ) : null}{' '}
        <Badge>{t('quran.completion.notConfigured')}</Badge>
      </p>
    );
  }

  const marked = c.marked_on ?? null;
  const count = (n: number): string =>
    t('quran.completion.outOf').replace('{n}', String(n)).replace('{total}', String(c.configured_surahs));
  const toMemorise = level.surahs.filter((s) => s.coverage_percent < 100).map((s) => s.name_arabic);
  const toSit = c.exams_required
    ? level.surahs.filter((s) => !s.exam_taken).map((s) => s.name_arabic)
    : [];

  return (
    <div className="level-completion" role="status">
      <p className="staff-picker__warnings">
        {/* R168 §3 — a Level is COMPLETED when the administration records it.
            What BR-11 reads is its conditions: progress, never the verdict. */}
        {marked ? (
          <Badge tone="ok">
            {t('quran.completion.complete')} — {formatDate(marked)}
          </Badge>
        ) : (
          <Badge tone={c.complete ? 'ok' : 'warn'}>
            {t(c.complete ? 'quran.completion.conditionsMet' : 'quran.completion.incomplete')}
          </Badge>
        )}
        <Badge>{`${t('quran.completion.memorised')} ${count(c.memorised_surahs)}`}</Badge>
        {c.exams_required ? (
          <Badge>{`${t('quran.completion.examined')} ${count(c.examined_surahs)}`}</Badge>
        ) : null}
      </p>
      {toMemorise.length > 0 ? (
        <p className="field__hint">
          {t('quran.completion.leftToMemorise')} {toMemorise.join('، ')}
        </p>
      ) : null}
      {toSit.length > 0 ? (
        <p className="field__hint">
          {t('quran.completion.leftToSit')} {toSit.join('، ')}
        </p>
      ) : null}
    </div>
  );
}
