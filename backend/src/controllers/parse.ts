import type { Request } from 'express';

import { AppError } from '../lib/errors.js';
import { uuid } from '../validators/common.js';

/**
 * The validation boundary every controller shares (§16.2).
 *
 * A Zod failure is a **client** error and must reach the caller as the TD-3.8
 * envelope with `VALIDATION_FAILED` — never as an unhandled throw the error
 * middleware reports as a 500. `issues` travels in `details` so a form can point
 * at the offending field.
 *
 * Extracted from `branch.controller.ts` when the Revision 43 endpoints needed
 * the same helper. Eleven other controllers still hand-roll the equivalent
 * `safeParse`-then-throw inline; consolidating those is recorded debt, not a
 * silent rewrite folded into an unrelated change.
 */
export function parse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    throw new AppError('VALIDATION_FAILED', 'schema validation failed', {
      issues: (result.error as { issues?: unknown })?.issues ?? [],
    });
  }
  return result.data;
}

/** A UUID path parameter, validated. A malformed id is a `400`, not a `404`. */
export function idParam(req: Request, key: string): string {
  return parse<string>(uuid, req.params[key]);
}
