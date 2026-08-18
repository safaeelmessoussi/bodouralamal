import { describe, expect, it } from "vitest";

import {
  issueOnboardingToken,
  ONBOARDING_TTL_SECONDS,
  verifyOnboardingToken,
} from "./onboarding-token.js";

const KEY = "onboarding-key-not-a-real-secret";
const JWT_KEY = "a-different-key-standing-in-for-JWT_SIGNING_KEY";
const IDENTITY = {
  email: "Person@Example.COM",
  providerSubjectId: "google-sub-1",
};

describe("onboarding token (§4.1b, TD-12)", () => {
  it("carries the verified identity and a unique jti, with a 10-minute TTL", () => {
    const { claims } = issueOnboardingToken(IDENTITY, KEY);
    expect(claims.provider_subject_id).toBe("google-sub-1");
    expect(claims.exp - claims.iat).toBe(ONBOARDING_TTL_SECONDS);
    expect(ONBOARDING_TTL_SECONDS).toBe(600);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lowercases the email on issue, not only on lookup (TD-12)", () => {
    const { claims } = issueOnboardingToken(IDENTITY, KEY);
    expect(claims.email).toBe("person@example.com");
  });

  it("mints a distinct jti every time, so two tokens can never collide", () => {
    const a = issueOnboardingToken(IDENTITY, KEY).claims.jti;
    const b = issueOnboardingToken(IDENTITY, KEY).claims.jti;
    expect(a).not.toBe(b);
  });

  it("round-trips through verification", () => {
    const { token } = issueOnboardingToken(IDENTITY, KEY);
    const result = verifyOnboardingToken(token, KEY);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.claims.email).toBe("person@example.com");
  });

  it("rejects a token signed with the JWT key — the two keys are not interchangeable", () => {
    // TD-13 keeps ONBOARDING_TOKEN_KEY distinct from JWT_SIGNING_KEY precisely
    // so an access token can never be presented as an onboarding token.
    const { token } = issueOnboardingToken(IDENTITY, JWT_KEY);
    expect(verifyOnboardingToken(token, KEY).valid).toBe(false);
  });

  it("rejects a substituted email — the client cannot bind a different identity", () => {
    // §20 rule 9: the token payload is the sole source of the registered email.
    const { token } = issueOnboardingToken(IDENTITY, KEY);
    const [payload, signature] = token.split(".") as [string, string];
    const forged = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      email: string;
    };
    forged.email = "attacker@example.com";
    const tampered = Buffer.from(JSON.stringify(forged)).toString("base64url");

    const result = verifyOnboardingToken(`${tampered}.${signature}`, KEY);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("bad_signature");
  });

  it("expires after its TTL", () => {
    const stale = new Date(Date.now() - (ONBOARDING_TTL_SECONDS + 30) * 1000);
    const { token } = issueOnboardingToken(IDENTITY, KEY, stale);
    const result = verifyOnboardingToken(token, KEY);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("expired");
  });

  it("rejects malformed input rather than throwing", () => {
    for (const bad of ["", "x", "a.b.c", "."]) {
      expect(() => verifyOnboardingToken(bad, KEY)).not.toThrow();
      expect(verifyOnboardingToken(bad, KEY).valid).toBe(false);
    }
  });
});
