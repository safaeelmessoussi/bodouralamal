import type { Request, Response } from 'express';

import type { AppConfig } from '../lib/config.js';

/**
 * `GET /site-config` — **what the public chrome may offer** (R175 §2).
 *
 * One boolean today: whether the shared «تسجيل الدخول» control renders. The
 * temporary Production tier publishes a public calendar and library while
 * registration is not yet announced, so the control is not offered there —
 * while `/login`, `/register` and the OAuth flow itself stay untouched, and
 * the Owner signs in through `/api/v1/auth/google`.
 *
 * **Public, anonymous, and about the DEPLOYMENT rather than about a person**:
 * it carries no personal data, sets no cookie and reads no session, which is
 * what lets the temporary tier promise a reader that nothing about them is
 * stored. `no-store` so flipping the flag takes effect on the next load
 * rather than after a cache expires.
 */
export function read(config: AppConfig) {
  return (_req: Request, res: Response): void => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: { sign_in_offered: config.SIGN_IN_OFFERED !== 'false' } });
  };
}
