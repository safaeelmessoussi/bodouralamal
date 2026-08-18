import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildAuthorizationUrl,
  codeChallengeFor,
  createFlowState,
  exchangeCode,
  openFlowState,
  sealFlowState,
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

const idToken = (claims: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

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

describe("exchangeCode — what Google says is not taken on trust", () => {
  const base = {
    code: "auth-code",
    codeVerifier: "verifier",
    clientId: "client-123",
    clientSecret: "secret",
    redirectUri: "https://example.test/cb",
  };

  it("accepts a verified email for OUR client and lowercases it", async () => {
    const result = await exchangeCode({
      ...base,
      fetchImpl: respondWith({
        id_token: idToken({
          aud: "client-123",
          sub: "google-sub-1",
          email: "Safae.EL@Example.COM",
          email_verified: true,
        }),
      }),
    });

    expect(result).toEqual({
      ok: true,
      identity: {
        email: "safae.el@example.com",
        providerSubjectId: "google-sub-1",
      },
    });
  });

  it("rejects a token minted for ANOTHER client (audience confusion)", async () => {
    // Without the `aud` check, a token obtained by any other Google app would
    // authenticate its holder here.
    const result = await exchangeCode({
      ...base,
      fetchImpl: respondWith({
        id_token: idToken({
          aud: "someone-elses-client",
          sub: "google-sub-1",
          email: "a@example.com",
          email_verified: true,
        }),
      }),
    });

    expect(result).toEqual({ ok: false, reason: "oauth_unavailable" });
  });

  it("refuses an unverified email as its own distinct reason (§4.1b step 7)", async () => {
    const unverified = await exchangeCode({
      ...base,
      fetchImpl: respondWith({
        id_token: idToken({
          aud: "client-123",
          sub: "google-sub-1",
          email: "a@example.com",
          email_verified: false,
        }),
      }),
    });
    expect(unverified).toEqual({ ok: false, reason: "email_unverified" });

    // A missing flag is not a verified one.
    const absent = await exchangeCode({
      ...base,
      fetchImpl: respondWith({
        id_token: idToken({
          aud: "client-123",
          sub: "google-sub-1",
          email: "a@example.com",
        }),
      }),
    });
    expect(absent).toEqual({ ok: false, reason: "email_unverified" });
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

    const garbage = await exchangeCode({
      ...base,
      fetchImpl: respondWith({ id_token: "not.a.valid.token" }),
    });
    expect(garbage).toEqual({ ok: false, reason: "oauth_unavailable" });
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
