/**
 * **The registration consent notice, measured in a real browser.**
 *
 * Two things a unit test cannot see, and both were real defects:
 *
 * 1. **The legend gap.** `.register-form__group` is `display: grid`, and a
 *    `<legend>` is NOT a grid item — the fieldset lays it out by its own
 *    algorithm, so `gap` never applied between it and the first field. The
 *    heading read as one run-on word with the line under it. CSS says
 *    `margin-block-end` is present; only a browser says the boxes are apart.
 *    This is the rule CLAUDE.md states: a layout property is measured, never
 *    asserted from a stylesheet.
 * 2. **The disclosure actually hides.** `[hidden]` relies on the UA's
 *    `display: none`, which any author `display` outranks (rule AG). Reading
 *    the computed style is what tells a working hide from a coincidence.
 *
 * The form is reached with an onboarding token, exactly as §4.1b's Google
 * callback delivers one — `/register` with no token renders no form at all, so
 * a token is the only way to see the notice. `issue-dev-onboarding.sh` calls
 * the same production issuer under the same guards.
 *
 * **Nothing is submitted.** This run reads and toggles; it creates no
 * applicant and needs no cleanup.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TOKEN = process.env.ONBOARDING_TOKEN;
if (!TOKEN) throw new Error('ONBOARDING_TOKEN is required');
const page = await connect(process.env.PORT ?? '9222');
const { check, finish } = results();

await page.send('Page.navigate', { url: `${BASE}/register#onboarding_token=${TOKEN}` });
await new Promise((r) => setTimeout(r, 2500));

const probe = async () =>
  page.evaluate(`(() => {
    const box = document.querySelector('.consent-notice input[type="checkbox"]');
    const region = document.getElementById('consent-text-full');
    const button = document.querySelector('.consent-notice__disclosure button');
    const hint = document.getElementById('consent-text-hint');
    const legend = [...document.querySelectorAll('legend')]
      .find((l) => l.textContent.trim() === 'الموافقات');
    const notice = document.querySelector('.consent-notice');
    let gap = null;
    if (legend && notice) {
      gap = Math.round(notice.getBoundingClientRect().top - legend.getBoundingClientRect().bottom);
    }
    const style = region ? getComputedStyle(region) : null;
    return {
      hasBox: Boolean(box),
      checked: box ? box.checked : null,
      describedBy: box ? box.getAttribute('aria-describedby') : null,
      hintText: hint ? hint.textContent.trim() : null,
      buttonLabel: button ? button.textContent.trim() : null,
      buttonTag: button ? button.tagName : null,
      buttonType: button ? button.getAttribute('type') : null,
      ariaExpanded: button ? button.getAttribute('aria-expanded') : null,
      ariaControls: button ? button.getAttribute('aria-controls') : null,
      regionHidden: region ? region.hasAttribute('hidden') : null,
      regionDisplay: style ? style.display : null,
      regionWhiteSpace: style ? style.whiteSpace : null,
      regionVisibleHeight: region ? region.getBoundingClientRect().height : null,
      regionText: region ? region.textContent.trim() : null,
      direction: style ? style.direction : null,
      legendGap: gap,
      lawButton: [...document.querySelectorAll('button')]
        .some((b) => b.textContent.includes('القانون 09-08')),
    };
  })()`);

const closed = await probe();

/* ── The wording the server actually holds, for an exact comparison ─────── */
const served = await page.evaluate(
  `fetch('/api/v1/registration/consent-text').then((r) => r.json())`,
);

check('the notice renders on the registration form', closed.hasBox === true);
check('the consent starts unticked', closed.checked === false);
check(
  'the checkbox is described by the help line',
  closed.describedBy === 'consent-text-hint' && (closed.hintText ?? '').includes('قبل إرسال الطلب'),
  JSON.stringify({ describedBy: closed.describedBy, hint: closed.hintText }),
);

/* ── 1. Collapsed by default ────────────────────────────────────────────── */

