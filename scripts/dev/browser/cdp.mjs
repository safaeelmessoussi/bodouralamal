/**
 * **A minimal Chrome DevTools Protocol client**, shared by the browser scripts.
 *
 * ## One rule these scripts keep breaking, so it is written here
 *
 * **NEVER put a backtick in a comment.** Page code is passed to
 * `Runtime.evaluate` as a template literal, and a backtick anywhere inside it —
 * including inside a `//` comment — terminates the literal and yields
 * *"SyntaxError: missing ) after argument list"* from Node, pointing at the
 * template's opening line rather than at the comment. It cost four debugging
 * rounds across four harnesses before being written down.
 *
 * Extracted when the second one was written: `measure-page-header.mjs` and
 * `verify-reorder.mjs` had each grown their own copy of the same twenty lines,
 * and a third would have made three. There is no dependency here — Node's
 * built-in `WebSocket` is the whole client — which is the point: §3.1a forbids
 * adding a browser-automation dependency casually, and this is what makes real
 * browser verification possible without one.
 */
export async function connect(port = '9222') {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target in Chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  /** Resolves with the command's `result`, not the envelope around it — every
   *  caller wants the payload, and returning the envelope made `getCookies`
   *  read `undefined.find` on its first use. */
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id;
      pending.set(n, (msg) => res(msg.result ?? {}));
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  /** Evaluates in the page, awaiting a promise result and surfacing throws. */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate threw');
    }
    return r.result?.value;
  };

  return { send, evaluate, close: () => ws.close() };
}

/** A tiny assertion recorder, so a run reports every check rather than the first failure. */
export function results() {
  const all = [];
  return {
    check(name, ok, detail = '') {
      all.push({ name, ok: Boolean(ok) });
      process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
    },
    finish() {
      const failed = all.filter((r) => !r.ok);
      process.stdout.write(`\n${all.length - failed.length}/${all.length} checks passed\n`);
      return failed.length === 0 ? 0 : 1;
    },
  };
}
