import { describe, expect, it } from 'vitest';

import GUARD from './use-unsaved-guard.tsx?raw';

/**
 * **A closed form holds no unsaved work** (2026-08-28).
 *
 * تعديل المجموعة asked *«هناك تغييرات لم تُحفظ بعد»* on a form nobody had
 * touched, and nothing in the caller was wrong. The close button ran with
 * `dirty` **false** and called `onCancel`; the parent cleared the row being
 * edited; and for the single render before the form's reset effect ran, the
 * still-loaded field values compared against a now-empty pristine and read as
 * dirty — whereupon `Dialog`'s native `close` event re-entered `requestClose`
 * inside exactly that window.
 *
 * This is a source assertion because the behaviour needs a real dialog element
 * and a real `close` event, which this project proves in a browser
 * (`verify-unsaved-guard.sh`) rather than with a DOM library it does not carry.
 * What it pins is the part a reader could quietly undo: that **both** exits
 * consult the open-gated value, not the raw prop.
 */
describe('the unsaved guard is gated on the form being open', () => {
  it('derives one open-gated value and uses it for both exits', () => {
    const code = GUARD.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).toContain('const unsaved = open && dirty');
    // The question, and the backdrop/Escape decision, must read the same value.
    expect(code).toContain('if (unsaved && !busy) setConfirming(true)');
    expect(code).toContain('dismissible: !unsaved');
    // The raw prop must not be consulted directly again — that is the defect.
    expect(code).not.toMatch(/if \(dirty && !busy\)/);
    expect(code).not.toContain('dismissible: !dirty');
  });
});
