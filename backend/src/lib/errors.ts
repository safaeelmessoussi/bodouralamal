/**
 * Canonical application error catalog and envelope (SRS TD-3.8).
 *
 * The `code` values below are the **complete** catalog and are "extensible only
 * by SRS revision" — do not add one here without one. Errors are thrown as typed
 * domain errors and mapped centrally to the envelope; §16.2 forbids ad-hoc
 * `res.status(...)` scattering, and §20 rule 16 forbids returning anything
 * outside this shape.
 */

export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, messageKey: 'errors.validation_failed' },
  AUTH_REQUIRED: { status: 401, messageKey: 'errors.auth_required' },
  FORBIDDEN: { status: 403, messageKey: 'errors.forbidden' },
  NOT_FOUND: { status: 404, messageKey: 'errors.not_found' },
  STATE_CONFLICT: { status: 409, messageKey: 'errors.state_conflict' },
  VERSION_CONFLICT: { status: 409, messageKey: 'errors.version_conflict' },
  DUPLICATE: { status: 409, messageKey: 'errors.duplicate' },
  WEIGHT_SUM_EXCEEDED: { status: 409, messageKey: 'errors.grading.weight_sum' },
  TEMPLATE_NOT_ACTIVE: { status: 409, messageKey: 'errors.grading.template_not_active' },
  /** RETIRED by Revision 43 (BR-23: room capacity informs and never refuses).
   *  Retained only while the pre-R43 `roster.service.ts` still raises it during
   *  the expand phase; the contract migration removes both together. Nothing
   *  new may raise it. */
  CAPACITY_FULL: { status: 409, messageKey: 'errors.capacity_full' },
  /** Revision 43, §4.4 — a room, teacher or assistant is already committed for
   *  an overlapping session. Detected against MATERIALIZED sessions, so the
   *  answer is exact rather than an approximate rule comparison. */
  SCHEDULE_CONFLICT: { status: 409, messageKey: 'errors.schedule_conflict' },
  CONSENT_GATE_LOCKED: { status: 403, messageKey: 'errors.consent_gate_locked' },
  CONSENT_REQUIRED: { status: 400, messageKey: 'errors.consent_required' },
  FAMILY_LINK_PENDING: { status: 409, messageKey: 'errors.family_link_pending' },
  SINGLE_SUBMISSION_FINAL: { status: 409, messageKey: 'errors.single_submission_final' },
  UPLOAD_INCOMPLETE: { status: 409, messageKey: 'errors.upload_incomplete' },
  PAYLOAD_TOO_LARGE: { status: 413, messageKey: 'errors.payload_too_large' },
  RATE_LIMITED: { status: 429, messageKey: 'errors.rate_limited' },
  OAUTH_EXCHANGE_FAILED: { status: 502, messageKey: 'errors.oauth_exchange_failed' },
  SERVICE_UNAVAILABLE: { status: 503, messageKey: 'errors.service_unavailable' },
  INTERNAL: { status: 500, messageKey: 'errors.internal' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** The single TD-3.8 response shape. Every non-2xx response uses it. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message_key: string;
    message: string;
    details: Record<string, unknown>;
    request_id: string;
  };
}

export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly code: ErrorCode,
    /**
     * Operator-facing context. NEVER rendered to the client: TD-3.8 forbids
     * leaking stack traces, SQL, or internal paths, so the client sees only the
     * code, the i18n key, and the localized fallback.
     */
    message?: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message ?? code);
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }
}

/**
 * Arabic fallback messages (§6: AR primary; TD-3.8: user-facing messages resolve
 * through `message_key`, and this string is only the fallback for a client that
 * has not loaded a catalog).
 */
const FALLBACK_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'البيانات المُدخلة غير صحيحة.',
  AUTH_REQUIRED: 'يجب تسجيل الدخول للمتابعة.',
  FORBIDDEN: 'ليست لديك صلاحية للقيام بهذا الإجراء.',
  NOT_FOUND: 'العنصر المطلوب غير موجود.',
  STATE_CONFLICT: 'تم تعديل هذا العنصر أو تغييرت حالته. يرجى تحديث الصفحة.',
  VERSION_CONFLICT: 'تم تعديل هذا السجل من طرف مستخدم آخر. يرجى تحديث الصفحة وإعادة المحاولة.',
  DUPLICATE: 'هذا العنصر موجود مسبقاً.',
  WEIGHT_SUM_EXCEEDED: 'مجموع الأوزان يتجاوز الحد المسموح.',
  TEMPLATE_NOT_ACTIVE: 'هذه العملية تتطلب نموذجاً مُفعّلاً.',
  CAPACITY_FULL: 'المجموعة مكتملة العدد.',
  SCHEDULE_CONFLICT: 'القاعة أو أحد المؤطرين مرتبط بحصة أخرى في نفس الوقت.',
  CONSENT_GATE_LOCKED: 'لا يمكن نشر هذا المحتوى: الموافقة على النشر غير متوفرة.',
  CONSENT_REQUIRED: 'يجب الموافقة على الشروط للمتابعة.',
  FAMILY_LINK_PENDING: 'طلب الربط قيد المراجعة.',
  SINGLE_SUBMISSION_FINAL: 'لا يمكن تعديل هذا الامتحان بعد الإرسال.',
  UPLOAD_INCOMPLETE: 'لم يكتمل رفع الملف.',
  PAYLOAD_TOO_LARGE: 'حجم الملف أكبر من الحد المسموح به.',
  RATE_LIMITED: 'عدد كبير من المحاولات. يرجى المحاولة بعد قليل.',
  OAUTH_EXCHANGE_FAILED: 'تعذّر الاتصال بخدمة تسجيل الدخول. يرجى المحاولة مرة أخرى.',
  SERVICE_UNAVAILABLE: 'الخدمة غير متاحة مؤقتاً. يرجى المحاولة بعد قليل.',
  INTERNAL: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
};

export function toEnvelope(error: AppError, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message_key: ERROR_CODES[error.code].messageKey,
      message: FALLBACK_MESSAGES[error.code],
      details: error.details,
      request_id: requestId,
    },
  };
}

/**
 * Maps an unknown thrown value onto the catalog. Anything unrecognized becomes
 * `INTERNAL` — never the original message, so a driver error or a stack trace
 * cannot escape through the envelope (TD-3.8, §20 rule 16).
 *
 * Concurrency outcomes are translated rather than surfaced as 500s (TD-15.3):
 * a unique-constraint race is `DUPLICATE`, not "Internal Server Error".
 */
/**
 * Extracts the column names of a violated unique constraint from a Prisma error.
 *
 * Prisma 7 with a driver adapter reports them at
 * `meta.driverAdapterError.cause.constraint.fields`, **not** the `meta.target`
 * that older versions used. Reading only `meta.target` silently matches nothing,
 * which is how a §4.1b onboarding-token replay came back as `DUPLICATE` instead
 * of `STATE_CONFLICT` — so both shapes are handled here, in one place, rather
 * than re-derived per call site.
 */
export function uniqueViolationFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return [];

  const adapterFields = (
    meta as { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
  ).driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields)) return adapterFields.map(String);

  const target = (meta as { target?: unknown }).target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

export function normalize(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2002') return new AppError('DUPLICATE');
  // Prisma: record not found for an update/delete.
  if (code === 'P2025') return new AppError('NOT_FOUND');

  return new AppError('INTERNAL');
}
