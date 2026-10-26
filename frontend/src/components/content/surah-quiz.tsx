import { useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { humanityDictionary } from '../history/humanity-i18n.js';
import { Verse } from '../history/humanity-diagram.js';
import { Dialog } from '../ui/dialog.js';
import { SURAH_QUIZZES, type Quiz } from './surah-quizzes.js';

/**
 * **SRS Revision 241 — «اختبار الفهم» for a lesson, and a final one for the
 * Surah** (the Owner, 2026-10-25: «for each recording of surah al fatiha,
 * generate an entertaining quiz … and add a final quiz to test if all the
 * recordings were well understood»). One question at a time; a choice is
 * marked at once, right or wrong, with a line saying why; the score closes it,
 * and the best one is kept on this device. Al-Fatiha first: if readers like
 * it, every Surah follows.
 */
export function quizFor(surah: number, key: string): Quiz | null {
  const quizzes = SURAH_QUIZZES[surah];
  const quiz = key === 'final' ? quizzes?.final : quizzes?.lessons[key];
  return quiz ? localise(quiz, `quiz|${String(surah)}|${key}`) : null;
}

/** The public pages' languages: the same dictionary «نظرة شاملة» reads. */
function localise(quiz: Quiz, key: string): Quiz {
  const dict = humanityDictionary();
  if (!dict) return quiz;
  const say = (k: string, arabic: string): string => dict[k] ?? arabic;
  return {
    questions: quiz.questions.map((q, i) => ({
      ...q,
      q: say(`${key}|${String(i)}|q`, q.q),
      choices: q.choices.map((c, j) => say(`${key}|${String(i)}|c${String(j)}`, c)),
      ...(q.why ? { why: say(`${key}|${String(i)}|why`, q.why) } : {}),
    })),
  };
}

const bestKey = (key: string): string => `bodour.quiz.${key}`;

export function bestScore(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(bestKey(key));
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function keepBest(key: string, score: number): void {
  try {
    const was = bestScore(key);
    if (was === null || score > was) window.localStorage.setItem(bestKey(key), String(score));
  } catch {
    // Storage refused: the score is simply not kept.
  }
}

/** The button that opens a quiz, with the best score so far on this device. */
export function QuizButton({
  surah,
  quizKey,
  label,
  final = false,
}: {
  surah: number;
  quizKey: string;
  label: string;
  final?: boolean;
}): ReactNode {
  const quiz = quizFor(surah, quizKey);
  const [open, setOpen] = useState(false);
  const [best, setBest] = useState<number | null>(() => bestScore(`${String(surah)}.${quizKey}`));
  if (!quiz || quiz.questions.length === 0) return null;
  const total = quiz.questions.length;
  return (
    <>
      <button
        type="button"
        className={final ? 'surah-quiz__open surah-quiz__open--final' : 'surah-quiz__open'}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">★</span> {label}
        {best !== null ? (
          <span className="surah-quiz__best">
            {t('content.quiz.best').replace('{n}', String(best)).replace('{total}', String(total))}
          </span>
        ) : null}
      </button>
      {open ? (
        <QuizDialog
          quiz={quiz}
          title={label}
          onClose={(score) => {
            if (score !== null) {
              keepBest(`${String(surah)}.${quizKey}`, score);
              setBest(bestScore(`${String(surah)}.${quizKey}`));
            }
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function QuizDialog({
  quiz,
  title,
  onClose,
}: {
  quiz: Quiz;
  title: string;
  /** The score when the quiz was finished, `null` when left before the end. */
  onClose: (score: number | null) => void;
}): ReactNode {
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  const [done, setDone] = useState(false);
  const total = quiz.questions.length;
  const question = quiz.questions[at]!;

  const restart = (): void => {
    setAt(0);
    setPicked(null);
    setRight(0);
    setDone(false);
  };

  return (
    <Dialog open onClose={() => onClose(done ? right : null)} title={title}>
      {done ? (
        <div className="surah-quiz__result" role="status">
          <p className="surah-quiz__stars" aria-hidden="true">
            {'★'.repeat(stars(right, total))}
            <span className="surah-quiz__stars-off">{'★'.repeat(3 - stars(right, total))}</span>
          </p>
          <p className="surah-quiz__score">
            {t('content.quiz.score').replace('{n}', String(right)).replace('{total}', String(total))}
          </p>
          <p>{t(`content.quiz.verdict.${verdict(right, total)}`)}</p>
          <div className="surah-quiz__actions">
            <button type="button" className="surah-quiz__next" onClick={restart}>
              {t('content.quiz.again')}
            </button>
            <button type="button" className="surah-quiz__secondary" onClick={() => onClose(right)}>
              {t('content.quiz.close')}
            </button>
          </div>
        </div>
      ) : (
        <div className="surah-quiz">
          <p className="surah-quiz__progress">
            {t('content.quiz.question').replace('{n}', String(at + 1)).replace('{total}', String(total))}
          </p>
          <ol className="surah-quiz__dots" aria-hidden="true">
            {quiz.questions.map((_, i) => (
              <li key={i} className={i < at ? 'is-done' : i === at ? 'is-current' : undefined} />
            ))}
          </ol>
          <p className="surah-quiz__question">
            <Verse text={question.q} />
          </p>
          <ul className="surah-quiz__choices">
            {question.choices.map((choice, i) => {
              const state =
                picked === null ? '' : i === question.answer ? ' is-right' : i === picked ? ' is-wrong' : ' is-dim';
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`surah-quiz__choice${state}`}
                    disabled={picked !== null}
                    aria-pressed={picked === i}
                    onClick={() => {
                      setPicked(i);
                      if (i === question.answer) setRight((n) => n + 1);
                    }}
                  >
                    <Verse text={choice} />
                  </button>
                </li>
              );
            })}
          </ul>
          {picked !== null ? (
            <div className={`surah-quiz__feedback${picked === question.answer ? ' is-right' : ' is-wrong'}`} role="status">
              <strong>{t(picked === question.answer ? 'content.quiz.right' : 'content.quiz.wrong')}</strong>
              {question.why ? (
                <span>
                  {' '}
                  <Verse text={question.why} />
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="surah-quiz__actions">
            <button
              type="button"
              className="surah-quiz__next"
              disabled={picked === null}
              onClick={() => {
                if (at + 1 < total) {
                  setAt(at + 1);
                  setPicked(null);
                } else {
                  setDone(true);
                }
              }}
            >
              {t(at + 1 < total ? 'content.quiz.next' : 'content.quiz.finish')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** 3 stars from 90 %, 2 from 60 %, else 1. */
export function stars(right: number, total: number): number {
  const ratio = total === 0 ? 0 : right / total;
  return ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : 1;
}

export function verdict(right: number, total: number): 'great' | 'good' | 'review' {
  const n = stars(right, total);
  return n === 3 ? 'great' : n === 2 ? 'good' : 'review';
}
