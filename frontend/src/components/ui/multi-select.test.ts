import { describe, expect, it } from 'vitest';

import CONTROL from './multi-select.tsx?raw';
import PICKER from '../scheduling/staff-picker.tsx?raw';

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **The assistants control stopped growing with the roster.**
 *
 * It rendered every person as a checkbox, which reads fine for a handful and
 * turns the form into a page of checkboxes for a real roster. The properties
 * pinned here are the ones that would quietly regress.
 */
describe('the assistants are a multi-select', () => {
  it('the picker renders the atomic control, not a checkbox list', () => {
    expect(code(PICKER)).toContain('<MultiSelectField');
    expect(code(PICKER)).not.toContain('type="checkbox"');
    expect(code(PICKER)).not.toContain('field__choices');
  });

  it('still excludes the lead from the assistants', () => {
    // One person holds one position on one thing, and the server refuses the
    // pair — so offering somebody as both would be offering a refusal.
    expect(code(PICKER)).toContain('.filter((x) => x.id !== leadId)');
  });

  it('is shared, so all three callers change together', () => {
    // R71 extracted `StaffPicker` for the exam, the class and the event; the
    // multi-select lands in all three by being wired here rather than per page.
    expect(code(PICKER)).toContain('assistantIds');
    expect(code(PICKER)).toContain('onAssistants');
  });
});

describe('the control keeps the selection visible and the list bounded', () => {
  it('separates chosen from choosable', () => {
    expect(code(CONTROL)).toContain('multi-select__chosen');
    expect(code(CONTROL)).toContain('multi-select__options');
  });

  it('searches only above a threshold, so a short list is not cluttered', () => {
    expect(code(CONTROL)).toContain('searchThreshold');
    expect(code(CONTROL)).toContain('options.length >= searchThreshold');
  });

  it('filters presentationally and fetches nothing', () => {
    // Search narrows options the caller handed over; the caller stays
    // responsible for offering only what it may (the shared-selector rule).
    expect(code(CONTROL)).not.toContain('api(');
    expect(code(CONTROL)).not.toContain('await ');
  });

  it('removes through a real button, not a glyph in a span', () => {
    expect(code(CONTROL)).toContain('aria-label={`${t(\'common.remove\')}');
  });
});
