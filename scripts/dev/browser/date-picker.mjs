/**
 * **Choosing a date the way a person does** — by DRIVING the platform's one
 * Arabic calendar (trigger → year → month → day), never by writing a value into
 * an input that is not there.
 *
 * `35f27dc` replaced every native `type="date"` with this control, and the
 * registration harness went on "typing" a date into a field that no longer had
 * an input — failing on every run since, unnoticed because nobody ran it. Shared,
 * so the next harness that needs a date has no reason to guess the markup.
 *
 * `index` is the Nth calendar trigger on the page (0-based, document order);
 * `month` is 1–12 — the page's own month list is read by POSITION, never by its
 * Arabic name, which is a string the association may reword.
 */
export const pickDate = (evaluate, index, { year, month, day }) =>
  evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const trigger = [...document.querySelectorAll('.date-picker__trigger')][${index}];
    if (!trigger) return 'no calendar at index ${index}';
    trigger.scrollIntoView({ block: 'center' });
    trigger.click();
    await wait(250);
    const title = () => document.querySelector('.date-picker__panel .date-picker__head-title');
    if (!title()) return 'the calendar did not open';
    title().click();            // day view  → month view
    await wait(250);
    title()?.click();           // month view → year view
    await wait(250);

    const target = String(${year});
    const years = () => [...document.querySelectorAll('.date-picker__years button')];
    for (let tries = 0; tries < 40 && !years().some((b) => b.textContent.trim() === target); tries += 1) {
      const shown = years().map((b) => Number(b.textContent.trim())).filter(Number.isFinite);
      // The pagers by POSITION in the head (previous first, next last).
      const pagers = [...document.querySelectorAll('.date-picker__panel .date-picker__head button')];
      const pager = shown.length > 0 && Math.min(...shown) > ${year} ? pagers[0] : pagers[pagers.length - 1];
      if (!pager) return 'the year view has no pager';
      pager.click();
      await wait(120);
    }
    const yearButton = years().find((b) => b.textContent.trim() === target);
    if (!yearButton) return 'year ' + target + ' was not reached';
    yearButton.click();
    await wait(250);

    const monthButton = [...document.querySelectorAll('.date-picker__months button')][${month} - 1];
    if (!monthButton) return 'month ${month} is not offered';
    if (monthButton.disabled) return 'month ${month} is disabled';
    monthButton.click();
    await wait(250);

    const dayButton = [...document.querySelectorAll('.date-picker__grid button')]
      .find((b) => !b.disabled && b.textContent.trim() === String(${day}));
    if (!dayButton) return 'day ${day} is not offered';
    dayButton.click();
    await wait(250);
    return document.querySelector('.date-picker__panel') ? 'the calendar stayed open' : 'ok';
  })()`);
