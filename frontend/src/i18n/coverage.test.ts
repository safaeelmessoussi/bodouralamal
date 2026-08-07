import { describe, expect, it } from 'vitest';

import { t } from './index.js';
import { SCHEDULING_TYPES } from '../adapters/scheduling.js';
import { WEEKDAYS } from '../components/scheduling/recurrence-editor.js';

/**
 * **Every key resolves, because an unresolved one renders as English.**
 *
 * `t()` returns the **key path** when a lookup fails. That is a reasonable
 * fallback for a developer and a terrible one for a reader: a missing entry does
 * not blow up, it quietly prints `admin.approvals.colRequested` into an
 * Arabic-only interface (§6). One such key shipped, on a column header and a
 * filter label, and nothing failed.
 *
 * The static keys are swept by walking the sources; **this file covers the ones
 * a sweep cannot see** — the interpolated `t(\`prefix.${value}\`)` calls, where
 * the value comes from an enum. Those are the dangerous ones, because the set
 * that must be translated is defined somewhere else and grows without anyone
 * revisiting the catalog.
 */
function resolves(key: string): boolean {
  // The contract of `t()`: it returns the path itself when the key is missing.
  return t(key) !== key;
}

describe('interpolated keys resolve for every value their enum can take', () => {
  it('scheduling item types', () => {
    for (const type of SCHEDULING_TYPES) {
      expect(resolves(`scheduling.type.${type}`), `scheduling.type.${type}`).toBe(true);
    }
  });

  it('recurrence patterns — all eight a person can pick', () => {
    for (const pattern of [
      'once',
      'daily',
      'weekly',
      'weekly_days',
      'biweekly',
      'biweekly_days',
      'monthly',
      'yearly',
    ]) {
      expect(resolves(`scheduling.pattern.${pattern}`), `scheduling.pattern.${pattern}`).toBe(true);
    }
  });

  it('weekdays — the set the editor renders and the table reads back', () => {
    for (const day of WEEKDAYS) {
      expect(resolves(`scheduling.weekday.${day}`), `scheduling.weekday.${day}`).toBe(true);
    }
  });

  it('teaching modes (§4.4c)', () => {
    for (const mode of ['administrative_group', 'entire_level', 'teaching_group']) {
      expect(resolves(`admin.schedules.mode_${mode}`), `admin.schedules.mode_${mode}`).toBe(true);
    }
  });

  it('visibility tiers (§4.9)', () => {
    for (const tier of ['Public', 'Private', 'Hidden']) {
      expect(resolves(`calendar.visibility${tier}`), `calendar.visibility${tier}`).toBe(true);
    }
  });

  it('validation messages — the reason a save was refused', () => {
    // These replaced a disabled button that explained nothing; an unresolved one
    // would put a key path where the explanation should be.
    for (const reason of [
      'startDate',
      'branch',
      'level',
      'target',
      'subject',
      'year',
      'times',
      'weekdays',
      'title',
    ]) {
      expect(resolves(`scheduling.invalid.${reason}`), `scheduling.invalid.${reason}`).toBe(true);
    }
  });

  it('the scheduling screen’s own vocabulary', () => {
    for (const key of [
      'scheduling.lede',
      'scheduling.create',
      'scheduling.editTitle',
      'scheduling.itemType',
      'scheduling.allTypes',
      'scheduling.untitled',
      'scheduling.truncated',
      'scheduling.view.list',
      'scheduling.view.calendar',
      'scheduling.deleteTitle',
      'scheduling.deleteBody',
      'scheduling.allDay',
      'scheduling.typeSoon',
      'scheduling.typeFixed',
    ]) {
      expect(resolves(key), key).toBe(true);
    }
  });
});

describe('the fallback itself', () => {
  it('returns the path for a key that genuinely does not exist', () => {
    // Mutation-proof for the assertions above: if `t()` ever started returning
    // something else for a miss, every test here would pass vacuously.
    expect(t('scheduling.this.key.does.not.exist')).toBe('scheduling.this.key.does.not.exist');
  });
});
