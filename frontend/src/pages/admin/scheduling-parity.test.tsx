import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * **الأنشطة and الحصص are one feature family, and this keeps them one.**
 *
 * ## Why a source-level test rather than a rendering one
 *
 * The two pages drifted three times, and never in a way either page looked
 * wrong for on its own. What was wrong was always *the difference*: one passed
 * its lede to the layout and the other rendered a paragraph; one emphasised its
 * save button and the other did not; one wrapped its fields in `.form` and the
 * other left them to their own margins.
 *
 * A rendering test cannot see that — it would assert each page against itself.
 * The property that matters is **that both reach for the same components**, so
 * that is what is asserted: the shared primitives appear in both files, and the
 * hand-rolled equivalents appear in neither.
 *
 * This is deliberately a *structural* guard, like the Trash-snapshot one. A
 * per-difference test would have to be remembered for each new divergence,
 * which is the discipline that already failed here.
 */
const EVENTS = readFileSync(new URL('./calendar.tsx', import.meta.url), 'utf8');
const SESSIONS = readFileSync(new URL('./schedules.tsx', import.meta.url), 'utf8');

const PAGES: [string, string][] = [
  ['الأنشطة (calendar.tsx)', EVENTS],
  ['الحصص (schedules.tsx)', SESSIONS],
];

/** The page's own lede key, as opposed to a dialog's — a dialog lede is a
 *  legitimate paragraph and must not be caught by the assertion below. */
const PAGE_LEDE: Record<string, string> = {
  'الأنشطة (calendar.tsx)': 'admin.calendar.lede',
  'الحصص (schedules.tsx)': 'admin.schedules.lede',
};

describe('both scheduling pages are built from the same components', () => {
  it.each([
    ['AdminLayout', 'the page frame'],
    ['DataTable', 'the table, its states and its toolbar'],
    ['FormDialog', 'the form frame, its spacing and its two buttons'],
    ['ConfirmDialog', 'destructive confirmation'],
    ['RecurrenceEditor', 'the recurrence rule (§4.4)'],
    ['SchedulingTimes', 'the wall-clock fields (TD-11)'],
  ])('both use %s — %s', (component) => {
    for (const [name, source] of PAGES) {
      expect(source.includes(component), `${name} does not use ${component}`).toBe(true);
    }
  });

  it('neither page hand-rolls a form dialog', () => {
    for (const [name, source] of PAGES) {
      // `form__actions` written out by hand is how the two save buttons ended
      // up with different variants: one emphasised, one not.
      expect(source.includes('form__actions'), `${name} builds its own actions row`).toBe(false);
      // A form whose fields are not inside `.form` inherits no spacing, which is
      // exactly what made the sessions form look unrelated to the events form.
      expect(source.includes('className="form"'), `${name} builds its own form wrapper`).toBe(
        false,
      );
    }
  });

  it('neither page renders a bare status paragraph', () => {
    for (const [name, source] of PAGES) {
      // The shared notice carries the spacing and colour; a bare
      // `<p role="status">` carries neither, and one page had exactly that.
      expect(
        /<p role="status">/.test(source),
        `${name} renders an unstyled notice`,
      ).toBe(false);
    }
  });

  it('both put the page lede in the layout, not in the body', () => {
    for (const [name, source] of PAGES) {
      expect(source.includes('lede={t('), `${name} does not pass its lede to the layout`).toBe(
        true,
      );
      expect(
        source.includes(`<p className="lede">{t('${PAGE_LEDE[name]!}')`),
        `${name} renders its PAGE lede as a body paragraph`,
      ).toBe(false);
    }
  });

  it('both emphasise their primary action in the layout action slot', () => {
    for (const [name, source] of PAGES) {
      expect(
        /actions=\{[\s\S]{0,200}variant="primary"/.test(source),
        `${name} does not put an emphasised create action in the layout slot`,
      ).toBe(true);
    }
  });

  it('both offer a filter row, because both list something worth narrowing', () => {
    for (const [name, source] of PAGES) {
      expect(source.includes('toolbar='), `${name} has no filter row`).toBe(true);
    }
  });

  it('neither builds a raw select — the shared field components own that', () => {
    for (const [name, source] of PAGES) {
      // A raw `<select>` carries no label association, no hint slot and no error
      // slot, and it is where the dependent-selector rules have nowhere to live.
      expect(/<select[\s>]/.test(source), `${name} hand-rolls a select`).toBe(false);
    }
  });
});
