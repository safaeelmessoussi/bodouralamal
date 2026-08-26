import { describe, expect, it } from 'vitest';

import { ApiError } from './api.js';
import { classifyError, isRetryable, PUBLIC_CODE, referenceFor } from './error-classes.js';

const envelope = (code: string, requestId = 'rid-1') => ({
  code, message_key: 'k', message: '', details: {}, request_id: requestId,
});

describe('which kind of failure this is', () => {
  it('maps each status to the situation a reader is actually in', () => {
    expect(classifyError(new ApiError(401, envelope('AUTH_REQUIRED')))).toBe('unauthenticated');
    expect(classifyError(new ApiError(403, envelope('FORBIDDEN')))).toBe('forbidden');
    expect(classifyError(new ApiError(404, envelope('NOT_FOUND')))).toBe('not_found');
    expect(classifyError(new ApiError(409, envelope('VERSION_CONFLICT')))).toBe('conflict');
    expect(classifyError(new ApiError(429, envelope('RATE_LIMITED')))).toBe('rate_limited');
    expect(classifyError(new ApiError(500, envelope('INTERNAL')))).toBe('server');
    expect(classifyError(new ApiError(503, envelope('SERVICE_UNAVAILABLE')))).toBe('server');
  });

  it('prefers the envelope code where the status cannot distinguish', () => {
    // §20 rule 17 makes "not yours" and "does not exist" both 404 on purpose.
    // «لم يعد متاحًا» serves the reader better than «الصفحة غير موجودة».
    expect(classifyError(new ApiError(404, envelope('CONTENT_UNAVAILABLE')))).toBe('unavailable');
  });

  it('treats a request that never reached a server as offline', () => {
    // `fetch` rejects with TypeError when the request did not go out.
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('offline');
  });

  it('never guesses', () => {
    expect(classifyError(new ApiError(418, envelope('TEAPOT')))).toBe('unknown');
    expect(classifyError('a string')).toBe('unknown');
  });
});

describe('the reference a person can quote', () => {
  it('carries the server request_id through EXACTLY', () => {
    const ref = referenceFor(new ApiError(500, envelope('INTERNAL', '419252cc6545d4362dca949b690afb74')));
    expect(ref).toEqual({ kind: 'server', value: '419252cc6545d4362dca949b690afb74' });
  });

  it('never fabricates a request_id when the request never reached a server', () => {
    // The whole point: a made-up id sends somebody hunting through server logs
    // for a request that was never there.
    const ref = referenceFor(new TypeError('Failed to fetch'));
    expect(ref.kind).toBe('local');
    expect(ref.value).not.toMatch(/^[0-9a-f]{32}$/);
  });

  it('marks a response that carried no envelope as local, not server', () => {
    expect(referenceFor(new ApiError(502, null)).kind).toBe('local');
  });
});

describe('what is offered next', () => {
  it('offers retry only where retrying could plausibly succeed', () => {
    expect(isRetryable('offline')).toBe(true);
    expect(isRetryable('server')).toBe(true);
    // Pressing retry against a rule that will keep refusing is worse than
    // offering nothing.
    expect(isRetryable('forbidden')).toBe(false);
    expect(isRetryable('not_found')).toBe(false);
    expect(isRetryable('unauthenticated')).toBe(false);
  });

  it('gives every class a stable public code', () => {
    const codes = Object.values(PUBLIC_CODE);
    expect(new Set(codes).size).toBe(codes.length);
    expect(PUBLIC_CODE.forbidden).toBe('BA-403');
    expect(PUBLIC_CODE.offline).toBe('BA-NET');
  });
});
