import { describe, expect, it } from 'vitest';

import DIALOG from './session-audience-dialog.tsx?raw';
import PAGE from '../../pages/admin/schedule-sessions.tsx?raw';
import { ar } from '../../i18n/ar.js';

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **R92 — the audience override's interface half.**
 *
 * The properties guarded are the ones that would fail silently: an ambiguous
 * override rule, a venue that looks editable, an action offered where the server
 * would refuse it, and copy that lets an administrator believe she moved the
 * class.
 */
describe('replacement, not addition — and the control says which', () => {
  it('seeds the selection with the INHERITED branch', () => {
    // This is what makes *replacement* the only rule anybody has to hold: to
    // combine, you add the second branch to one already chosen. An empty start
    // would make the same submission mean "instead of", and nobody could tell
    // the two apart from the screen.
    expect(code(DIALOG)).toContain('r.audience_branches.map((b) => b.id)');
    expect(code(DIALOG)).toContain('setChosen(ids)');
  });

  it('says that clearing every branch restores the usual audience', () => {
    expect(ar.admin.sessions.audienceBranchesHint).toContain('أزيلي كل الفروع');
  });

  it('says it affects THIS occurrence only', () => {
    // The thing an administrator would otherwise have to infer from what did
    // not change — the same reasoning the one-off staffing dialog records.
    expect(ar.admin.sessions.audienceHint).toContain('هذه الحصة وحدها');
    expect(ar.admin.sessions.audienceHint).toContain('القادمة');
  });
});

describe('the venue is a different fact, and is not editable here', () => {
  it('renders it as text, never as a control', () => {
    expect(code(DIALOG)).toContain('roster.venue.branch_name');
    // A branch SELECT for the venue would say this screen moves the class.
    expect(code(DIALOG)).not.toContain('label={t(\'admin.sessions.audienceVenue\')}');
  });

  it('names it separately from the audience in the copy', () => {
    expect(ar.admin.sessions.audienceVenue).not.toBe(ar.admin.sessions.audienceBranches);
    expect(ar.admin.sessions.audienceHint).toContain('مكانها المعتاد');
  });
});

describe('the action is offered only where the server would accept it', () => {
  it('whole-Level classes only (§14.4 — never offer a refusal)', () => {
    // In the other two modes the branch is carried by the target itself, so a
    // branch list has no meaning and the write refuses it.
    expect(code(PAGE)).toContain("klass?.teachingMode === 'entire_level'");
  });

  it('and it lives on the OCCURRENCE screen, not the recurring form', () => {
    expect(code(PAGE)).toContain('<SessionAudienceDialog');
  });
});

describe('the roster is shown, not inferred', () => {
  it('lists the expected students with the branch each comes from', () => {
    // §B12 — an administrator must not have to read calendar behaviour to learn
    // who is coming.
    expect(code(DIALOG)).toContain('roster.students.map');
    expect(code(DIALOG)).toContain('s.branch_id');
  });

  it('and the count and override state are stated in words', () => {
    expect(ar.admin.sessions.audienceCount).toContain('{n}');
    expect(ar.admin.sessions.audienceOverridden.length).toBeGreaterThan(5);
  });
});

describe('unsaved work is not lost to a stray click (rule U)', () => {
  it('passes dirty, computed against what it opened with', () => {
    expect(code(DIALOG)).toContain('dirty={dirty}');
    // **The property, restated 2026-08-27** — this pinned the literal
    // `[...chosen].sort().join`, which is a mechanism, and it failed when the
    // comparison moved to the shared `isDirty`. What must hold is that `dirty`
    // is computed **against the values the dialog opened with**, so the two
    // things asserted are that `initial` participates and that the shared
    // comparison is the one used. A form comparing against emptiness instead is
    // the NEW E defect, and it would fail both.
    expect(code(DIALOG)).toMatch(/const dirty = isDirty\([^;]*initial[^;]*\)/s);
  });
});
