import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { AppError, normalize, toEnvelope } from '../lib/errors.js';

/**
 * Request id propagation and the TD-3.8 envelope renderer (TD-14, §16.2).
 */

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

/**
 * TD-14: a `request_id` reaches every error envelope and every log line, so a
 * user-reported failure is traceable end to end. Nginx already generates one
 * and forwards it as `X-Request-Id` (§3.1); we honour that rather than minting
 * a second identity for the same request.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const forwarded = req.header('x-request-id');
  // Nginx supplies its 32-hex `$request_id`; local/direct callers may supply a
  // UUID. Nothing else is accepted. A public client can set this header, so an
  // arbitrary value would be an attacker-controlled field copied into every
  // application/Nginx log and error envelope — including an email or phone.
  const safeForwarded =
    forwarded !== undefined &&
    /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(
      forwarded,
    );
  req.requestId = safeForwarded ? forwarded : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** TD-14 structured JSON logs. No PII: user ids only, never names, phones, or
 *  emails, and never the `X-Active-Child-ID` value. */
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    process.stdout.write(
      `${JSON.stringify({
        time: new Date().toISOString(),
        request_id: req.requestId,
        method: req.method,
        // Log the registered template, never the caller-controlled coordinate.
        // Unknown routes are particularly important: `/name@example.test` is
        // not in TD-3 and must not become personal data in an access log merely
        // because somebody requested it.
        path:
          typeof (req.route as { path?: unknown } | undefined)?.path === 'string'
            ? (req.route as { path: string }).path
            : '<unmatched>',
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 10) / 10,
      })}\n`,
    );
  });
  next();
}

/** Terminal 404 for anything not in the TD-3 registry, in the envelope. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', `no route for ${req.method} ${req.path}`));
}

/**
 * The single place an error becomes a response (§16.2 forbids scattered
 * `res.status(...)`). Anything unrecognized normalizes to `INTERNAL`, so a
 * stack trace, SQL fragment, or internal path can never escape (TD-3.8).
 */
// Express identifies an error handler by its ARITY: drop the 4th parameter and
// this silently stops being one, so every error would fall through unhandled.
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = normalize(error);

  if (appError.code === 'INTERNAL') {
    // Operator-facing only — never the response body.
    process.stderr.write(
      `${JSON.stringify({
        time: new Date().toISOString(),
        request_id: req.requestId,
        level: 'error',
        // Driver/storage errors may include SQL, credentials, object keys or a
        // user-supplied filename. The request id is the diagnostic join; the
        // exception text is deliberately not copied into the operational log.
        message: 'unhandled application error',
      })}\n`,
    );
  }

  res.status(appError.status).json(toEnvelope(appError, req.requestId));
}
