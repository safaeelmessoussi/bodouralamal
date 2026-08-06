import { describe, expect, it } from 'vitest';

// Read as raw text through Vite rather than `node:fs`: the production build
// typechecks this file too, and pulling Node's types in for one test would put
// them on the whole application's type surface.
import EVENTS from './calendar.tsx?raw';
import SESSIONS from './schedules.tsx?raw';

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

  it('neither renders a bare Dialog — every dialog is a shared kind', () => {
    // **The gap the first version of this file missed.** It asserted the shared
    // components were PRESENT, which a page can satisfy while still carrying
    // custom UI alongside them: the sessions page used `FormDialog` and kept a
    // hand-built `<Dialog>` for its materialization report, with a raw `<ul>`
    // and untranslated codes inside. Presence is not absence.
    for (const [name, source] of PAGES) {
      expect(/<Dialog[\s>]/.test(source), `${name} still builds a bare Dialog`).toBe(false);
    }
  });

  it('neither renders a bare list where a dialog shows a set', () => {
    for (const [name, source] of PAGES) {
      // A raw `<ul>` inherits no styling and, worse, renders empty when the set
      // is empty — which for conflicts is the reassuring answer, not a blank.
      expect(/<ul>/.test(source), `${name} renders an unstyled list`).toBe(false);
    }
  });

  it('neither prints a raw identifier where a name belongs', () => {
    for (const [name, source] of PAGES) {
      // `r.room_id` in a cell rendered a UUID in the timetable. Ids are what a
      // client links by; **names are what it shows** — the same rule the library
      // DTO states, and the reason the schedule DTO now resolves its labels.
      expect(
        /cell: \(r\) =>\s*\n?\s*r\.\w+_id\b/.test(source),
        `${name} renders a raw id in a table cell`,
      ).toBe(false);
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
