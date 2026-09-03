import { describe, expect, it } from 'vitest';

import builder from './assessments.tsx?raw';
import studentPage from '../dashboard/assessments.tsx?raw';
import adapter from '../../adapters/assessments.ts?raw';
import teacherPage from '../teacher/assessments.tsx?raw';

/**
 * **The assessment interface's rules, as opposed to its styling** (SRS §4.6,
 * R124).
 *
 * Source guards rather than renders, for the reason the sibling guards give:
 * each of these is a **decision about what is offered**, and a render test
 * proves it for one fixture while a missing branch ships for every other.
 */

describe('R124 — SAVE is not SUBMIT', () => {
  it('sends them to different routes, and only one is called from a confirmation', () => {
    // The Owner's distinction, and the whole shape of the student page: a draft
    // can be returned to, and a submission cannot be undone.
    expect(adapter).toContain("/responses");
    expect(adapter).toContain("/submit");
    expect(studentPage).toContain('assessments.submitConfirm');
    expect(studentPage).toContain('ConfirmDialog');
  });

  it('never autosaves and never autosubmits', () => {
    // A closed browser leaves a draft. An assessment that submitted itself
    // because a phone locked would be a mark nobody chose to hand in.
    expect(studentPage).not.toMatch(/setInterval|beforeunload|visibilitychange/);
  });

  it('locks every control once she has sent her answers', () => {
    expect(studentPage).toContain("paper?.submission?.state === 'submitted'");
    expect(studentPage).toContain('disabled={sent}');
  });
});

describe('R124 — a student sees her own paper and nothing else', () => {
  it('has no route that could ask for another student’s answers', () => {
    // The staff reader lives on the builder; nothing on her page addresses a
    // student id at all.
    expect(studentPage).not.toContain('readSubmission');
    expect(studentPage).not.toContain('listSubmissions');
    expect(studentPage).not.toContain('student_id');
  });

  it('tells her the grade is withheld rather than showing a draft one', () => {
    expect(studentPage).toContain('assessments.gradeWithheld');
    // The mark itself is not on this screen at any status — it reaches her
    // through the grades surface that already exists.
    expect(studentPage).not.toContain('score');
  });
});

describe('R124 — the builder offers only what the server accepts', () => {
  it('sends options and justification only on a choice question', () => {
    // The server refuses the other combinations rather than dropping them, so
    // offering them would produce a refusal the author cannot act on.
    expect(builder).toContain('...(isChoice ? { justification, options: filled } : {})');
  });

  it('reorders with up/down and adds no drag-and-drop library', () => {
    expect(builder).toContain('assessments.moveUp');
    expect(builder).toContain('assessments.moveDown');
    expect(builder).not.toMatch(/dnd|draggable|sortablejs/i);
  });

  it('stops offering edits once somebody has submitted', () => {
    // The freeze is the server's rule; the interface states it instead of
    // showing controls that answer 409.
    expect(builder).toContain("rows.some((r) => r.state !== 'in_progress')");
    expect(builder).toContain('assessments.frozen');
  });

  it('does not grade here — the sheet that already exists does', () => {
    expect(builder).toContain('assessments.grading');
    expect(builder).not.toContain('/grades');
  });

  it('refuses to open an in-progress submission, and says why', () => {
    expect(builder).toContain('assessments.inProgressNotReadable');
  });
});

describe('R124 — the whole sequence, and the occurrence’s own date', () => {
  it('sends every question id when reordering (R76)', () => {
    expect(adapter).toContain('questions/order');
    expect(builder).toContain('paper.questions.map((q) => q.id)');
  });

  it('asks for no date on a session target', () => {
    // A quick test belongs to the occurrence's day; a second date could
    // disagree with it about which students were expected.
    expect(builder).toContain("const needsDate = targetKind !== 'session';");
  });
});

describe('R124 — one builder, two frames', () => {
  it('the teaching portal renders the shared BODY inside its own chrome', () => {
    /**
     * **The defect this pins.** `/teacher/assessments` first routed straight to
     * the back-office page, which dragged `AdminLayout` — and with it the
     * administration sidebar — into the teaching portal: a مؤطِّرة saw the back
     * office's navigation and none of her own. A browser check caught it; no
     * unit test could have, because both frames render perfectly well alone.
     *
     * The property is R70.1's, applied again: one implementation, two ways in.
     */
    expect(teacherPage).toContain('AssessmentsView');
    expect(teacherPage).toContain('TeacherLayout');
    // The property is *does not IMPORT it*, not *does not mention it* — the
    // comment above the component names the defect and must stay free to.
    expect(teacherPage).not.toMatch(/import\s*\{[^}]*AdminLayout/);
    expect(teacherPage).not.toContain('<AdminLayout');
    // And the shared body itself owns no frame — it takes one.
    expect(builder).toContain('layout: PortalLayout');
    expect(builder).toContain('export function AssessmentsView');
  });
});
