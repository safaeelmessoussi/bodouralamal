import { describe, expect, it } from 'vitest';

// Read as raw text through Vite rather than `node:fs`: the production build
// typechecks this file too, and pulling Node's types in for one test would put
// them on the whole application's type surface.
import SCHEDULING from './scheduling.tsx?raw';
import FORM from '../../components/scheduling/scheduling-form.tsx?raw';
import SECTIONS from '../../components/scheduling/class-section.tsx?raw';

/**
 * **الجدولة is one screen built from shared parts** (SRS Revision 56).
 *
 * ## What this guard became, and why
 *
 * It used to compare two pages against each other. R56 retired the second one,
 * so comparison is no longer the property — **composition** is: one screen, one
 * form shell, sections injected per type, and no custom UI anywhere in it.
 *
 * The lesson carried forward from the version before this one is that
 * **presence is not absence**. Asserting the shared components are *used* is
 * satisfied by a page that uses them and keeps hand-rolled UI beside them —
 * which one did, for a whole revision. So both directions are asserted.
 */
/**
 * **Comments are not code, and this guard is about code.**
 *
 * The first run of the two assertions below failed on this file's own prose —
 * a docstring explaining why a `type === 'class'` ladder would be wrong was
 * read as one. Stripping comments is what makes the assertion mean what it says
 * rather than merely pass.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FILES: [string, string][] = [
  ['scheduling.tsx', SCHEDULING],
  ['scheduling-form.tsx', FORM],
  ['class-section.tsx', SECTIONS],
];

describe('the screen is composed from the shared admin components', () => {
  it.each([
    ['AdminLayout', 'the page frame'],
    ['DataTable', 'the table, its states and its toolbar'],
    ['FormDialog', 'the form frame, its spacing and its two buttons'],
    ['ConfirmDialog', 'destructive confirmation'],
    ['ScopeSelectors', 'the dependent curriculum selectors (R55)'],
    ['CalendarGrid', 'the occurrence view — the same grid the public calendar renders'],
  ])('uses %s — %s', (component) => {
    expect(SCHEDULING.includes(component), `scheduling.tsx does not use ${component}`).toBe(true);
  });

  it('renders the recurrence control through the one shared editor', () => {
    // The form shell renders it; the page must not reach for it separately, or
    // there would be two places deciding what a recurrence form looks like.
    expect(FORM.includes('RecurrenceEditor')).toBe(true);
    expect(SCHEDULING.includes('<RecurrenceEditor')).toBe(false);
  });
});

describe('no custom UI survives anywhere in the screen', () => {
  it('hand-rolls no dialog, list, select or actions row', () => {
    for (const [name, source] of FILES) {
      expect(/<Dialog[\s>]/.test(source), `${name} builds a bare Dialog`).toBe(false);
      expect(/<ul>/.test(source), `${name} renders an unstyled list`).toBe(false);
      expect(/<select[\s>]/.test(source), `${name} hand-rolls a select`).toBe(false);
      expect(source.includes('form__actions'), `${name} builds its own actions row`).toBe(false);
      expect(source.includes('className="form"'), `${name} builds its own form wrapper`).toBe(
        false,
      );
    }
  });

  it('renders no bare status paragraph and no raw identifier in a cell', () => {
    expect(/<p role="status">/.test(SCHEDULING)).toBe(false);
    // Ids are what a client links by; names are what it shows.
    expect(/cell: \(r\) =>\s*\n?\s*r\.\w+_id\b/.test(SCHEDULING)).toBe(false);
  });
});

describe('the form shell stays generic', () => {
  it('branches on no specific type — sections are composed in', () => {
    // The property that makes Exams a new section rather than a new `if`. A
    // `type === 'class'` ladder here is how a "generic" form quietly becomes
    // three forms sharing a wrapper.
    expect(
      /type === '(class|activity|exam)'/.test(code(FORM)),
      'scheduling-form.tsx branches on a type',
    ).toBe(false);
    expect(FORM.includes('children'), 'the shell accepts no injected section').toBe(true);
  });

  it('reimplements no recurrence or date/time logic', () => {
    // It renders the shared controls and knows nothing about what
    // `biweekly_alternating` means — the property that makes the editor a
    // single source of truth rather than merely a shared component.
    expect(code(FORM).includes('biweekly')).toBe(false);
    expect(FORM.includes('SchedulingTimes')).toBe(true);
  });
});
