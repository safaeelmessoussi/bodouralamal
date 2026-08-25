import {
  createHash,
  createHmac,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

import { OAuth2Client } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";

import {
  buildAuthorizationUrl,
  codeChallengeFor,
  createFlowState,
  exchangeCode,
  openFlowState,
  sealFlowState,
  verifyGoogleIdToken,
} from "./oauth.js";

/**
 * Google OAuth `state` + PKCE — §18 *"Google OAuth with state+PKCE"*, §4.1b,
 * TD-12 (Revision 16 F5: the flow state is a short-lived signed cookie).
 *
 * These are the primitives that stand between the login flow and CSRF or code
 * interception, and every one of them fails **silently** when broken: a flow
 * state that opens despite a tampered payload, or a challenge that is not
 * derived from the verifier, produces a login that still works. Nothing in the
 * happy path would notice.
 */
const KEY = "test-jwt-signing-key-at-least-32-chars-long";
const GOOGLE_CLIENT_ID = "client-123";
const TEST_KEY_ID = "google-test-key";
const { privateKey: googlePrivateKey, publicKey: googlePublicKey } =
  generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: foreignPrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function googleClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    iat: now - 10,
    exp: now + 3600,
    sub: "google-sub-1",
    email: "Safae.EL@Example.COM",
    email_verified: true,
    ...overrides,
  };
}

