import { describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config.js";
import { httpCall } from "../test-support/http-client.js";

/**
 * `GET /site-config` — R175 §2.
 *
 * The temporary Production tier's promise to a reader is that **nothing about
 * them is stored**, and this endpoint is the one the public chrome calls
 * before it paints. So what is asserted is not only its answer but its
 * SHAPE: anonymous, no cookie, no caller data, no cache.
 */
const config = loadConfig();
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;

describe("GET /site-config (R175 §2)", () => {
  it("answers an anonymous caller with exactly the documented key", async () => {
    const res = await httpCall<{ data: Record<string, unknown> }>(BASE, "GET", "/site-config");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data!)).toEqual(["sign_in_offered"]);
    expect(typeof res.body.data!["sign_in_offered"]).toBe("boolean");
  });

  it("offers sign-in unless a deployment says otherwise — absent means offered", async () => {
    // The integration stack sets no `SIGN_IN_OFFERED`, which is the platform's
    // own behaviour and the shape every tier but the temporary Production one
    // runs in.
    const res = await httpCall<{ data: { sign_in_offered: boolean } }>(BASE, "GET", "/site-config");
    expect(res.body.data!.sign_in_offered).toBe(true);
  });

  it("sets no cookie and is never cached — the flag flips on the next load", async () => {
    const res = await httpCall<unknown>(BASE, "GET", "/site-config");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
