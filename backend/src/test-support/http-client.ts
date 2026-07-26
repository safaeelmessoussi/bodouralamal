/**
 * HTTP helper for the integration suites that exercise routes through Nginx.
 *
 * Nginx enforces a coarse per-IP edge limit of 120r/m with burst 20 on
 * `/api/v1/` (§3.1, TD-13, Revision 14). A growing HTTP suite fires far faster
 * than that from a single address, so the suite trips a **production protection
 * that is working correctly** — not a defect.
 *
 * The fix belongs in the client, not the server. Relaxing the limit for tests
 * would mean testing against a configuration production never runs, which is the
 * anti-pattern §19.0 calls out when it forbids environment-conditional
 * downgrades. So this waits and retries on `429`, exactly as a well-behaved
 * client does — and any test that wants to *assert* a 429 opts out.
 */

export interface HttpResponse<B = Record<string, unknown>> {
  status: number;
  body: B;
}

export interface CallOptions {
  token?: string | undefined;
  body?: unknown;
  /** Set for tests that assert rate limiting itself, so the 429 is returned. */
  noRetryOn429?: boolean;
}

const MAX_ATTEMPTS = 6;
const BACKOFF_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function httpCall<B = Record<string, unknown>>(
  base: string,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<HttpResponse<B>> {
  const { token, body, noRetryOn429 } = options;

  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual',
    });

    if (res.status === 429 && !noRetryOn429 && attempt < MAX_ATTEMPTS) {
      // Drain the body so the connection is reusable, then wait out the window.
      await res.text();
      await sleep(BACKOFF_MS * attempt);
      continue;
    }

    const text = await res.text();
    let parsed = {} as B;
    try {
      parsed = text ? (JSON.parse(text) as B) : ({} as B);
    } catch {
      parsed = {} as B;
    }
    return { status: res.status, body: parsed };
  }
}
