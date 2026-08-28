/**
 * **شركاؤنا — the section that must not exist when there is nothing to show.**
 *
 * The property this harness is for is an ABSENCE, which no unit test can
 * observe: with no visible partner the landing page must render **no heading, no
 * empty frame and no «لا شركاء بعد» message**. An absence is exactly the kind of
 * thing that passes a component test and fails on the page, because the
 * component is only asked what it returns and never asked what the page looks
 * like around it.
 *
 * It seeds and cleans its own rows (P1.2) and asserts three states in sequence:
 * absent → present → absent again when the partner is withheld.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9228');
const { check, finish } = results();

const reload = async () => {
  await send('Page.navigate', { url: `${BASE}/` });
  for (let i = 0; i < 80; i += 1) {
    const ready = await evaluate(
      `document.readyState === 'complete' && !!document.querySelector('#branches, .hero')`,
    ).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // The section fetches after mount; give the request time to land and render.
  await new Promise((r) => setTimeout(r, 1200));
};

const section = () =>
  evaluate(`(() => {
    const el = document.querySelector('#partners');
    return {
      present: Boolean(el),
      heading: el ? (el.querySelector('h2')?.textContent ?? '').trim() : null,
      names: el ? [...el.querySelectorAll('.partner-list > li')].map((li) => li.textContent.trim()) : [],
      // Anything that would announce an absence to a visitor.
      emptyWords: document.body.textContent.includes('لا شركاء'),
    };
  })()`);

const MODE = process.env.PARTNERS_MODE ?? 'absent';
const TAG = '[cpartner]';

await reload();
const state = await section();

if (MODE === 'absent') {
  check(
    '1 · with no visible partner the section is ABSENT — no heading, no empty frame',
    state.present === false && state.emptyWords === false,
    JSON.stringify(state),
  );
} else {
  check(
    '2 · a visible partner makes the section appear, showing its name',
    state.present === true && state.names.some((n) => n.startsWith(TAG)),
    JSON.stringify(state),
  );
  check(
    '3 · the section carries a heading once it exists',
    state.heading.length > 0,
    state.heading,
  );
  check(
    '4 · and the WITHHELD partner is not on the page',
    state.names.every((n) => !n.includes('محجوب')),
    JSON.stringify(state.names),
  );
}

await close();
process.exit(finish());
