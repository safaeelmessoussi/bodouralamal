import { describe, expect, it } from "vitest";

import { AppError, ERROR_CODES, normalize, toEnvelope } from "./errors.js";

const REQ = "req-1234";

describe("TD-3.8 error envelope", () => {
  it("produces exactly the five envelope fields", () => {
    const envelope = toEnvelope(new AppError("NOT_FOUND"), REQ);
    expect(Object.keys(envelope)).toEqual(["error"]);
    expect(Object.keys(envelope.error).sort()).toEqual(
      ["code", "details", "message", "message_key", "request_id"].sort(),
    );
    expect(envelope.error.request_id).toBe(REQ);
  });

  it("maps every catalog code to the HTTP status TD-3.8 specifies", () => {
    // Spot-check the whole table against the SRS rather than trusting the object.
    const expected: Record<string, number> = {
      VALIDATION_FAILED: 400,
      AUTH_REQUIRED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      STATE_CONFLICT: 409,
      VERSION_CONFLICT: 409,
      DUPLICATE: 409,
      WEIGHT_SUM_EXCEEDED: 409,
      TEMPLATE_NOT_ACTIVE: 409,
      SCHEDULE_CONFLICT: 409,
      CONSENT_GATE_LOCKED: 403,
      CONSENT_REQUIRED: 400,
      FAMILY_LINK_PENDING: 409,
      SINGLE_SUBMISSION_FINAL: 409,
      UPLOAD_INCOMPLETE: 409,
      PAYLOAD_TOO_LARGE: 413,
      RATE_LIMITED: 429,
      OAUTH_EXCHANGE_FAILED: 502,
      SERVICE_UNAVAILABLE: 503,
      INTERNAL: 500,
    };
    for (const [code, status] of Object.entries(expected)) {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES].status, code).toBe(
        status,
      );
    }
    // The catalog is closed — a stray addition should be a deliberate revision.
    expect(Object.keys(ERROR_CODES).sort()).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it("every code carries an i18n key and an Arabic fallback", () => {
    for (const code of Object.keys(
      ERROR_CODES,
    ) as (keyof typeof ERROR_CODES)[]) {
      const envelope = toEnvelope(new AppError(code), REQ);
      expect(envelope.error.message_key.startsWith("errors."), code).toBe(true);
      // AR primary (§6): the fallback must be non-empty and contain Arabic.
      expect(envelope.error.message.length, code).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(envelope.error.message), code).toBe(true);
    }
  });

  it("never leaks an internal message, stack trace, or SQL to the client", () => {
    const leaky = new AppError(
      "INTERNAL",
      'relation "user" does not exist at /app/dist/src/repo.js:42',
    );
    const envelope = toEnvelope(leaky, REQ);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("relation");
    expect(serialized).not.toContain("/app/dist");
    expect(serialized).not.toContain("does not exist");
  });

  it("normalizes an unknown throw to INTERNAL without preserving its message", () => {
    const normalized = normalize(new Error("ECONNREFUSED 10.0.0.5:5432"));
    expect(normalized.code).toBe("INTERNAL");
    expect(JSON.stringify(toEnvelope(normalized, REQ))).not.toContain(
      "10.0.0.5",
    );
  });

  it("translates concurrency races into coded outcomes, never 500s (TD-15.3)", () => {
    expect(normalize({ code: "P2002" }).code).toBe("DUPLICATE");
    expect(normalize({ code: "P2002" }).status).toBe(409);
    expect(normalize({ code: "P2025" }).code).toBe("NOT_FOUND");
  });

  it("passes an AppError through unchanged", () => {
    const original = new AppError("SCHEDULE_CONFLICT", "room busy", {
      max: 12,
    });
    const normalized = normalize(original);
    expect(normalized).toBe(original);
    expect(toEnvelope(normalized, REQ).error.details).toEqual({ max: 12 });
  });
});
