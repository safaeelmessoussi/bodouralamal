import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ErrorPanel } from './error-panel.js';
import { ApiError } from '../../lib/api.js';

/**
 * **What a person is actually shown**, rendered rather than asserted about.
 *
 * The panel's content is deterministic given a failure, so it is settled here;
 * `verify-error-experience.sh` covers what only a browser can — that real
 * failures reach it, and that the expected `/auth/refresh` 401 never does.
 */
const envelope = (code: string, requestId: string) => ({
  code, message_key: 'k', message: '', details: {}, request_id: requestId,
});
const render = (error: unknown, variant: 'page' | 'region' | 'inline' = 'page') =>
  renderToStaticMarkup(<ErrorPanel error={error} variant={variant} onRetry={() => undefined} />);

const CASES: [string, unknown, string, string][] = [
  ['401', new ApiError(401, envelope('AUTH_REQUIRED', 'rid-401')), 'انتهت الجلسة', 'BA-401'],
  ['403', new ApiError(403, envelope('FORBIDDEN', 'rid-403')), 'ليست لديك صلاحية', 'BA-403'],
  ['404', new ApiError(404, envelope('NOT_FOUND', 'rid-404')), 'الصفحة غير موجودة', 'BA-404'],
  ['409', new ApiError(409, envelope('VERSION_CONFLICT', 'rid-409')), 'تغيّرت البيانات', 'BA-409'],
  ['429', new ApiError(429, envelope('RATE_LIMITED', 'rid-429')), 'محاولات كثيرة', 'BA-429'],
  ['unavailable', new ApiError(404, envelope('CONTENT_UNAVAILABLE', 'rid-410')), 'المحتوى غير متاح', 'BA-410'],
  ['5xx', new ApiError(500, envelope('INTERNAL', '419252cc6545d4362dca949b690afb74')), 'خطأ في الخادم', 'BA-500'],
  ['offline', new TypeError('Failed to fetch'), 'تعذّر الاتصال', 'BA-NET'],
];

describe('every failure class gets a branded Arabic state', () => {
  it.each(CASES)('%s renders its own words and its stable code', (_label, error, arabic, code) => {
    const html = render(error);
    expect(html).toContain(arabic);
    expect(html).toContain(code);
  });

  it.each(CASES)('%s leaks no technical detail', (_label, error) => {
    const html = render(error);
    // The server never sends these (TD-3.8) and the panel never invents them.
    expect(html).not.toMatch(/stack|SQL|prisma|node_modules|\/app\/|Error:/i);
  });
});

describe('the reference a person quotes', () => {
  it('carries the server request_id through byte for byte', () => {
    const html = render(new ApiError(500, envelope('INTERNAL', '419252cc6545d4362dca949b690afb74')));
    expect(html).toContain('419252cc6545d4362dca949b690afb74');
    expect(html).toContain('معرّف الطلب');
  });

  it('labels a locally generated reference as such, and explains why', () => {
    const html = render(new TypeError('Failed to fetch'));
    expect(html).toContain('مرجع البلاغ');
    expect(html).not.toContain('معرّف الطلب');
    expect(html).toContain('لم يصل الطلب إلى الخادم');
    // Never SHAPED like a request id either — the two must not be confusable
    // in a support conversation.
    expect(html).not.toMatch(/[0-9a-f]{32}/);
  });

  it('does not claim the network failed when the caller simply had no error', () => {
    // A load failure that DID reach the server must not be captioned "the
    // request never reached the server".
    const html = render(undefined);
    expect(html).not.toContain('لم يصل الطلب إلى الخادم');
  });
});

describe('what is offered next', () => {
  it('401 offers signing in, not retrying a dead session', () => {
    const html = render(new ApiError(401, envelope('AUTH_REQUIRED', 'r')));
    expect(html).toContain('تسجيل الدخول');
    expect(html).not.toContain('إعادة المحاولة');
  });

  it('403 offers a way out rather than a button that will keep refusing', () => {
    const html = render(new ApiError(403, envelope('FORBIDDEN', 'r')));
    expect(html).not.toContain('إعادة المحاولة');
    expect(html).toContain('الصفحة الرئيسية');
  });

  it('5xx and offline offer retry, because retrying can work', () => {
    expect(render(new ApiError(500, envelope('INTERNAL', 'r')))).toContain('إعادة المحاولة');
    expect(render(new TypeError('x'))).toContain('إعادة المحاولة');
  });
});

describe('layout and announcement are separate questions', () => {
  it('a failure that REPLACES content is announced assertively', () => {
    expect(render(new ApiError(500, envelope('INTERNAL', 'r')), 'page')).toContain('role="alert"');
    expect(render(new ApiError(500, envelope('INTERNAL', 'r')), 'region')).toContain('role="alert"');
  });

  it('a failure beside the controls is polite — it must not interrupt typing', () => {
    const html = render(new ApiError(409, envelope('VERSION_CONFLICT', 'r')), 'inline');
    expect(html).toContain('role="status"');
    // And an inline failure does not offer to navigate away from a half-filled form.
    expect(html).not.toContain('الصفحة الرئيسية');
  });
});
