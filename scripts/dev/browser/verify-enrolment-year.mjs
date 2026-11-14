/**
 * **R271 — «تسجيل مستفيد(ة)»: «مدة التسجيل»**, through the real screens.
 *
 * As a Super Admin, on «التسجيلات»: the scenario's beneficiary → «إدارة
 * التسجيلات» → «تسجيل في مستوى آخر». The form opens on «السنة الدراسية
 * كاملة» with the current year chosen; «فصل دراسي واحد» swaps in the semester
 * list; saving the year enrols her, and her row then says «(السنة كاملة)».
 * `SHOTS=<dir>` writes screenshots at 1366 and 390 px.
 */
import { writeFileSync } from 'node:fs';

import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const PORT = process.env.PORT ?? '9256';
const SHOTS = process.env.SHOTS ?? '';
const { check, finish } = results();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await connect(PORT);
const size = (width) =>
  page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: width < 600 ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
const waitFor = async (predicate, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    if (await page.evaluate(`(() => Boolean(${predicate}))()`).catch(() => false)) return true;
    await wait(400);
  }
  return false;
};
const shot = async (name) => {
  if (!SHOTS) return;
  for (const width of [1366, 390]) {
    await size(width);
    await wait(700);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/${name}-${width}.png`, Buffer.from(data, 'base64'));
  }
  await size(1366);
};
const clickText = (scope, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`;
const fieldValue = (label) => `(() => {
  const field = [...document.querySelectorAll('dialog[open] .field')].find((f) => f.querySelector('label')?.textContent.trim().startsWith(${JSON.stringify(label)}));
  return field?.querySelector('select')?.value ?? null;
})()`;

await size(1366);
await page.send('Network.clearBrowserCookies');
await page.send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.ADMIN_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await page.send('Page.navigate', { url: `${BASE}/admin/enrollments` });
await waitFor(`document.querySelector('.admin-table tbody tr')`, 80);
await page.evaluate(`(() => {
  const input = document.querySelector('input[type="search"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '[r98-join] مستفيدة أ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await wait(800);
check('the scenario beneficiary is listed',
  await waitFor(`[...document.querySelectorAll('.admin-table tbody tr')].some((tr) => tr.innerText.includes('مستفيدة أ'))`, 20));
await page.evaluate(`(() => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) => tr.innerText.includes('مستفيدة أ'));
  [...row.querySelectorAll('.row-action')].find((b) => b.textContent.trim() === 'إدارة التسجيلات').click();
})()`);
await waitFor(`document.querySelector('dialog[open]')`, 20);
check('«تسجيل في مستوى آخر» opens the form',
  (await page.evaluate(clickText('dialog[open] button', 'مستوى آخر'))) &&
    (await waitFor(`[...document.querySelectorAll('dialog[open] legend')].some((l) => l.textContent.trim() === 'مدة التسجيل')`, 20)));
check('it opens on «السنة الدراسية كاملة»',
  await page.evaluate(`(() => {
    const radio = [...document.querySelectorAll('dialog[open] input[name="enrolment-term"]')];
    return radio.length === 2 && radio[0].checked && !radio[1].checked;
  })()`));
check('with a year chosen (the current one)', await waitFor(`${fieldValue('السنة الدراسية')}`, 20), String(await page.evaluate(fieldValue('السنة الدراسية'))));
await shot('r271-year');
await page.evaluate(`(() => document.querySelectorAll('dialog[open] input[name="enrolment-term"]')[1].click())()`);
check('«فصل دراسي واحد» swaps in the semester list',
  await waitFor(`${fieldValue('الفصل الدراسي')} !== null && ${fieldValue('السنة الدراسية')} === null`, 10));
await shot('r271-semester');
await page.evaluate(`(() => document.querySelectorAll('dialog[open] input[name="enrolment-term"]')[0].click())()`);
await wait(300);
// The scenario Level (her only offered one), then حفظ.
await page.evaluate(`(() => {
  const field = [...document.querySelectorAll('dialog[open] .field')].find((f) => f.querySelector('label')?.textContent.includes('المستو'));
  const select = field?.querySelector('select');
  const option = [...(select?.options ?? [])].find((o) => o.value !== '' && o.textContent.includes('r98-join'));
  if (!option) return;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await wait(500);
const before = await page.evaluate(`document.querySelectorAll('dialog[open]').length`);
await page.evaluate(clickText('dialog[open] button', 'حفظ'));
check('saving the year enrols her (no refusal, the form closes)',
  await waitFor(`document.querySelectorAll('dialog[open]').length < ${before}`, 30),
  await page.evaluate(`[...document.querySelectorAll('dialog[open] .feedback, dialog[open] [role="status"]')].map((n) => n.textContent.trim()).join(' | ')`));
check('her row says «(السنة كاملة)»',
  await waitFor(`[...document.querySelectorAll('.admin-table tbody tr')].some((tr) => tr.innerText.includes('مستفيدة أ') && tr.innerText.includes('(السنة كاملة)'))`, 30));
await shot('r271-row');

process.exit(finish());
