import { describe, expect, it } from 'vitest';

import { t } from '../../i18n/index.js';
import builder from './assessments.tsx?raw';

/**
 * **R137 — question points, and full question/option CRUD** (بناء الاختبارات).
 *
 * Follows `assessment-ui.test.ts`'s own convention for this file: a
 * source-text guard over the real component, since `QuestionDialog` is not
 * exported and re-deriving its render context (`AssessmentPaper`, session,
 * active-role) for a full mount adds more risk of drift than it removes.
 * The domain rule itself — points must be unset-or-complete and sum to
 * `max_grade` — is proven at the server, in `assessment.integration.test.ts`;
 * this file pins that the CLIENT actually offers the field, the edit action,
 * and a real per-option remove control, and asks for the same shape.
 */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const SOURCE = code(builder);

describe('optional per-question points (R137)', () => {
  it('the question dialog offers a points field, never required', () => {
    expect(SOURCE).toContain("label={t('assessments.questionPoints')}");
    // NumberField, not TextField — a grade allocation is numeric.
    expect(SOURCE).toMatch(/<NumberField\s+label=\{t\('assessments\.questionPoints'\)\}/);
    expect(SOURCE).not.toContain("required\n        error={touched ? pointsError");
  });

  it('a positive-only validation error exists and is shown once touched', () => {
    expect(SOURCE).toContain('questionPointsInvalid');
    expect(SOURCE).toContain('error={touched ? pointsError : null}');
  });

  it('creating never sends a null points value — nothing to clear yet', () => {
    expect(SOURCE).toContain('points === null || points === undefined ? {} : { points }');
  });

  it('editing sends points through as-is, including null, so a clear actually clears', () => {
    expect(SOURCE).toContain('initial ? { points: pointsValue }');
  });

  it('the question list shows the allocation to whoever reads the paper — author and student alike', () => {
    expect(SOURCE).toContain("t('assessments.questionPointsOf').replace('{points}', q.points)");
    expect(SOURCE).toContain('q.points !== null');
  });

  it('the real Arabic wording never implies automatic grading', () => {
    // The whole point (R137): a maximum, never an earned mark.
    expect(t('assessments.questionPointsHint')).toContain('النقطة القصوى');
    expect(t('assessments.questionPointsHint')).not.toMatch(/تُمنح|تحتسب تلقائياً/);
  });
});

describe('question CRUD is complete — create, edit, delete, reorder (R137)', () => {
  it('a تعديل action exists per question, opening the SAME dialog as إضافة', () => {
    expect(SOURCE).toContain('onClick={() => setEditingQuestion(q)}');
    expect(SOURCE).toContain("{t('common.edit')}");
    // One component, two modes — not a second dialog.
    const dialogDeclarations = SOURCE.match(/function QuestionDialog\(/g) ?? [];
    expect(dialogDeclarations).toHaveLength(1);
  });

  it('editing calls updateQuestion with the row’s own id and TD-15 version', () => {
    expect(SOURCE).toContain(
      'updateQuestion(examId, editingQuestion.id, version, input, token)',
    );
  });

  it('the question kind is fixed once a question exists — a new kind is a new question', () => {
    expect(SOURCE).toContain('disabled={initial !== undefined}');
    expect(SOURCE).toContain('questionTypeFixed');
  });

  it('create, delete, and reorder (move up/down) all remain reachable', () => {
    expect(SOURCE).toContain('setAdding(true)');
    expect(SOURCE).toContain('removeQuestion(examId, q.id, token)');
    expect(SOURCE).toContain('void move(index, -1)');
    expect(SOURCE).toContain('void move(index, 1)');
  });
});

describe('multiple-choice option CRUD (R137)', () => {
  it('a remove control exists beside every option, in both create and edit', () => {
    expect(SOURCE).toContain("{t('assessments.removeOption')}");
    expect(SOURCE).toContain('setOptions(options.filter((_, i) => i !== index))');
  });

  it('removal is refused below two options — the shape a choice question needs', () => {
    expect(SOURCE).toContain('disabled={options.length <= 2}');
  });

  it('an invalid (too-few-options) question cannot be saved — the existing count check still gates submit', () => {
    expect(SOURCE).toContain('isChoice && filled.length < 2');
  });

  it('there is no correct-answer index or flag anywhere to dangle on removal', () => {
    // This codebase has no correct-answer concept for MCQ at all (grading is
    // manual, R124/§4.6) — confirmed against the actual schema/service before
    // writing this test. Nothing here should invent one.
    expect(SOURCE).not.toMatch(/isCorrect|correctOption|correct_answer/i);
  });

  it('the add-option control reads as an actual action button (R137 item 6)', () => {
    expect(SOURCE).toContain("<Button variant=\"add\" onClick={() => setOptions([...options, ''])}>");
  });
});
