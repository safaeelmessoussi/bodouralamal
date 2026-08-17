import { describe, expect, it } from 'vitest';

import PAGE from './teaching-structure.tsx?raw';
import CIRCLES from '../../components/scope/subject-circles.tsx?raw';
import AR from '../../i18n/ar.ts?raw';

/** Comments are not code — the idiom the scheduling parity guard established. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **A management page shows the data it manages.**
 *
 * `حلقات المواد` has now been rebuilt on this rule twice. R69 removed **two empty
 * dropdowns** that gated the whole page. The 2026-08-17 pass removed the
 * **accordion** that replaced them — which showed its data but never as a list,
 * so *"what circles exist"* was still a question answered by opening Levels one
 * at a time.
 *
 * ## Why three assertions here were rewritten rather than deleted
 *
 * They pinned the **accordion's implementation**: the absence of a `<LevelSelect`
 * element, the open-set literal `new Set(levelId ? [levelId] : [])`, and the lazy
 * `if (detail[id] === undefined)` load. All three are gone, and the property they
 * were protecting is not.
 *
 * That is the lesson worth keeping: **a guard should assert the property, not the
 * shape of the code that currently has it.** `not.toContain('<LevelSelect')` was
 * the clearest case — the redesign uses that very component as a **filter in the
 * toolbar**, which is the rule's *fulfilment*, and the old assertion called it a
 * violation. What follows asserts the rule directly: the data read is
 * unconditional, and no copy tells the reader to choose before seeing anything.
 */
describe('the overview shows its data without being filtered first', () => {
  it('reads the circles unconditionally, with no required filter', () => {
    // `listCircles(accessToken, page, {…})` — every parameter narrows and none is
    // required, which is what lets the table render on arrival.
    expect(code(PAGE)).toContain('listCircles(accessToken, page');
  });

  it('never makes a selector a precondition for the read', () => {
    // The shape a gate has: the fetch guarded on a chosen id. The redesign's
    // filters flow INTO the read as optional parameters instead.
    expect(code(PAGE)).not.toMatch(/if\s*\(!levelId\)\s*return/);
    expect(code(PAGE)).not.toMatch(/if\s*\(!subjectId\)\s*return/);
  });

  it('has no copy instructing the reader to choose before seeing data', () => {
    // The observable trace a gate always leaves — «اختاري … لعرض …».
    expect(code(PAGE)).not.toContain('admin.subjectOrg.pickLevel');
    expect(code(PAGE)).not.toContain('admin.subjectOrg.pickSubject');
    expect(code(AR)).not.toContain('pickLevel:');
  });

  it('keeps R69.3’s deep links as focus rather than as a gate', () => {
    /**
     * **Restated 2026-08-17: this asserted that the page EMITS the link.**
     *
     * It read `toContain('/admin/teaching-groups?level=')`, which the row action
     * «تفاصيل المستوى» happened to produce. The Owner replaced that action with
     * «المستفيدات», so the string went — and the property never depended on it.
     * R69.3's guarantee is that an **inbound** `?level=` / `?subject=` is
     * honoured, which is about what the page *reads*, not what it links to.
     *
     * Asserted on the consumption now: both parameters arrive as props, the Level
     * they name opens, and its Subject is the scroll target. Arriving with
     * neither still renders the table, which the unconditional-read test above
     * covers.
     */
    expect(code(PAGE)).toContain('levelId,\n  subjectId,');
    expect(code(PAGE)).toContain('levels.find((l) => l.id === levelId)');
    expect(code(PAGE)).toContain('subject-${subject.id}');
    expect(code(PAGE)).toContain('subject.id === subjectId');
  });

  it('loads a Level’s own breakdown only when that Level is opened', () => {
    // Unchanged in substance: a split read per Subject across every Level would
    // be a request storm for data nobody has asked to see. Asserted as the
    // CONDITION now rather than as one line of it.
    expect(code(PAGE)).toContain('void loadLevel(levelId)');
    expect(code(PAGE)).toContain('detail[levelId] === undefined');
  });

  it('offers إضافة حلقة at the top, not only inside a Level', () => {
    // The reason the accordion needed replacing as much as the dropdowns did: the
    // create action existed only inside each Subject block, so a reader who had
    // opened no Level was offered no way to add a circle at all.
    expect(code(PAGE)).toContain('variant="add"');
    expect(code(PAGE)).toContain('admin.subjectOrg.create');
  });
});

/**
 * R69.5 gave each screen one responsibility. Groups are shown here because
 * *"is this Level subdivided"* is context for reading its circles — not because
 * this screen owns them.
 */
describe('Groups are visible here and managed elsewhere', () => {
  it('renders no Group create, edit or delete action', () => {
    for (const forbidden of [
      'createAdministrativeGroup',
      'updateAdministrativeGroup',
      'deleteAdministrativeGroup',
    ]) {
      expect(code(PAGE)).not.toContain(forbidden);
    }
  });

  it('points at the screen that does manage them', () => {
    expect(code(PAGE)).toContain('/admin/groups?level=');
    expect(AR).toContain('تُدار المجموعات في');
  });
});

/**
 * R43.3 — circle STRUCTURE is Super Admin, MEMBERSHIP is Admin and
 * branch-scoped. The controls follow the ACTIVE role (R60); the server enforces
 * both regardless, and this screen renders refusals rather than reimplementing
 * the rules.
 */
describe('authorization is unchanged and follows the active role', () => {
  it('gates circle CRUD on the active Super Admin role', () => {
    expect(code(PAGE)).toContain("activeRoles.includes('super_admin')");
    expect(code(CIRCLES)).toContain('canManageGroups ?');
  });

  it('gates placement on Admin and above, separately from structure', () => {
    expect(code(PAGE)).toContain("r === 'admin' || r === 'super_admin'");
    expect(code(CIRCLES)).toContain('canPlace ?');
  });
});

/**
 * BR-22 is the reason this screen exists: a student enrolled in a Level whose
 * Subject is split, holding no circle for it, has no sessions for that subject
 * at all — and nothing else in the platform says so.
 */
describe('BR-22 survives the redesign', () => {
  it('shows the unassigned list beside the Subject it concerns', () => {
    expect(code(CIRCLES)).toContain('split.unassigned');
    expect(code(CIRCLES)).toContain('admin.subjectOrg.unassignedTitle');
  });

  it('keeps `split: false` as its own state, not an empty list', () => {
    // A Subject with no circles is taught to the entire Level, so the question
    // does not apply — "everyone is placed" would be a different claim.
    expect(code(CIRCLES)).toContain('!split.split ?');
    expect(code(CIRCLES)).toContain('admin.subjectOrg.notSplit');
  });
});
