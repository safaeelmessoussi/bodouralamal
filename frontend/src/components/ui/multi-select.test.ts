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

describe('the control keeps the selection bounded and, collapsed, out of the way (R137 item 8)', () => {
  it('collapses to a single trigger — the SAME field__control shape SelectField and SearchableSelect use — until opened', () => {
    expect(code(CONTROL)).toContain('field__control dropdown-trigger');
    expect(code(CONTROL)).toContain('aria-haspopup="listbox"');
    expect(code(CONTROL)).toContain('aria-expanded={open}');
  });

  it("the closed trigger reads as a plain-language summary («٣ محددة»), not the roster itself", () => {
    expect(code(CONTROL)).toContain("t('common.selectedCount')");
    expect(code(CONTROL)).not.toMatch(/multi-select__chosen/);
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

  it('offers each option as a real, shared checkbox field — a toggle a screen reader announces as one, not a glyph in a button', () => {
    expect(code(CONTROL)).toContain('<ChoiceField');
    expect(code(CONTROL)).toContain('checked={selected.includes(o.value)}');
  });

  it('Escape and an outside click close the panel — the same disclosure NotificationBell already established, reused rather than reinvented', () => {
    expect(code(CONTROL)).toContain('useDisclosure');
  });
});
