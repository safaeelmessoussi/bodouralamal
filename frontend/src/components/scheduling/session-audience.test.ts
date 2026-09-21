import { describe, expect, it } from 'vitest';

import DIALOG from './session-audience-dialog.tsx?raw';
import PAGE from '../../pages/admin/schedule-sessions.tsx?raw';
import { ar } from '../../i18n/ar.js';

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **R92, generalised — the audience override's interface half** (Owner-
 * reported, 2026-09-17: level, category, group and circle, in addition to
 * the branches R92 already had).
 *
 * The properties guarded are the ones that would fail silently: an ambiguous
 * override rule, a venue that looks editable, an action offered where the server
 * would refuse it, and copy that lets an administrator believe she moved the
 * class.
 */
describe('replacement per dimension, not addition — and the control says which', () => {
  it('seeds each of the five controls with its own INHERITED value', () => {
    // This is what makes *replacement* the only rule anybody has to hold: to
    // combine, you add the second value to what is already chosen. An empty
    // start would make the same submission mean "instead of", and nobody
    // could tell the two apart from the screen.
    expect(code(DIALOG)).toContain('branchIds: r.audience.branches.map((b) => b.id)');
    expect(code(DIALOG)).toContain('categoryIds: r.audience.categories.map((c) => c.id)');
    expect(code(DIALOG)).toContain('levelIds: r.audience.levels.map((l) => l.id)');
    expect(code(DIALOG)).toContain(
      'administrativeGroupIds: r.audience.administrative_groups.map((g) => g.id)',
    );
    expect(code(DIALOG)).toContain('teachingGroupIds: r.audience.teaching_groups.map((c) => c.id)');
    // …and BOTH what is chosen and what it is compared against start there.
    expect(code(DIALOG)).toContain('setChosen(seeded);');
    expect(code(DIALOG)).toContain('setInitial(seeded);');
  });

  it('submits all five as one call, never five requests', () => {
    // The five lists are ONE value (`SessionAudienceChoice`), handed over whole.
    expect(code(DIALOG)).toContain(
      'await setSessionAudienceOverrides(sessionId, version, audience.chosen, token);',
    );
    expect(code(DIALOG).match(/setSessionAudienceOverrides\(/g)?.length).toBe(1);
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

  it('reads groups and circles UNSCOPED, never through the ordinary Level+branch-chained list', () => {
    // Combining across a Level or a branch boundary is exactly the case that
    // chained list cannot answer — the same reasoning the multi_dimension
    // class picker's own unscoped reads already established (Revision 157).
    expect(code(DIALOG)).toContain('fetchAllPages((page) => listAdministrativeGroups(token, page, {}, null, 100))');
    expect(code(DIALOG)).toContain('fetchAllPages((page) => listCircles(token, page, {}, null, 100))');
  });

  it('walks every page rather than trusting the first (codex review, 2026-09-20)', () => {
    // An institute with more than 100 groups or circles had entries the
    // picker could never offer, silently — a truncated dialog, not a
    // pinned first page. `fetchAllPages`'s own behaviour is proven directly
    // in `session-audience-dialog.fetch-all-pages.test.ts`; this only pins
    // that both reads actually go through it.
    expect(code(DIALOG)).toContain('export async function fetchAllPages');
    // A failed load is SAID, in both places that show these fields.
    expect(code(DIALOG)).toContain('.catch(() => setLoadFailed(true))');
    expect(code(DIALOG)).toContain("audience.loadFailed ? t('admin.sessions.audienceLoadFailed')");
  });
});

describe('the venue is a different fact, and is not editable here', () => {
  it('renders it as text, never as a control', () => {
    expect(code(DIALOG)).toContain('roster.venue.branch_name');
    // A branch SELECT for the venue would say this screen moves the class.
    expect(code(DIALOG)).not.toContain('label={t(\'admin.sessions.audienceVenue\')}');
  });

  it('names it separately from the audience in the copy', () => {
    expect(ar.admin.sessions.audienceHint).toContain('مكانها المعتاد');
  });
});

describe('the action is offered for every teaching mode now (§14.4 — never offer a refusal)', () => {
  it('the whole-Level-only gate is gone — the write no longer refuses any mode', () => {
    // R92's own branch-only override refused every mode but `entire_level`;
    // the generalised write resolves through `multi_dimension`'s own
    // composition regardless of the schedule's real mode, so the action is
    // never offered where the server would refuse it (§14.4 still holds —
    // there is simply nothing left for it to refuse on mode grounds).
    expect(code(PAGE)).not.toContain("klass?.teachingMode === 'entire_level'");
    expect(code(PAGE)).toContain('available: () => !isTeacherPortal');
  });

  it('and it lives on the OCCURRENCE screen, not the recurring form', () => {
    expect(code(PAGE)).toContain('<SessionAudienceDialog');
  });
});

describe('SRS Revision 166 §2 — «تعديل الحصة» offers the SAME audience and staff editors, in its one save', () => {
  it('renders the shared fields and the shared staff picker for «هذه الحصة فقط», managers only', () => {
    expect(code(PAGE)).toContain("{scope === 'this_session' && token ? (");
    expect(code(PAGE)).toContain('<SessionAudienceFields audience={audience} branches={branches} />');
    expect(code(PAGE)).toContain('<StaffPicker');
  });

  it('sends the audience and the staff ONLY when she changed them — an inherited audience re-sent is an override nobody made', () => {
    expect(code(PAGE)).toContain("...(scope === 'this_session' && token !== null && audience.dirty");
    expect(code(PAGE)).toContain("...(scope === 'this_session' && token !== null && staffDirty");
  });

  it('asks the server for nothing while another scope is chosen', () => {
    expect(code(PAGE)).toContain("active: token !== null && scope === 'this_session',");
    expect(code(DIALOG)).toContain('if (!active) return;');
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
  it('passes dirty, computed against what it opened with, across all five controls', () => {
    expect(code(DIALOG)).toContain('dirty={audience.dirty}');
    // **The property, restated 2026-08-27, extended 2026-09-17** — what must
    // hold is that `dirty` is computed against the values the dialog opened
    // with, for EVERY dimension, using the shared `isDirty` comparison. A
    // form comparing against emptiness instead is the NEW E defect.
    // One comparison over EVERY key of the choice, so a sixth dimension cannot
    // be added to the value and forgotten here.
    expect(code(DIALOG)).toContain(
      'const dirty = (Object.keys(EMPTY_CHOICE) as (keyof SessionAudienceChoice)[]).some((key) =>',
    );
    expect(code(DIALOG)).toContain('isDirty([...chosen[key]].sort(), [...initial[key]].sort())');
  });
});