check(
  'the wording is COLLAPSED on arrival',
  closed.regionHidden === true &&
    closed.regionDisplay === 'none' &&
    closed.regionVisibleHeight === 0,
  JSON.stringify({
    hidden: closed.regionHidden,
    display: closed.regionDisplay,
    height: closed.regionVisibleHeight,
  }),
);
check(
  'no author display rule defeats [hidden] (rule AG)',
  closed.regionDisplay === 'none',
  `display=${closed.regionDisplay}`,
);
check(
  'the disclosure is a real button announcing its state',
  closed.buttonTag === 'BUTTON' &&
    closed.buttonType === 'button' &&
    closed.ariaExpanded === 'false' &&
    closed.ariaControls === 'consent-text-full',
  JSON.stringify({
    tag: closed.buttonTag,
    type: closed.buttonType,
    expanded: closed.ariaExpanded,
    controls: closed.ariaControls,
  }),
);
check('the closed label offers to read the wording', closed.buttonLabel === 'قراءة نص الموافقة كاملاً', closed.buttonLabel);

/* ── 2. The legend no longer collides with the notice ───────────────────── */

check(
  'الموافقات is spaced from the consent below it',
  typeof closed.legendGap === 'number' && closed.legendGap >= 8,
  `gap=${closed.legendGap}px`,
);

/* ── 3. Opening reveals the EXACT served wording ────────────────────────── */

await page.evaluate(`document.querySelector('.consent-notice__disclosure button').click()`);
await new Promise((r) => setTimeout(r, 200));
const opened = await probe();

check(
  'opening reveals the wording',
  opened.regionHidden === false && opened.regionDisplay !== 'none' && opened.regionVisibleHeight > 0,
  JSON.stringify({ hidden: opened.regionHidden, display: opened.regionDisplay }),
);
check(
  'the revealed wording is EXACTLY what the server serves — not summarised, truncated or rewritten',
  opened.regionText === served.body_arabic,
  // The wording is thousands of characters; reporting both in full drowns the
  // run. Length and endpoints localise any difference without printing it.
  JSON.stringify({
    shownLength: (opened.regionText ?? '').length,
    servedLength: (served.body_arabic ?? '').length,
    shownHead: (opened.regionText ?? '').slice(0, 40),
    shownTail: (opened.regionText ?? '').slice(-40),
  }),
);
check('paragraph breaks in the wording survive', opened.regionWhiteSpace === 'pre-line', opened.regionWhiteSpace);
check('the wording renders right-to-left', opened.direction === 'rtl', opened.direction);
check('the open label offers to hide it', opened.buttonLabel === 'إخفاء نص الموافقة', opened.buttonLabel);
check('aria-expanded follows the state', opened.ariaExpanded === 'true', opened.ariaExpanded);

/* ── 4. Disclosure never touches consent state ──────────────────────────── */

check('opening did not tick the consent', opened.checked === false);

await page.evaluate(`document.querySelector('.consent-notice input[type="checkbox"]').click()`);
await page.evaluate(`document.querySelector('.consent-notice__disclosure button').click()`);
await new Promise((r) => setTimeout(r, 200));
const recollapsed = await probe();

check(
  'closing hides it again',
  recollapsed.regionHidden === true && recollapsed.regionDisplay === 'none',
  JSON.stringify({ hidden: recollapsed.regionHidden, display: recollapsed.regionDisplay }),
);
check('closing did not untick the consent', recollapsed.checked === true);
check('the Law 09-08 explanation is still reachable and separate', recollapsed.lawButton === true);

/* ── 5. Mobile ──────────────────────────────────────────────────────────── */

await page.send('Emulation.setDeviceMetricsOverride', {
  width: 360,
  height: 720,
  deviceScaleFactor: 2,
  mobile: true,
});
await new Promise((r) => setTimeout(r, 300));
const narrow = await page.evaluate(`(() => {
  const region = document.getElementById('consent-text-full');
  return {
    overflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    withinViewport: region.getBoundingClientRect().width <= document.documentElement.clientWidth,
  };
})()`);
check(
  'at 360px the page does not scroll sideways and the wording fits',
  narrow.overflowsX === false && narrow.withinViewport === true,
  JSON.stringify(narrow),
);

page.close();
finish('Consent disclosure');
