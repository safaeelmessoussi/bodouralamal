/**
 * **Answering «ماذا تريدين؟» the way a person does** (SRS Revision 170 §2).
 *
 * The registration form's four roles live in ONE closed control — the
 * platform's `MultiSelectField` — with «أسجّل نفسي كمستفيدة» chosen for her.
 * So a harness OPENS it, sets each choice to what its journey wants (unticking
 * the default where the journey is not a مستفيدة's), and closes it again. A
 * choice is addressed by what it IS (`data-option-value`), never by its wording,
 * which is the association's to change.
 *
 * Shared, like `date-picker.mjs`, so the next harness that needs a role has no
 * reason to guess the markup — five of them once did, against a checkbox list
 * that no longer exists.
 */
const OPEN = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = document.querySelector('[data-role-choices]');
  if (!root) return 'no role chooser on the page';
  const trigger = root.querySelector('button.dropdown-trigger');
  if (!trigger) return 'the role chooser is not a closed control';
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.scrollIntoView({ block: 'center' });
    trigger.click();
    await wait(200);
  }
  const boxes = () => [...root.querySelectorAll('[data-option-value]')];
  if (boxes().length === 0) return 'the role chooser did not open';
`;
const CLOSE = `
  if (trigger.getAttribute('aria-expanded') === 'true') {
    trigger.click();
    await wait(150);
  }
`;

/** `[[value, checked], …]` in the options' own order — opening and re-closing. */
export const roleStates = (evaluate) =>
  evaluate(`(async () => {
    ${OPEN}
    const states = boxes().map((li) => [li.getAttribute('data-option-value'), li.querySelector('input').checked]);
    ${CLOSE}
    return JSON.stringify(states);
  })()`);

/** What the CLOSED control reads — the names of what is chosen. */
export const roleSummary = (evaluate) =>
  evaluate(`(() => {
    const trigger = document.querySelector('[data-role-choices] button.dropdown-trigger');
    return trigger ? { expanded: trigger.getAttribute('aria-expanded'), text: (trigger.textContent ?? '').trim() } : null;
  })()`);

/**
 * Leaves EXACTLY `wanted` ticked. Answers `'ok'`, or what went wrong.
 */
export const setRoles = (evaluate, wanted) =>
  evaluate(`(async () => {
    ${OPEN}
    const wanted = ${JSON.stringify(wanted)};
    for (const value of wanted) {
      if (!boxes().some((li) => li.getAttribute('data-option-value') === value)) return 'not offered: ' + value;
    }
    for (const li of boxes()) {
      const value = li.getAttribute('data-option-value');
      const box = root.querySelector('[data-option-value="' + value + '"] input');
      if (box.checked !== wanted.includes(value)) {
        box.click();
        await wait(120);
      }
    }
    const now = boxes().filter((li) => li.querySelector('input').checked).map((li) => li.getAttribute('data-option-value'));
    ${CLOSE}
    return now.length === wanted.length && wanted.every((value) => now.includes(value))
      ? 'ok'
      : 'left ticked: ' + now.join(',');
  })()`);
