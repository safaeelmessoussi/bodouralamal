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
 * `حلقات المواد` used to open as two empty dropdowns: an administrator had to
 * pick a Level and then a Subject before the page showed anything, so the only
 * way to learn what existed was to guess at it one pair at a time. The property
 * asserted here is the one that regressed easily — that no selector is a
 * precondition for the page's primary data.
 */
describe('the overview shows its data without being filtered first', () => {
  it('loads every accessible Level on mount', () => {
    expect(code(PAGE)).toContain('listLevels(accessToken)');
  });

  it('has no Level or Subject dropdown gating the page', () => {
    // The two controls whose absence IS the feature.
    expect(code(PAGE)).not.toContain('<LevelSelect');
    expect(code(PAGE)).not.toContain('admin.subjectOrg.pickLevel');
    expect(code(PAGE)).not.toContain('admin.subjectOrg.pickSubject');
  });

  it('opens the deep-linked Level instead of requiring a choice', () => {
    // R69.3's `?level=` survives as focus, never as a gate.
    expect(code(PAGE)).toContain('new Set(levelId ? [levelId] : [])');
  });

  it('loads a Level’s contents only when it is opened', () => {
    // A split read per Subject across every Level would be a request storm for
    // data nobody has asked to see.
    expect(code(PAGE)).toContain('if (detail[id] === undefined) void loadLevel(id)');
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