function signedIdToken(
  claims: Record<string, unknown> = googleClaims(),
  options: {
    alg?: string;
    kid?: string;
    signingKey?: KeyObject;
  } = {},
): string {
  const header = Buffer.from(
    JSON.stringify({
      alg: options.alg ?? "RS256",
      kid: options.kid ?? TEST_KEY_ID,
      typ: "JWT",
    }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signed = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signed)
    .end()
    .sign(options.signingKey ?? googlePrivateKey)
    .toString("base64url");
  return `${signed}.${signature}`;
}

function localGoogleClient(): OAuth2Client {
  const client = new OAuth2Client();
  const localCertificates = {
    certs: {
      [TEST_KEY_ID]: googlePublicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
    format: "PEM",
  } as unknown as Awaited<
    ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>
  >;
  vi.spyOn(client, "getFederatedSignonCertsAsync").mockResolvedValue(
    localCertificates,
  );
  return client;
}

/** A `fetch` stand-in; `exchangeCode` takes one so no network is involved. */
const respondWith = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("flow state — the CSRF and PKCE material", () => {
  it("mints a distinct state and verifier on every flow", () => {
    const a = createFlowState();
    const b = createFlowState();

    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    // A reused value across two concurrent logins would let one flow's callback
    // satisfy the other's check.
    expect(a.state).not.toBe(a.codeVerifier);
  });

  it("uses enough entropy to be unguessable, and url-safe encoding", () => {
    const { state, codeVerifier } = createFlowState();

    // 32 random bytes → 43 base64url characters.
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("derives the PKCE challenge as S256 of the verifier", () => {
    const { codeVerifier } = createFlowState();
    const expected = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    expect(codeChallengeFor(codeVerifier)).toBe(expected);
    // Deterministic, or the callback could never match it.
    expect(codeChallengeFor(codeVerifier)).toBe(codeChallengeFor(codeVerifier));
    // And genuinely derived: a different verifier must not collide.
    expect(codeChallengeFor(codeVerifier)).not.toBe(
      codeChallengeFor(createFlowState().codeVerifier),
    );
    // The challenge must not BE the verifier — sending the secret would defeat
    // the whole exchange.
    expect(codeChallengeFor(codeVerifier)).not.toBe(codeVerifier);
  });
});

describe("sealing the flow state (Revision 16 F5)", () => {
  it("round-trips exactly", () => {
    const flow = createFlowState();
    expect(openFlowState(sealFlowState(flow, KEY), KEY)).toEqual(flow);
  });

  it("rejects a tampered PAYLOAD", () => {
    const flow = createFlowState();
    const [, sig] = sealFlowState(flow, KEY).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        state: "attacker-chosen",
        codeVerifier: flow.codeVerifier,
      }),
    ).toString("base64url");

    // Swapping in an attacker's `state` is the CSRF move this signature exists
    // to stop.
    expect(openFlowState(`${forged}.${sig}`, KEY)).toBeNull();
  });

  it("rejects a tampered SIGNATURE", () => {
    const sealed = sealFlowState(createFlowState(), KEY);
    const [payload, sig] = sealed.split(".");
    const flipped = `${sig!.slice(0, -1)}${sig!.slice(-1) === "A" ? "B" : "A"}`;

    expect(openFlowState(`${payload}.${flipped}`, KEY)).toBeNull();
  });

  it("rejects a seal made with a different signing key", () => {
    const sealed = sealFlowState(
      createFlowState(),
      "a-completely-different-signing-key-value",
    );
    expect(openFlowState(sealed, KEY)).toBeNull();
  });

  it("does NOT accept a payload signed with the raw JWT key", () => {
    // The module derives a purpose-separated key precisely so a flow-state
    // signature can never be confused with an access-token signature. If the raw
    // key opened this, that separation would be decorative.
    const flow = createFlowState();
    const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
    const rawSig = createHmac("sha256", KEY)
      .update(payload)
      .digest("base64url");

    expect(openFlowState(`${payload}.${rawSig}`, KEY)).toBeNull();
  });

  it("returns null for absent or malformed input rather than throwing", () => {
    // The cookie is attacker-controllable, so every shape has to be survivable.
    expect(openFlowState(undefined, KEY)).toBeNull();
    expect(openFlowState("", KEY)).toBeNull();
    expect(openFlowState("no-dot", KEY)).toBeNull();
    expect(openFlowState(".", KEY)).toBeNull();
    expect(openFlowState("a.b", KEY)).toBeNull();
  });

  it("rejects a correctly-signed payload that is not a flow state", () => {
    // Valid signature, wrong shape: without the field check this would return an
    // object whose `codeVerifier` is undefined and fail much later, at Google.
    const payload = Buffer.from(JSON.stringify({ hello: "world" })).toString(
      "base64url",
    );
    const key = createHmac("sha256", KEY)
      .update("oauth-flow-state:v1")
      .digest("base64url");
    const sig = createHmac("sha256", key).update(payload).digest("base64url");

    expect(openFlowState(`${payload}.${sig}`, KEY)).toBeNull();
  });
});

describe("the authorization URL", () => {
  const url = () =>
    new URL(
      buildAuthorizationUrl({
        clientId: "client-123",
        redirectUri: "https://bodouralamal.com/api/v1/auth/google/callback",
        state: "the-state",
        codeChallenge: "the-challenge",
      }),
    );

  it("carries state and the S256 challenge to Google", () => {
    const u = url();

    expect(u.searchParams.get("state")).toBe("the-state");
    expect(u.searchParams.get("code_challenge")).toBe("the-challenge");
    // Anything other than S256 — `plain` above all — would send the verifier in
    // the clear and remove PKCE's protection entirely.
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("requests only openid/email/profile and forces the account chooser", () => {
    const u = url();

    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("response_type")).toBe("code");
    // §4.1b: a shared family device must not silently reuse whoever is signed in.
    expect(u.searchParams.get("prompt")).toBe("select_account");
  });

  it("never carries the verifier itself", () => {
    const { codeVerifier } = createFlowState();
    const raw = buildAuthorizationUrl({
      clientId: "c",
      redirectUri: "https://example.test/cb",
      state: "s",
      codeChallenge: codeChallengeFor(codeVerifier),
    });

    expect(raw).not.toContain(codeVerifier);
  });
});

describe("Google ID-token verification — identity is cryptographically established", () => {
  it("accepts a valid Google-signed token and normalizes its verified email", async () => {
    const result = await verifyGoogleIdToken(
      signedIdToken(),
      GOOGLE_CLIENT_ID,
      localGoogleClient(),
    );

    expect(result).toEqual({
      ok: true,
      identity: {
        email: "safae.el@example.com",
        providerSubjectId: "google-sub-1",
      },
    });
  });

  it("rejects an invalid signature even when every claim looks valid", async () => {
    const result = await verifyGoogleIdToken(
      signedIdToken(googleClaims(), { signingKey: foreignPrivateKey }),
      GOOGLE_CLIENT_ID,
      localGoogleClient(),
    );

    expect(result).toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const result = await verifyGoogleIdToken(
      signedIdToken(googleClaims({ iat: now - 3600, exp: now - 600 })),
      GOOGLE_CLIENT_ID,
      localGoogleClient(),
    );

    expect(result).toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("accepts only Google's documented issuers", async () => {
    const result = await verifyGoogleIdToken(
      signedIdToken(googleClaims({ iss: "googleapis.com" })),
      GOOGLE_CLIENT_ID,
      localGoogleClient(),
    );

    expect(result).toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("rejects a token minted for another OAuth client", async () => {
    const result = await verifyGoogleIdToken(
      signedIdToken(googleClaims({ aud: "someone-elses-client" })),
      GOOGLE_CLIENT_ID,
      localGoogleClient(),
    );

    expect(result).toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("rejects malformed tokens and unsupported protected headers", async () => {
    const client = localGoogleClient();

    await expect(verifyGoogleIdToken("not.a.jwt", GOOGLE_CLIENT_ID, client)).resolves.toEqual({
      ok: false,
      reason: "oauth_unavailable",
    });
    await expect(
      verifyGoogleIdToken(
        signedIdToken(googleClaims(), { alg: "HS256" }),
        GOOGLE_CLIENT_ID,
        client,
      ),
    ).resolves.toEqual({ ok: false, reason: "oauth_unavailable" });
    await expect(
      verifyGoogleIdToken(
        signedIdToken(googleClaims(), { kid: "unknown-key" }),
        GOOGLE_CLIENT_ID,
        client,
      ),
    ).resolves.toEqual({ ok: false, reason: "oauth_unavailable" });
    await expect(
      verifyGoogleIdToken(
        signedIdToken(googleClaims(), { kid: "" }),
        GOOGLE_CLIENT_ID,
        client,
      ),
    ).resolves.toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("requires present, non-empty subject and email claims", async () => {
    const client = localGoogleClient();
    const withoutSubject = googleClaims();
    const withoutEmail = googleClaims();
    delete withoutSubject["sub"];
    delete withoutEmail["email"];

    await expect(
      verifyGoogleIdToken(signedIdToken(googleClaims({ sub: "" })), GOOGLE_CLIENT_ID, client),
    ).resolves.toEqual({ ok: false, reason: "oauth_unavailable" });
    await expect(
      verifyGoogleIdToken(
        signedIdToken(googleClaims({ email: "   " })),
        GOOGLE_CLIENT_ID,
        client,
      ),
    ).resolves.toEqual({ ok: false, reason: "oauth_unavailable" });
    await expect(
      verifyGoogleIdToken(signedIdToken(withoutSubject), GOOGLE_CLIENT_ID, client),
    ).resolves.toEqual({ ok: false, reason: "oauth_unavailable" });
    await expect(
      verifyGoogleIdToken(signedIdToken(withoutEmail), GOOGLE_CLIENT_ID, client),
    ).resolves.toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("refuses false or missing email verification as the SRS-specific reason", async () => {
    const client = localGoogleClient();
    const withoutFlag = googleClaims();
    delete withoutFlag["email_verified"];

    await expect(
      verifyGoogleIdToken(
        signedIdToken(googleClaims({ email_verified: false })),
        GOOGLE_CLIENT_ID,
        client,
      ),
    ).resolves.toEqual({ ok: false, reason: "email_unverified" });
    await expect(
      verifyGoogleIdToken(signedIdToken(withoutFlag), GOOGLE_CLIENT_ID, client),
    ).resolves.toEqual({ ok: false, reason: "email_unverified" });
  });

  it("fails closed when Google's signing certificates cannot be obtained", async () => {
    const client = new OAuth2Client();
    vi.spyOn(client, "getFederatedSignonCertsAsync").mockRejectedValue(
      new Error("JWKS unavailable"),
    );

    const result = await verifyGoogleIdToken(
      signedIdToken(),
      GOOGLE_CLIENT_ID,
      client,
    );

    expect(result).toEqual({ ok: false, reason: "oauth_unavailable" });
  });
});

describe("exchangeCode — code exchange and ID-token trust remain separate", () => {
  const base = {
    code: "auth-code",
    codeVerifier: "verifier",
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: "secret",
    redirectUri: "https://example.test/cb",
  };

  it("passes the returned token and configured audience to the verifier", async () => {
    const verifyIdToken = vi.fn(async () => ({
      ok: true as const,
      identity: {
        email: "safae.el@example.com",
        providerSubjectId: "google-sub-1",
      },
    }));
    const result = await exchangeCode({
      ...base,
      fetchImpl: respondWith({ id_token: "provider-token" }),
      verifyIdToken,
    });

    expect(result).toEqual({
      ok: true,
      identity: {
        email: "safae.el@example.com",
        providerSubjectId: "google-sub-1",
      },
    });
    expect(verifyIdToken).toHaveBeenCalledExactlyOnceWith(
      "provider-token",
      GOOGLE_CLIENT_ID,
    );
  });

  it("never trusts a decodable payload when the verifier refuses it", async () => {
    const forged = `header.${Buffer.from(
      JSON.stringify({
        aud: GOOGLE_CLIENT_ID,
        sub: "attacker-subject",
        email: "attacker@example.com",
        email_verified: true,
      }),
    ).toString("base64url")}.signature`;
    const verifyIdToken = vi.fn(async () => ({
      ok: false as const,
      reason: "oauth_unavailable" as const,
    }));
    const result = await exchangeCode({
      ...base,
      fetchImpl: respondWith({ id_token: forged }),
      verifyIdToken,
    });

    expect(result).toEqual({ ok: false, reason: "oauth_unavailable" });
    expect(verifyIdToken).toHaveBeenCalledExactlyOnceWith(forged, GOOGLE_CLIENT_ID);
  });

  it("collapses every upstream failure into oauth_unavailable, leaking nothing", async () => {
    // TD-3.8: the user gets one redirect key; Google's status codes, DNS
    // failures and malformed bodies must not surface as distinguishable states.
    const nonOk = await exchangeCode({
      ...base,
      fetchImpl: respondWith({}, false),
    });
    expect(nonOk).toEqual({ ok: false, reason: "oauth_unavailable" });

    const noIdToken = await exchangeCode({
      ...base,
      fetchImpl: respondWith({ access_token: "x" }),
    });
    expect(noIdToken).toEqual({ ok: false, reason: "oauth_unavailable" });

    const thrown = await exchangeCode({
      ...base,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(thrown).toEqual({ ok: false, reason: "oauth_unavailable" });

    const verifierFailure = await exchangeCode({
      ...base,
      fetchImpl: respondWith({ id_token: "provider-token" }),
      verifyIdToken: async () => {
        throw new Error("certificate retrieval failed");
      },
    });
    expect(verifierFailure).toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("sends the verifier and the code, not the challenge", async () => {
    let sentBody = "";
    await exchangeCode({
      ...base,
      fetchImpl: (async (_url: string, init: { body: URLSearchParams }) => {
        sentBody = init.body.toString();
        return { ok: true, json: async () => ({}) };
      }) as unknown as typeof fetch,
    });

    expect(new URLSearchParams(sentBody).get("code_verifier")).toBe("verifier");
    expect(new URLSearchParams(sentBody).get("grant_type")).toBe(
      "authorization_code",
    );
  });
});
