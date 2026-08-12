import { describe, expect, it } from 'vitest';

// Raw text through Vite rather than `node:fs`, for the reason the scheduling
// parity guard gives: the production build typechecks this file too, and
// pulling Node's types in for one test would put them on the whole
// application's type surface.
import PAGE from './subject-organisation.tsx?raw';
import AR from '../../i18n/ar.ts?raw';

/** Comments are not code. The scheduling guard learned this by failing on its
 *  own prose; the same stripping applies here, where the fix's rationale is
 *  written in a docstring naming the very symbol being asserted absent. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **حلقات المواد — the selector may only offer what the server will accept.**
 *
 * The screen populated its Subject dropdown from `listSubjects`, the platform's
 * whole Subject list, independently of the chosen Level. A Level with no
 * assigned Subject therefore showed a full dropdown, and saving produced
 * `SUBJECT_NOT_IN_LEVEL` — the server correct every time, because a Circle
 * splits a Subject *within a Level* and the pair must exist first (§4.4c).
 *
 * The property is the one R60 states for roles, applied to data: **the
 * affordance follows the authority**. A control that can only be refused is the
 * defect, and weakening the validation would have been the wrong repair.
 */
describe('the Subject selector is fed from the Level, not from the platform', () => {
  it('reads the Level’s own subjects', () => {
    expect(code(PAGE)).toContain('listLevelSubjects(levelId');
  });

  it('does not reach for the global Subject list', () => {
    // Presence is not absence — the lesson the scheduling guard records. A page
    // that fetched both would satisfy the assertion above and still offer a
    // Subject the Level does not teach.
    expect(code(PAGE)).not.toContain('listSubjects(');
  });

  it('answers a Level that teaches nothing instead of offering a doomed choice', () => {
    expect(code(PAGE)).toContain('admin.subjectOrg.noSubjects');
    // …and sends the reader to the screen that fixes it (R69's own node).
    expect(code(PAGE)).toContain('/admin/level-subjects?level=');
  });
});

/**
 * The form dialog is the shared one. `FormDialog` was extracted to end exactly
 * this drift — a form assembling its own actions row aligns its buttons
 * differently from every other form in the back office — and this screen was
 * the one instance that survived the extraction.
 */
describe('the circle form uses the shared dialog', () => {
  it('renders through FormDialog', () => {
    expect(code(PAGE)).toContain('<FormDialog');
  });

  it('hand-rolls neither the frame nor the actions row', () => {
    expect(code(PAGE)).not.toContain('dialog__actions');
    expect(code(PAGE)).not.toContain('<Dialog');
  });

  it('shows a refusal inside the dialog that caused it', () => {
    // It used to render behind the open modal, so «هذه المادة غير مسندة إلى هذا
    // المستوى» was invisible and the only feedback was the raw conflict.
    expect(code(PAGE)).toContain('notice={notice}');
  });
});

/**
 * **The retired rule leaves the interface too** (R66).
 *
 * `LAST_GROUP_IN_LEVEL` stopped existing in the service when a Level was
 * allowed to have no groups, but the deletion dialog kept warning that a group
 * could not be removed *"if it was the only one in its Level"*. A group refused
 * for one of the two surviving reasons then read as the retired rule still
 * biting — which is how an obsolete sentence outlives the code it described.
 */
describe('the group-deletion warning names only the rules that exist', () => {
  it('no longer claims the last group in a Level is protected', () => {
    expect(AR).not.toContain('كانت الوحيدة في مستواها');
    expect(AR).toContain('لا يمكن حذف مجموعة تضم مستفيدات أو يستهدفها جدول حصص.');
  });

  it('carries no string for a refusal the server cannot send', () => {
    expect(code(AR)).not.toContain('refused_LAST_GROUP_IN_LEVEL');
  });

  it('keeps a named message for each refusal that CAN arrive', () => {
    expect(code(AR)).toContain('refused_ENROLMENTS_EXIST');
    expect(code(AR)).toContain('refused_SCHEDULES_EXIST');
  });
});
