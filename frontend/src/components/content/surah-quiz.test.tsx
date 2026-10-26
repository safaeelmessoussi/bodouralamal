import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { QuizDialog, stars, verdict } from './surah-quiz.js';
import { SURAH_QUIZZES } from './surah-quizzes.js';

describe('R241 — al-Fatiha: a quiz for each of its 20 recorded lessons, and a final one', () => {
  const fatiha = SURAH_QUIZZES[1]!;
  const all = [...Object.values(fatiha.lessons), fatiha.final!];

  it('has them all, each question with one valid answer among two to four choices', () => {
    expect(Object.keys(fatiha.lessons)).toHaveLength(20);
    expect(fatiha.final!.questions.length).toBeGreaterThanOrEqual(10);
    for (const q of all.flatMap((quiz) => quiz.questions)) {
      expect(q.choices.length).toBeGreaterThanOrEqual(2);
      expect(q.choices.length).toBeLessThanOrEqual(4);
      expect(q.answer).toBeLessThan(q.choices.length);
    }
  });

  it('never addresses the reader as feminine or masculine (R197)', () => {
    const texts = all.flatMap((quiz) => quiz.questions.flatMap((q) => [q.q, q.why ?? '', ...q.choices]));
    expect(texts.filter((s) => /(^|\s)(اختاري|اختر|تذكّ?ري|انتبهي|فكّ?ري)(\s|$)/.test(s))).toEqual([]);
  });
});

/** R241 — «اختبار الفهم»: one question at a time, marked at once, scored at the end. */
describe('R241 — a lesson quiz', () => {
  const quiz = {
    questions: [
      { q: 'ما محور سورة الفاتحة؟', choices: ['الهداية', 'القتال'], answer: 0, why: '﴿اِهْدِنَا اَ۬لصِّرَٰطَ﴾' },
      { q: 'كم آية في الفاتحة؟', choices: ['6', '7'], answer: 1 },
    ],
  };

  it('opens on its first question, its choices, and nothing marked yet', () => {
    const html = renderToStaticMarkup(<QuizDialog quiz={quiz} title="اختبار الفهم" onClose={() => undefined} />);
    expect(html).toContain('ما محور سورة الفاتحة؟');
    expect(html).toContain(ar.content.quiz.question.replace('{n}', '1').replace('{total}', '2'));
    expect(html.match(/class="surah-quiz__choice"/g)).toHaveLength(2);
    expect(html).not.toContain('surah-quiz__feedback');
    // «التالي» waits for a choice.
    expect(html).toMatch(/class="surah-quiz__next" disabled/);
  });

  it('gives three stars from 90 %, two from 60 %, one below — and says so', () => {
    expect([stars(9, 10), stars(6, 10), stars(5, 10)]).toEqual([3, 2, 1]);
    expect([verdict(10, 10), verdict(7, 10), verdict(2, 10)]).toEqual(['great', 'good', 'review']);
    expect(ar.content.quiz.open).toBe('اختبار الفهم');
  });
});
